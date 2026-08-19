// ---------------------------------------------------------------------------
// src/components/PartDetailPanel.jsx
//
// Everything shown when a part is opened: dimensions, cost breakdown, the
// Geometry / Part Information / Picture UI editors, capture history, photos, and
// the delete affordance.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN COMPONENT
//
// It was inline in PartRow.jsx, inside a `<TableCell colSpan={6}>`. The
// Engineering BOM view needs the SAME panel under a table with a different
// column count, and the brief for that view says "clicking a row should open the
// existing part detail experience" — so the choice was to extract it or to keep a
// second copy. A second copy of four editors would drift: a field added to
// Part Information would appear in one view and not the other, and nobody would
// notice until someone edited a part from the wrong screen.
//
// So this owns no table markup at all. Each caller wraps it in whatever
// row/cell/colSpan its own grid needs, which is the one thing that genuinely
// differs between them.
// ---------------------------------------------------------------------------

import { Trash2 } from 'lucide-react';

import PartGeometryEditor from '@/components/PartGeometryEditor';
import PartInfoEditor from '@/components/PartInfoEditor';
import PartPhotos from '@/components/PartPhotos';
import PartPictureUI from '@/components/PartPictureUI';
import PhotoLabelFamily from '@/components/PhotoLabelFamily';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDateTime, formatMm } from '@/lib/format';

/** Measurement.type -> column label. Mirrors the backend's MEASUREMENT_TYPES. */
const TYPE_LABELS = {
  dimension_length: 'Length',
  dimension_width: 'Width',
  dimension_height: 'Height',
  weight: 'Weight',
  // Added with the capture workstation. Without an entry here a captured
  // thickness would render its raw type string ("dimension_thickness") in the
  // capture history, which is the sort of leak that makes a screen look unfinished.
  dimension_thickness: 'Thickness',
  dimension_diameter: 'Diameter',
  unfolded_length: 'Unfolded L',
  unfolded_width: 'Unfolded W',
};

/**
 * The agreed value on the Part record, for the measurement type being shown.
 *
 * Used to sit the captured reading next to what the part record says. They
 * differ slightly by design — Part holds the agreed value, Measurement holds
 * what the instrument actually read — and showing both is the clearest way to
 * make that distinction visible rather than looking like a rounding bug.
 */
function agreedValueFor(part, type) {
  switch (type) {
    case 'dimension_length':
      return part.lengthMm;
    case 'dimension_width':
      return part.widthMm;
    case 'dimension_height':
      return part.heightMm;
    case 'weight':
      return part.weightG;
    case 'dimension_thickness':
      return part.thicknessMm;
    case 'dimension_diameter':
      return part.diameterOuterMm;
    case 'unfolded_length':
      return part.unfoldedLengthMm;
    case 'unfolded_width':
      return part.unfoldedWidthMm;
    default:
      return null;
  }
}

/**
 * @param {object}   props
 * @param {object}   props.part      from the teardown tree
 * @param {object}   [props.costing] { unitCost, extendedCost, sharePct, currency }
 * @param {boolean}  [props.costsUnavailable]
 * @param {Function} [props.onPartUpdated]  called after a geometry or info save —
 *   the parent refetches the teardown so the collapsed row's own summary stays in
 *   sync with what was just written
 * @param {Function} [props.onPartDeleted]  omit to hide the delete affordance
 */
export default function PartDetailPanel({
  part,
  costing,
  costsUnavailable,
  onPartUpdated,
  onPartDeleted,
}) {
  const measurements = part.measurements ?? [];
  const hasDimensions = part.lengthMm !== null && part.lengthMm !== undefined;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Dimensions</p>
          <p className="text-sm tabular-nums">
            {hasDimensions
              ? `${formatMm(part.lengthMm)} × ${formatMm(part.widthMm)} × ${formatMm(part.heightMm)} mm`
              : 'Not measured'}
          </p>
        </div>
        {!costsUnavailable && costing && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cost breakdown</p>
            <p className="text-sm tabular-nums">
              {formatCurrency(costing.unitCost, costing.currency)} per unit × {part.quantity} ={' '}
              {formatCurrency(costing.extendedCost, costing.currency)}
              <span className="ml-2 text-muted-foreground">({costing.sharePct}% of product)</span>
            </p>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Geometry</p>
        <PartGeometryEditor part={part} onSaved={onPartUpdated} />
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Part Information
        </p>
        <PartInfoEditor part={part} onSaved={onPartUpdated} />
      </div>

      {/* Picture UI sits with Geometry and Part Information because the Photo ID
          is BOM metadata a creator fills in alongside them — not down with
          Captures/Photos, which are records of what was observed rather than
          fields to complete. */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Picture UI</p>
        <PartPictureUI part={part} onSaved={onPartUpdated} />
      </div>

      {/* The photo-label FAMILY — one label per shot, which is how the teardown
          engineers actually label parts. Rendered alongside the single-Photo-ID
          panel above rather than replacing it yet: the BOM grid, its
          Missing-Photo-ID filter and three verification harnesses all read
          Part.photoId, and the family maintains that as its lead label. */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Photo labels on this part
        </p>
        <PhotoLabelFamily part={part} onChanged={onPartUpdated} />
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Captures ({measurements.length})
        </p>
        {measurements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No measurements captured for this part yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {measurements.map((m) => {
              const agreed = agreedValueFor(part, m.type);
              return (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {TYPE_LABELS[m.type] ?? m.type}
                  </span>
                  <span className="font-medium tabular-nums">
                    {m.value} {m.unit}
                  </span>
                  {agreed !== null && agreed !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      (part record: {agreed} {m.unit})
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {m.capturedBy} · {formatDateTime(m.capturedAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Photos</p>
        <PartPhotos partId={part.id} />
      </div>

      {/* Removal lives at the BOTTOM of the expanded detail, not as an icon on
          the collapsed row: you have to open the part and scroll past everything
          it contains before you can delete it. The page owns the confirm and the
          refetch. */}
      {onPartDeleted && (
        <div className="border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => onPartDeleted(part)}
          >
            <Trash2 className="mr-1 size-4" />
            Delete this part
          </Button>
        </div>
      )}
    </div>
  );
}
