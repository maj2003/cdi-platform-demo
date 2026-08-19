// ---------------------------------------------------------------------------
// src/components/PartGeometryEditor.jsx
//
// The geometry-type tile selector + dynamic dimension form for one part.
// Embedded in PartRow's expanded detail section.
//
// EDITING MODEL: local, batched, explicit Save — not per-field auto-commit
// like CapturePage. Geometry type and its dimensions are one coherent unit
// (picking "Circular" without also having somewhere to type the diameter is
// meaningless), so this collects the whole edit and submits it as one PATCH
// rather than firing a request per keystroke.
//
// Switching geometry type only changes what's VISIBLE, not what's stored —
// the PATCH only ever includes the fields relevant to the currently-selected
// type, so toggling to "Circular" and back to "Rectangular" without saving
// never touches the diameter fields that were already on the record.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Circle, Layers, RectangleHorizontal, Shapes } from 'lucide-react';

import api from '@/lib/api';
import { useApiAction } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const GEOMETRY_OPTIONS = [
  { value: 'rectangular', label: 'Rectangular', icon: RectangleHorizontal },
  { value: 'circular', label: 'Circular', icon: Circle },
  { value: 'sheet_metal', label: 'Sheet Metal', icon: Layers },
  { value: 'custom', label: 'Custom', icon: Shapes },
];

/** Every dimension-related column on Part, and how to label/type it. */
const FIELD_DEFS = {
  lengthMm: { label: 'Length', unit: 'mm' },
  widthMm: { label: 'Width', unit: 'mm' },
  heightMm: { label: 'Height', unit: 'mm' },
  thicknessMm: { label: 'Thickness', unit: 'mm' },
  diameterOuterMm: { label: 'Outer Diameter (OØ)', unit: 'mm' },
  diameterInnerMm: { label: 'Inner Diameter (IØ)', unit: 'mm' },
  turns: { label: 'Turns', unit: null, integer: true },
  unfoldedLengthMm: { label: 'Unfolded Length', unit: 'mm' },
  unfoldedWidthMm: { label: 'Unfolded Width', unit: 'mm' },
  bends: { label: 'No. of Bends', unit: null, integer: true },
  punches: { label: 'No. of Punches', unit: null, integer: true },
};

/** Which fields are visible for each geometry type — per the mockup's spec. */
const FIELDS_BY_GEOMETRY = {
  rectangular: ['lengthMm', 'widthMm', 'heightMm', 'thicknessMm'],
  circular: ['diameterOuterMm', 'diameterInnerMm', 'heightMm', 'turns', 'thicknessMm'],
  sheet_metal: ['lengthMm', 'widthMm', 'thicknessMm', 'bends', 'punches', 'unfoldedLengthMm', 'unfoldedWidthMm'],
  custom: Object.keys(FIELD_DEFS),
};

/** Part -> the local form's string-valued state, one entry per dimension field. */
function valuesFromPart(part) {
  return Object.fromEntries(
    Object.keys(FIELD_DEFS).map((key) => [key, part[key] ?? '']),
  );
}

/**
 * @param {object} props
 * @param {object} props.part      the part row from the teardown tree
 * @param {Function} [props.onSaved]  called after a successful save — the
 *   caller refetches the teardown so every view of this part (the plain-text
 *   Dimensions summary above, any product-level totals) stays in sync rather
 *   than trusting this component's own local state.
 */
export default function PartGeometryEditor({ part, onSaved }) {
  const [geometryType, setGeometryType] = useState(part.geometryType ?? null);
  const [values, setValues] = useState(() => valuesFromPart(part));

  // Resync whenever the server's version of this part changes — after a save
  // (via onSaved's refetch) or if another tab/session edited it — so a stale
  // local draft never lingers once the source of truth has moved on. This is
  // React's documented "adjust state during render" pattern rather than a
  // useEffect: `part` is a fresh object per fetch, so comparing by reference
  // and resetting inline (guarded, so it only fires the render where `part`
  // actually changed) avoids the extra render+lint issue an effect-based
  // resync would have.
  const [lastPart, setLastPart] = useState(part);
  if (part !== lastPart) {
    setLastPart(part);
    setGeometryType(part.geometryType ?? null);
    setValues(valuesFromPart(part));
  }

  const save = useApiAction((patch) => api.parts.update(part.id, patch));

  const visibleFields = geometryType ? FIELDS_BY_GEOMETRY[geometryType] : [];

  function handleSelectGeometry(next) {
    setGeometryType(next);
    save.reset(); // clear a stale error from a previous save attempt
  }

  async function handleSave() {
    const fields = geometryType ? FIELDS_BY_GEOMETRY[geometryType] : [];
    const patch = { geometryType };
    for (const key of fields) {
      const raw = values[key];
      patch[key] = raw === '' ? null : raw;
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {GEOMETRY_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = geometryType === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelectGeometry(opt.value)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors',
                selected
                  ? 'border-primary bg-accent/25 text-foreground'
                  : 'border-border text-muted-foreground hover:border-accent hover:bg-accent/10',
              )}
            >
              <Icon className={cn('size-5', selected ? 'text-primary' : 'text-muted-foreground')} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {!geometryType ? (
        <p className="text-sm text-muted-foreground">
          Select a geometry type above to enter its dimensions.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleFields.map((key) => {
            const def = FIELD_DEFS[key];
            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`geo-${part.id}-${key}`} className="text-xs text-muted-foreground">
                  {def.label}
                  {def.unit ? ` (${def.unit})` : ''}
                </Label>
                <Input
                  id={`geo-${part.id}-${key}`}
                  type="number"
                  inputMode="decimal"
                  step={def.integer ? 1 : 'any'}
                  value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                />
              </div>
            );
          })}
        </div>
      )}

      {save.error && (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={!geometryType || save.loading}>
          {save.loading ? 'Saving…' : 'Save geometry'}
        </Button>
        {save.data && !save.loading && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
      </div>
    </div>
  );
}
