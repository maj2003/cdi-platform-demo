// ---------------------------------------------------------------------------
// src/components/project/ModuleList.jsx
//
// One model's modules: the seventeen standard HVAC modules, each collapsible, each
// showing the parts already inside it and offering one more.
//
//   Coil Assembly            3 parts   ▾
//     Evaporator Coil Slab           11.8 kg
//     Refrigerant Distributor         185 g
//     Coil Support Rail            ×2  420 g
//     [ part name ]  [ Create part ]
//
// ---------------------------------------------------------------------------
// WHY THE PARTS ARE LISTED HERE
//
// The review's point was direct: users can create a part but cannot see what is
// already in the module, and should not have to open another screen to find out.
// The teardown response this component is handed already carries every part of
// every module, so listing them costs nothing — a second request to fetch parts we
// were already given would be pure waste.
//
// ---------------------------------------------------------------------------
// ONE MODULE OPEN AT A TIME, AND CLOSED BY DEFAULT
//
// Seventeen modules × their parts is far too much at once — the specific complaint
// was "too much information visible at once". So the list renders as seventeen
// collapsed rows and expands exactly one. That also makes the path down the
// hierarchy legible: Category → Model → Module → Part, one choice per level, which
// is the shape the workflow is supposed to have.
//
// The open module lives in the PROJECT SESSION rather than in this component's
// state, because Create Part navigates to the capture station and comes back:
// component state would be gone, and the engineer would land on a collapsed step 4
// having to find their way back down to the part they just made.
//
// ---------------------------------------------------------------------------
// A MODULE BECOMES REAL WHEN A PART GOES INTO IT
//
// See lib/hvacModules.js for the full reasoning. Short version: inserting all
// seventeen SubAssembly rows per model would pad the imported teardowns with nine
// to twelve permanently empty modules, visible in the teardown accordion, the
// Engineering BOM view and the Excel export — asserting modules the source workbook
// never mentioned. So Create Part POSTs the module first when it does not exist
// yet, then the part, then opens the workstation on that part.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';

import api from '@/lib/api';
import { formatWeight } from '@/lib/format';
import { modulesForProduct } from '@/lib/hvacModules';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Grams shown as grams; a kilogram and up through the shared formatter. */
function partWeight(part) {
  if (part.weightG === null || part.weightG === undefined) return '—';
  return part.weightG < 1000 ? `${part.weightG} g` : formatWeight(part.weightG / 1000);
}

/**
 * @param {object}   props
 * @param {object}   props.model            the product row (needs id)
 * @param {Array}    props.subAssemblies    from the teardown
 * @param {string|null} props.openModuleKey
 * @param {Function} props.onOpenModule     (key) => void, toggles
 * @param {Function} [props.onChanged]      refetch after a write
 */
export default function ModuleList({
  model,
  subAssemblies,
  openModuleKey,
  onOpenModule,
  onChanged,
}) {
  const navigate = useNavigate();
  const [partName, setPartName] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  const modules = modulesForProduct(subAssemblies ?? []);
  const withParts = modules.filter((m) => m.partCount > 0).length;
  const totalParts = modules.reduce((sum, m) => sum + m.partCount, 0);

  /**
   * Create the part, then open the workstation on it.
   *
   * `?part=` selects it in the workstation so the engineer is measuring the thing
   * they just named rather than whichever part happens to be first. `?from=project`
   * is what puts a "Back to project" action on that page — the return leg the
   * review asked for.
   */
  const createPart = async (mod) => {
    const name = partName.trim();
    if (!name) return;
    setError(null);
    setBusyKey(mod.key);
    try {
      let subAssemblyId = mod.subAssemblyId;
      if (!subAssemblyId) {
        const created = await api.modules.create({ productId: model.id, name: mod.name });
        subAssemblyId = created.id;
      }
      const part = await api.parts.create({ subAssemblyId, name });
      setPartName('');
      await onChanged?.();
      navigate(`/products/${model.id}/capture?part=${part.id}&from=project`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Select a module
        </p>
        <p className="text-xs text-muted-foreground">
          {/* Stated rather than left to be counted: the gap between 17 and what has
              parts is the status of the teardown. */}
          <strong className="text-foreground">{withParts} of {modules.length}</strong> modules
          have parts · {totalParts} parts
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ul className="divide-y overflow-hidden rounded-lg border">
        {modules.map((mod) => {
          const open = openModuleKey === mod.key;
          const busy = busyKey === mod.key;
          return (
            <li key={mod.key}>
              {/* The whole row is the toggle. A chevron-only hit target on a
                  seventeen-row list is needlessly precise work. */}
              <button
                type="button"
                onClick={() => onOpenModule(mod.key)}
                aria-expanded={open}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/5 ${
                  open ? 'bg-accent/10' : ''
                }`}
              >
                {open ? (
                  <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}

                {/* Filled tick vs open circle, so state reads down the column at a
                    glance rather than by reading each count. */}
                <span
                  aria-hidden
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                    mod.partCount > 0
                      ? 'border-accent bg-accent/20 text-accent-foreground'
                      : 'border-dashed text-muted-foreground'
                  }`}
                >
                  {mod.partCount > 0 ? <Check className="size-3" /> : ''}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`text-sm ${
                        mod.partCount > 0 ? 'font-medium' : 'text-muted-foreground'
                      }`}
                    >
                      {mod.name}
                    </span>
                    {mod.optional && (
                      <Badge variant="outline" className="text-[10px] font-normal uppercase">
                        Optional
                      </Badge>
                    )}
                    {mod.extra && (
                      // A module this model has that the standard list does not.
                      // Shown, because dropping it would hide real parts.
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        Not in the standard list
                      </Badge>
                    )}
                  </span>
                  {/* The model's own wording, when it differs — so nobody thinks
                      the app renamed their module. */}
                  {mod.actualName && mod.actualName !== mod.name && (
                    <span className="block truncate text-xs text-muted-foreground">
                      in this BOM: “{mod.actualName}”
                    </span>
                  )}
                </span>

                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {mod.partCount > 0
                    ? `${mod.partCount} part${mod.partCount === 1 ? '' : 's'}`
                    : 'not yet'}
                </span>
              </button>

              {open && (
                <div className="space-y-2 border-t bg-muted/20 px-3 py-3">
                  {mod.parts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No parts in this module yet. Name one below and the module will be
                      created with it.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {mod.parts.map((part) => (
                        <li
                          key={part.id}
                          className="flex items-center gap-2 rounded-md bg-card px-2.5 py-1.5 text-xs"
                        >
                          <span aria-hidden className="text-muted-foreground">·</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{part.name}</span>
                          {part.quantity > 1 && (
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              ×{part.quantity}
                            </span>
                          )}
                          <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                            {partWeight(part)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Create Part lives INSIDE the open module, so the part cannot
                      end up somewhere other than the module being looked at. */}
                  <form
                    onSubmit={(e) => { e.preventDefault(); createPart(mod); }}
                    className="flex flex-wrap items-center gap-2 pt-1"
                  >
                    <Input
                      value={partName}
                      onChange={(e) => setPartName(e.target.value)}
                      placeholder="New part name"
                      aria-label={`New part in ${mod.name}`}
                      className="h-8 flex-1 min-w-40 bg-card text-xs"
                    />
                    <Button type="submit" size="sm" className="h-8" disabled={busy || !partName.trim()}>
                      <Plus className="mr-1 size-3.5" />
                      {busy ? 'Creating…' : 'Create part'}
                    </Button>
                  </form>
                  <p className="text-xs text-muted-foreground">
                    Opens the Capture Workstation on the new part. You come back here when
                    you are done.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Modules are created when the first part goes into them, so an imported model keeps
        exactly the modules its workbook described.
      </p>
    </div>
  );
}
