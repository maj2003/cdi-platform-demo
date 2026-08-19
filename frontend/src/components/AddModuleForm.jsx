// ---------------------------------------------------------------------------
// src/components/AddModuleForm.jsx — "Add Module" in the BOM Authoring Workbench.
//
// A collapsed button that opens an inline form, the same shape ImportBomPanel
// uses. Inline rather than a modal because the point of authoring on the
// teardown page is that you can see the tree you're adding to.
//
// The eight standard AHU module names are offered as a datalist rather than a
// <select>: they're the right answer most of the time, but a teardown of a
// different product class legitimately needs its own names, and a closed select
// would make that impossible. Same reasoning PartInfoEditor documents for its
// process/finish fields.
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

/** The eight Level-1 AHU modules the reference teardowns use, as suggestions. */
const SUGGESTED_MODULES = [
  'Packaging Assm',
  'Cabinet Assm',
  'Coil Assm - Evaporator',
  'Blower Assm',
  'Electrical Assm',
  'Condensate Mgmt Assm',
  'Air Filtration Assm',
  'Electric Heater Assm',
];

/**
 * @param {object} props
 * @param {number} props.productId
 * @param {Array<string>} [props.existingNames]  already used on this product
 * @param {() => void} props.onCreated           refetch the teardown
 */
export default function AddModuleForm({ productId, existingNames = [], onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = useApiAction((body) => api.modules.create(body));

  const reset = () => {
    setName('');
    setDescription('');
    create.reset();
  };

  // Caught client-side too so the duplicate is flagged before a round trip; the
  // server enforces it regardless (409), which is what actually protects the data.
  const taken = existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase());
  const canSubmit = name.trim().length > 0 && !taken && !create.loading;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await create.run({ productId, name: name.trim(), description: description.trim() || null });
      reset();
      setOpen(false);
      onCreated?.();
    } catch {
      // create.error renders below.
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus className="mr-1 size-4" />
        Add Module
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="py-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">New module</p>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-module-name">Module name</Label>
              <Input
                id="new-module-name"
                list="suggested-modules"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cabinet Assm"
                maxLength={120}
                autoFocus
              />
              <datalist id="suggested-modules">
                {SUGGESTED_MODULES.filter((m) => !existingNames.includes(m)).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {taken && (
                <p className="text-xs text-destructive">
                  This product already has a module with that name.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-module-description">Description (optional)</Label>
              <Input
                id="new-module-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Structural enclosure — wrapper, base pan, door"
                maxLength={240}
              />
            </div>
          </div>

          {create.error && (
            <Alert variant="destructive">
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {create.loading ? 'Adding…' : 'Add module'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Modules group parts and drive every per-module cost and weight rollup.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
