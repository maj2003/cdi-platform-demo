// ---------------------------------------------------------------------------
// src/components/PartRow.jsx
//
// One part in the TEARDOWN view's per-module table, plus its expandable detail.
//
// Presentational only. The expanded/collapsed state is owned by the parent, so
// the page can collapse everything at once and so this component stays a pure
// function of its props.
//
// The expanded body itself lives in PartDetailPanel.jsx — the Engineering BOM
// view renders the same panel under a table with a different column count. See
// that file for why it was extracted.
// ---------------------------------------------------------------------------

import { ChevronDown, ChevronRight } from 'lucide-react';

import PartDetailPanel from '@/components/PartDetailPanel';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatCurrency, formatGrams } from '@/lib/format';

/** Data columns in this table, for the expanded row's colSpan. */
const DETAIL_COLSPAN = 6;

/**
 * @param {object}   props
 * @param {object}   props.part      from the teardown tree
 * @param {object}   [props.costing] { extendedCost, sharePct } from the cost report
 * @param {boolean}  props.expanded
 * @param {Function} props.onToggle
 * @param {boolean}  [props.costsUnavailable]
 * @param {Function} [props.onPartUpdated]  called after a geometry or info
 *   save — the parent refetches the teardown so this row's own summary stays
 *   in sync with what PartGeometryEditor/PartInfoEditor just wrote.
 */
export default function PartRow({
  part,
  costing,
  expanded,
  onToggle,
  costsUnavailable,
  onPartUpdated,
  onPartDeleted,
}) {
  const measurements = part.measurements ?? [];

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="w-8 align-top">
          {/* A chevron rather than a plain click target: without an affordance,
              nobody discovers that rows expand. */}
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </TableCell>

        <TableCell className="font-medium">
          {part.name}
          {part.finish && (
            <span className="block text-xs font-normal text-muted-foreground">{part.finish}</span>
          )}
        </TableCell>

        <TableCell className="text-muted-foreground">{part.material ?? '—'}</TableCell>

        <TableCell className="text-right tabular-nums">
          {part.quantity > 1 ? (
            <Badge variant="secondary">×{part.quantity}</Badge>
          ) : (
            <span className="text-muted-foreground">×1</span>
          )}
        </TableCell>

        <TableCell className="text-right tabular-nums">{formatGrams(part.weightG)}</TableCell>

        <TableCell className="text-right tabular-nums">
          {/* Cost comes from the server's cost report, not from adding up the
              three cost columns here. Recomputing client-side is how a detail
              page ends up quietly disagreeing with the reports page. */}
          {costsUnavailable ? '—' : formatCurrency(costing?.extendedCost, costing?.currency)}
        </TableCell>

        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
          {measurements.length}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableCell />
          <TableCell colSpan={DETAIL_COLSPAN} className="py-4">
            <PartDetailPanel
              part={part}
              costing={costing}
              costsUnavailable={costsUnavailable}
              onPartUpdated={onPartUpdated}
              onPartDeleted={onPartDeleted}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
