// ---------------------------------------------------------------------------
// src/components/PartInfoEditor.jsx
//
// The BOM-metadata form for one part — Make/Buy, module, category, part
// number, UOM, process pair, surface finish, plus the benchmarking fields
// (function/comparison name, fastener/similar flags). Embedded in PartRow's
// expanded detail section, right after Geometry.
//
// Same editing model as PartGeometryEditor.jsx: local state, one batched
// Save, PATCH /api/parts/:id. Unlike Geometry there's no "which fields are
// relevant" branching — every field here always applies, so the patch always
// carries all of them.
//
// DROPDOWN FIELDS: a native <input list="..."> + <datalist>, not a <select>.
// The seeded data already has real process/finish values that don't appear
// in the starter option lists (Winding, Tube Bending, Brazing, Wire Harness
// Assembly, ...) — a plain <select> restricted to the starter list would
// have nowhere to put those and would misrepresent the record. A datalist
// shows the same suggestion dropdown on focus while still accepting (and
// correctly displaying) any value already on the part, which is exactly the
// "dropdown with free-text fallback" the brief asks for, with no extra
// component needed.
// ---------------------------------------------------------------------------

import { useState } from 'react';

import api from '@/lib/api';
import { useApiAction } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** The free-text / dropdown fields, in display order. `options` is omitted for plain free text. */
const TEXT_FIELDS = [
  { key: 'makeOrBuy', label: 'Make / Buy', options: ['Make', 'Buy'] },
  { key: 'moduleName', label: 'Module' },
  { key: 'productCategory', label: 'Product Category' },
  { key: 'partNo', label: 'Part No' },
  { key: 'uom', label: 'UOM', options: ['EA', 'SET', 'mm', 'g', 'kg'] },
  {
    key: 'primaryProcess',
    label: 'Primary Process',
    options: [
      'Injection Molding', 'Stamping', 'Machining', 'Die Casting',
      'Extrusion', 'Assembly', 'PCB Fabrication', 'Purchased',
    ],
  },
  {
    key: 'secondaryProcess',
    label: 'Secondary Process',
    options: ['Painting', 'Plating', 'Anodizing', 'Heat Treatment', 'Welding', 'None'],
  },
  {
    key: 'surfaceFinish',
    label: 'Surface Finish',
    options: ['As-moulded', 'Painted', 'Zinc Plated', 'Anodized', 'Powder Coated', 'Bare'],
  },
  { key: 'functionName', label: 'Function Name' },
  { key: 'comparisonName', label: 'Comparison Name' },
  // Added with the BOM Authoring Workbench. `description` is the Part column the
  // "Notes" field on Add Part writes to (and the one the CEDARS importer fills
  // from a source "Part Description"), so without an entry here a note typed at
  // creation time could never be corrected afterwards. Declared as a TEXT_FIELD
  // so it inherits the existing value plumbing, save patch and prop resync for
  // free rather than needing its own state.
  { key: 'description', label: 'Notes' },
];

/** The two boolean flags — a Switch each, not folded into the grid above. */
const BOOLEAN_FIELDS = [
  { key: 'isFastener', label: 'Is Fastener' },
  { key: 'similarFlag', label: 'Similar' },
];

function valuesFromPart(part) {
  const values = {};
  for (const f of TEXT_FIELDS) values[f.key] = part[f.key] ?? '';
  for (const f of BOOLEAN_FIELDS) values[f.key] = Boolean(part[f.key]);
  return values;
}

/**
 * @param {object} props
 * @param {object} props.part
 * @param {Function} [props.onSaved]  called after a successful save — see
 *   PartGeometryEditor.jsx's note on why the parent refetches rather than
 *   this component trusting its own local state.
 */
export default function PartInfoEditor({ part, onSaved }) {
  const [values, setValues] = useState(() => valuesFromPart(part));

  // Same render-time resync as PartGeometryEditor.jsx — see that file for why
  // this isn't a useEffect.
  const [lastPart, setLastPart] = useState(part);
  if (part !== lastPart) {
    setLastPart(part);
    setValues(valuesFromPart(part));
  }

  const save = useApiAction((patch) => api.parts.update(part.id, patch));

  async function handleSave() {
    const patch = {};
    for (const f of TEXT_FIELDS) {
      const raw = values[f.key];
      patch[f.key] = raw === '' ? null : raw;
    }
    for (const f of BOOLEAN_FIELDS) {
      patch[f.key] = values[f.key];
    }
    try {
      await save.run(patch);
      onSaved?.();
    } catch {
      // save.error renders below.
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TEXT_FIELDS.map((f) => {
          const inputId = `info-${part.id}-${f.key}`;
          const listId = `${inputId}-options`;
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                {f.label}
              </Label>
              <Input
                id={inputId}
                list={f.options ? listId : undefined}
                autoComplete="off"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              {f.options && (
                <datalist id={listId}>
                  {f.options.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 pt-1">
        {BOOLEAN_FIELDS.map((f) => {
          const switchId = `info-${part.id}-${f.key}`;
          return (
            <div key={f.key} className="flex items-center gap-2">
              <Switch
                id={switchId}
                checked={values[f.key]}
                onCheckedChange={(checked) => setValues((v) => ({ ...v, [f.key]: checked }))}
              />
              <Label htmlFor={switchId} className="text-sm font-normal">
                {f.label}
              </Label>
            </div>
          );
        })}
      </div>

      {save.error && (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={save.loading}>
          {save.loading ? 'Saving…' : 'Save details'}
        </Button>
        {save.data && !save.loading && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
      </div>
    </div>
  );
}
