// ---------------------------------------------------------------------------
// src/components/AddPartForm.jsx — "Add Part" in the BOM Authoring Workbench.
//
// Creates a part inside one module with the fields a teardown engineer has to
// hand at the bench: name, material, quantity, weight, L/W/H, notes and the
// Picture UI Photo ID.
//
// ---------------------------------------------------------------------------
// WHY THIS FORM IS DELIBERATELY SHORT
//
// Part has ~40 columns. This asks for eight. Everything else — geometry type and
// its type-specific dimensions, make/buy, processes, finishes, the benchmarking
// comparison fields — is already editable in place once the part exists, via the
// Geometry and Part Information editors in the part's own expanded row. Asking
// for all of it up front would make adding a part a chore and duplicate three
// editors that already work.
//
// So the flow is: add the part with what you know, then expand it and fill in
// Geometry / Part Information / Picture UI. The new row lands in the tree
// already carrying those sections, so the hand-off needs no navigation.
//
// NO COST FIELDS, and that is a real gap rather than an oversight: there is no
// in-app cost editor anywhere yet, so a part authored here reads as "not costed"
// throughout the reports and is counted in the cost view's uncostedPartLines.
// That's visible and true. Writing zeros would instead assert the part is free.
// See PROGRESS.md's TODO.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import api from '@/lib/api';
import { useApiAction } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Materials seen across the reference teardowns, offered as suggestions only. */
const SUGGESTED_MATERIALS = [
  'Galvanised Steel',
  'Stainless Steel 304',
  'Aluminium',
  'Copper / Aluminium',
  'Copper',
  'Brass',
  'PP',
  'PP + 30% GF',
  'PA6 + 30% GF',
  'EPS',
  'EPP Foam',
  'Fibreglass',
  'Corrugated Board',
  'Polyester Media',
  'FR-4 / Mixed',
  'Copper / PVC',
  'Nichrome / Ceramic',
];

const BLANK = {
  name: '',
  material: '',
  quantity: '1',
  weightG: '',
  lengthMm: '',
  widthMm: '',
  heightMm: '',
  description: '',
  photoId: '',
};

/** '' -> undefined so the server's normaliser sees "not provided", not "empty". */
const omitBlank = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * @param {object} props
 * @param {number} props.subAssemblyId
 * @param {string} props.moduleName
 * @param {() => void} props.onCreated  refetch the teardown
 */
export default function AddPartForm({ subAssemblyId, moduleName, onCreated }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(BLANK);
  // Kept open across submits so a whole module can be typed in without
  // re-opening the form each time — the actual authoring workflow.
  const [addedCount, setAddedCount] = useState(0);

  const create = useApiAction((body) => api.parts.create(body));

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const reset = () => {
    setValues(BLANK);
    create.reset();
  };

  const canSubmit = values.name.trim().length > 0 && !create.loading;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await create.run({
        subAssemblyId,
        name: values.name.trim(),
        material: omitBlank(values.material),
        quantity: omitBlank(values.quantity) ?? 1,
        weightG: omitBlank(values.weightG),
        lengthMm: omitBlank(values.lengthMm),
        widthMm: omitBlank(values.widthMm),
        heightMm: omitBlank(values.heightMm),
        description: omitBlank(values.description),
        photoId: omitBlank(values.photoId),
      });
      setAddedCount((n) => n + 1);
      reset();
      onCreated?.();
    } catch {
      // create.error renders below; the form keeps its values so nothing typed
      // is lost to a validation failure.
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          reset();
          setAddedCount(0);
          setOpen(true);
        }}
      >
        <Plus className="mr-1 size-4" />
        Add Part
      </Button>
    );
  }

  const numberField = (key, label, placeholder, unit) => (
    <div className="space-y-1.5">
      <Label htmlFor={`new-part-${key}-${subAssemblyId}`}>
        {label}
        {unit && <span className="ml-1 text-muted-foreground">({unit})</span>}
      </Label>
      <Input
        id={`new-part-${key}-${subAssemblyId}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={values[key]}
        onChange={set(key)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <Card className="w-full">
      <CardContent className="py-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              New part in <span className="text-muted-foreground">{moduleName}</span>
            </p>
            <div className="flex items-center gap-2">
              {addedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {addedCount} added this session
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor={`new-part-name-${subAssemblyId}`}>Name</Label>
              <Input
                id={`new-part-name-${subAssemblyId}`}
                value={values.name}
                onChange={set('name')}
                placeholder="e.g. Cabinet Wrapper Panel"
                maxLength={200}
                autoFocus
              />
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor={`new-part-material-${subAssemblyId}`}>Material</Label>
              <Input
                id={`new-part-material-${subAssemblyId}`}
                list={`suggested-materials-${subAssemblyId}`}
                value={values.material}
                onChange={set('material')}
                placeholder="e.g. Galvanised Steel"
              />
              <datalist id={`suggested-materials-${subAssemblyId}`}>
                {SUGGESTED_MATERIALS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            {numberField('quantity', 'Quantity', '1')}
            {numberField('weightG', 'Weight', '8600', 'g')}
            {numberField('lengthMm', 'Length', '1345', 'mm')}
            {numberField('widthMm', 'Width', '546', 'mm')}
            {numberField('heightMm', 'Height', '546', 'mm')}

            <div className="space-y-1.5">
              <Label htmlFor={`new-part-photoid-${subAssemblyId}`}>Photo ID</Label>
              <Input
                id={`new-part-photoid-${subAssemblyId}`}
                value={values.photoId}
                onChange={set('photoId')}
                placeholder="e.g. C1"
                maxLength={40}
                className="uppercase placeholder:normal-case"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
              <Label htmlFor={`new-part-notes-${subAssemblyId}`}>Notes</Label>
              <Textarea
                id={`new-part-notes-${subAssemblyId}`}
                value={values.description}
                onChange={set('description')}
                placeholder="e.g. Wrap-around shell, 0.9 mm galvanised, 4 bends"
                rows={2}
              />
            </div>
          </div>

          {create.error && (
            <Alert variant="destructive">
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {create.loading ? 'Adding…' : 'Add part'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Only a name is required. Geometry, Part Information and Picture UI are editable on the
              new row once it appears — and a part has no cost until one is recorded, so it will show
              as uncosted in the reports.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
