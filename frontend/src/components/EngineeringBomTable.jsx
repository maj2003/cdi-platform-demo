// ---------------------------------------------------------------------------
// src/components/EngineeringBomTable.jsx
//
// The Engineering BOM view: every part of a teardown in one flat, sortable,
// filterable grid — what an engineer means by "show me the BOM", as opposed to
// the teardown view's per-module accordion which is built for editing.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT DO
//
// It does not compute a single figure of its own beyond summing the filtered
// selection. Unit cost, extended cost and each part's share all arrive from the
// server's cost report via `costingByPart`, for the reason ProductDetailPage's
// header comment spells out: benchmarkService already defines what a total means,
// and a second definition in the browser agrees today and drifts tomorrow — with
// the failure mode being two screens quietly showing different numbers for the
// same product.
//
// The one aggregate computed here is the FILTERED SUBTOTAL in the footer, and it
// is labelled as such. It's a sum of server-provided per-part figures over
// whatever rows are currently visible, which is a question no report can answer
// because the filter only exists in this view. It is deliberately never called
// the product total.
//
// ---------------------------------------------------------------------------
// WHY NULLS ALWAYS SORT LAST
//
// 21 of the 101 lines in the imported Goodman BOM have no cost, and ~31 have no
// weight — the source simply never populated them. With naive sorting, "sort by
// cost ascending" hands the top of the list to parts whose cost is UNKNOWN, and
// an engineer reading "cheapest parts" gets a screen full of blanks. Nulls are
// pushed to the bottom in both directions, so ascending means "cheapest known"
// and descending means "most expensive known".
// ---------------------------------------------------------------------------

import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X } from 'lucide-react';

import PartDetailPanel from '@/components/PartDetailPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatCount, formatGrams } from '@/lib/format';

/**
 * The columns, in order.
 *
 * `get` is the SORT key, not the rendered value — the two differ on purpose for
 * the Part column, which renders a name plus a description but sorts on the name
 * alone. `numeric` picks numeric comparison and right alignment.
 */
const COLUMNS = [
  { key: 'module', label: 'Module', get: (r) => r.moduleName },
  { key: 'partNo', label: 'Part Number', get: (r) => r.part.partNo },
  { key: 'name', label: 'Part Name / Description', get: (r) => r.part.name },
  { key: 'material', label: 'Material', get: (r) => r.part.material },
  { key: 'process', label: 'Primary Process', get: (r) => r.part.primaryProcess },
  { key: 'quantity', label: 'Qty', get: (r) => r.part.quantity, numeric: true },
  { key: 'weightEach', label: 'Weight ea', get: (r) => r.part.weightG, numeric: true },
  { key: 'weightTotal', label: 'Weight tot', get: (r) => r.weightTotalG, numeric: true },
  // An UNCOSTED part sorts as absent, not as zero — see the note on `costed` below.
  { key: 'unitCost', label: 'Unit cost', get: (r) => (r.costed ? r.unitCost : null), numeric: true },
  { key: 'extCost', label: 'Ext cost', get: (r) => (r.costed ? r.extendedCost : null), numeric: true },
  { key: 'photoId', label: 'Photo ID', get: (r) => r.part.photoId },
];

const blankish = (v) => v === null || v === undefined || v === '';

/**
 * Comparator with nulls pinned to the bottom regardless of direction.
 * See the header note on why.
 */
function compareBy(column, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const av = column.get(a);
    const bv = column.get(b);
    const aBlank = blankish(av);
    const bBlank = blankish(bv);
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;
    if (bBlank) return -1;
    if (column.numeric) return (av - bv) * sign;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sign;
  };
}

/** Distinct non-blank values for a filter dropdown, sorted for predictability. */
function distinct(rows, pick) {
  return [...new Set(rows.map(pick).filter((v) => !blankish(v)))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
}

/** A styled native <select>. The codebase has no Select primitive — see below. */
function FilterSelect({ id, label, value, onChange, options, allLabel }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full min-w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function SortHeader({ column, sort, onSort, className }) {
  const active = sort.key === column.key;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 whitespace-nowrap font-medium transition-colors hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
        aria-label={`Sort by ${column.label}`}
      >
        {column.label}
        {active ? (
          sort.direction === 'asc' ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUp className="size-3.5 opacity-0 group-hover:opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

/**
 * @param {object}   props
 * @param {object}   props.teardown                the teardown tree
 * @param {Map|null} props.costingByPart           partId -> per-part cost figures
 * @param {boolean}  props.costsUnavailable
 * @param {Set}      props.expandedParts           SHARED with the teardown view, so a
 *   part opened in one view is open in the other
 * @param {Function} props.onTogglePart
 * @param {Function} props.onPartUpdated
 * @param {Function} [props.onPartDeleted]
 * @param {string}   props.currency
 */
export default function EngineeringBomTable({
  teardown,
  costingByPart,
  costsUnavailable,
  expandedParts,
  onTogglePart,
  onPartUpdated,
  onPartDeleted,
  currency,
}) {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [processFilter, setProcessFilter] = useState('');
  const [uncostedOnly, setUncostedOnly] = useState(false);
  const [noPhotoIdOnly, setNoPhotoIdOnly] = useState(false);
  const [sort, setSort] = useState({ key: 'module', direction: 'asc' });

  /**
   * Flatten the tree into one row per part.
   *
   * `moduleName` is taken from the enclosing SUB-ASSEMBLY, not from the part's own
   * moduleName column. Both exist and they are kept in agreement deliberately
   * (see PROGRESS.md), but the sub-assembly is the structural parent — so if they
   * ever did disagree, this grid should show the hierarchy the teardown view
   * shows, not a second opinion.
   */
  const rows = useMemo(() => {
    const out = [];
    for (const sub of teardown?.subAssemblies ?? []) {
      for (const part of sub.parts ?? []) {
        const costing = costingByPart?.get(part.id) ?? null;
        out.push({
          part,
          costing,
          moduleName: sub.name,
          subAssemblyId: sub.id,
          unitCost: costing?.unitCost ?? null,
          extendedCost: costing?.extendedCost ?? null,
          // ---------------------------------------------------------------
          // "Is this part costed?" comes from the report's own `costed` flag and
          // must NOT be inferred from the number. The report sends
          // extendedCost: 0 for a part with no cost record, and a part can also
          // genuinely cost $0.00 — the imported Bosch BOM has both: 40 parts the
          // source never priced, plus one "Braze Ring" that really is zero.
          // Reading 0 as "uncosted" would merge those two facts, and rendering
          // an uncosted part as "$0.00" asserts it is free, which is a different
          // and false claim. Same reasoning as the importer's refusal to write a
          // row of zeros.
          // ---------------------------------------------------------------
          costed: costing?.costed === true,
          // The only derived figure in the grid, and it's a plain multiplication
          // of two stored columns rather than a redefinition of anything.
          weightTotalG: blankish(part.weightG) ? null : part.weightG * part.quantity,
          // Precomputed once per part rather than per keystroke.
          haystack: [
            sub.name,
            part.partNo,
            part.name,
            part.description,
            part.material,
            part.primaryProcess,
            part.photoId,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        });
      }
    }
    return out;
  }, [teardown, costingByPart]);

  const moduleOptions = useMemo(() => distinct(rows, (r) => r.moduleName), [rows]);
  const materialOptions = useMemo(() => distinct(rows, (r) => r.part.material), [rows]);
  const processOptions = useMemo(() => distinct(rows, (r) => r.part.primaryProcess), [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const terms = needle ? needle.split(/\s+/) : [];
    return rows.filter((r) => {
      // Every term must appear somewhere — so "sheet cabinet" narrows rather than
      // widening, which is what anyone typing two words expects.
      if (terms.length && !terms.every((t) => r.haystack.includes(t))) return false;
      if (moduleFilter && r.moduleName !== moduleFilter) return false;
      if (materialFilter && r.part.material !== materialFilter) return false;
      if (processFilter && r.part.primaryProcess !== processFilter) return false;
      // "Uncosted" means the part has no cost record at all. Costs being
      // unavailable wholesale (a failed report) is a different thing and must not
      // make every part look uncosted, so the filter is inert in that case.
      if (uncostedOnly && (costsUnavailable || r.costed)) return false;
      if (noPhotoIdOnly && !blankish(r.part.photoId)) return false;
      return true;
    });
  }, [
    rows,
    search,
    moduleFilter,
    materialFilter,
    processFilter,
    uncostedOnly,
    noPhotoIdOnly,
    costsUnavailable,
  ]);

  const sorted = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
    const primary = compareBy(column, sort.direction);
    // Stable secondary ordering, so rows with equal sort keys don't shuffle
    // between renders — sorting by Module alone would otherwise leave 29 Cabinet
    // parts in arbitrary order.
    const byName = compareBy(COLUMNS[2], 'asc');
    return [...filtered].sort((a, b) => primary(a, b) || byName(a, b));
  }, [filtered, sort]);

  /** Footer aggregates over the VISIBLE rows only. Never the product total. */
  const visibleTotals = useMemo(
    () => ({
      partUnits: sorted.reduce((s, r) => s + (r.part.quantity ?? 0), 0),
      weightG: sorted.reduce((s, r) => s + (r.weightTotalG ?? 0), 0),
      cost: sorted.reduce((s, r) => s + (r.costed ? (r.extendedCost ?? 0) : 0), 0),
      uncosted: sorted.filter((r) => !r.costed).length,
    }),
    [sorted],
  );

  const filtering =
    Boolean(search.trim()) ||
    Boolean(moduleFilter) ||
    Boolean(materialFilter) ||
    Boolean(processFilter) ||
    uncostedOnly ||
    noPhotoIdOnly;

  const clearFilters = () => {
    setSearch('');
    setModuleFilter('');
    setMaterialFilter('');
    setProcessFilter('');
    setUncostedOnly(false);
    setNoPhotoIdOnly(false);
  };

  const onSort = (key) =>
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : // A new column starts ascending for text and DESCENDING for numbers:
          // clicking "Ext cost" almost always means "what are the big ones".
          { key, direction: COLUMNS.find((c) => c.key === key)?.numeric ? 'desc' : 'asc' },
    );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="font-medium">No parts to show</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          This teardown has no parts yet. Switch to <strong>Teardown View</strong> to add modules
          and parts, or import a BOM from the repository.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ---- controls ---- */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="bom-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <Input
              id="bom-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Part number, name, material, process, Photo ID…"
              aria-label="Search the engineering BOM"
            />
          </div>
          <FilterSelect
            id="bom-module"
            label="Module"
            value={moduleFilter}
            onChange={setModuleFilter}
            options={moduleOptions}
            allLabel="All modules"
          />
          <FilterSelect
            id="bom-material"
            label="Material"
            value={materialFilter}
            onChange={setMaterialFilter}
            options={materialOptions}
            allLabel="All materials"
          />
          <FilterSelect
            id="bom-process"
            label="Primary process"
            value={processFilter}
            onChange={setProcessFilter}
            options={processOptions}
            allLabel="All processes"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="bom-uncosted"
              checked={uncostedOnly}
              onCheckedChange={setUncostedOnly}
              disabled={costsUnavailable}
            />
            <Label htmlFor="bom-uncosted" className="font-normal">
              Uncosted parts only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="bom-nophoto" checked={noPhotoIdOnly} onCheckedChange={setNoPhotoIdOnly} />
            <Label htmlFor="bom-nophoto" className="font-normal">
              Missing Photo ID only
            </Label>
          </div>
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 size-4" />
              Clear filters
            </Button>
          )}
        </div>

        {/* Always shown, filtering or not — a count that only appears once you
            filter leaves the reader guessing whether the list is complete. */}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filtering ? (
            <>
              Showing <span className="font-semibold text-foreground">{sorted.length}</span> of{' '}
              <span className="font-semibold text-foreground">{rows.length}</span> part lines
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">{rows.length}</span> part lines across{' '}
              <span className="font-semibold text-foreground">{moduleOptions.length}</span> modules
            </>
          )}
        </p>
      </div>

      {/* ---- the grid ---- */}
      {sorted.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="font-medium">No parts match these filters</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Try a broader search, or clear the filters to see all {rows.length} part lines.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            {/* Sticky header: the imported BOMs run to 100+ lines, and a header
                that scrolls away makes ten columns of numbers unreadable. */}
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-8" />
                {COLUMNS.map((column) => (
                  <SortHeader
                    key={column.key}
                    column={column}
                    sort={sort}
                    onSort={onSort}
                    className={column.numeric ? 'text-right' : undefined}
                  />
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {sorted.map((row) => {
                const { part } = row;
                const expanded = expandedParts.has(part.id);
                return (
                  // A keyed Fragment, because a row can render TWO <tr>s (itself
                  // plus its detail) and React needs the key on the thing the map
                  // returns, not on its children.
                  <Fragment key={part.id}>
                    <TableRow className="cursor-pointer" onClick={() => onTogglePart(part.id)}>
                      <TableCell className="w-8 align-top">
                        {expanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </TableCell>

                      {/* Requirement 4: the module travels on every row, so the
                          hierarchy is never lost even when sorted by cost. */}
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="outline" className="font-normal">
                          {row.moduleName}
                        </Badge>
                      </TableCell>

                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {part.partNo ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      <TableCell className="min-w-64 max-w-md">
                        <span className="font-medium">{part.name}</span>
                        {part.description && (
                          <span
                            className="block truncate text-xs text-muted-foreground"
                            title={part.description}
                          >
                            {part.description}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {part.material ?? '—'}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {part.primaryProcess ?? '—'}
                      </TableCell>

                      <TableCell className="text-right tabular-nums">{part.quantity}</TableCell>

                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatGrams(part.weightG)}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatGrams(row.weightTotalG)}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {costsUnavailable || !row.costed
                          ? '—'
                          : formatCurrency(row.unitCost, currency)}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {costsUnavailable || !row.costed
                          ? '—'
                          : formatCurrency(row.extendedCost, currency)}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        {part.photoId ? (
                          <Badge variant="secondary" className="font-mono text-xs">
                            {part.photoId}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {expanded && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell />
                        {/* Every data column, so the panel gets the full width. */}
                        <TableCell colSpan={COLUMNS.length} className="py-4">
                          <PartDetailPanel
                            part={part}
                            costing={row.costing}
                            costsUnavailable={costsUnavailable}
                            onPartUpdated={onPartUpdated}
                            onPartDeleted={onPartDeleted}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>

            {/* Aggregates over what's on screen. Called a SUBTOTAL, and said to be
                of the filtered selection, precisely so it can never be mistaken
                for the product total in the card above. */}
            <TableFooter>
              <TableRow>
                <TableCell />
                <TableCell colSpan={5} className="font-medium">
                  {filtering ? 'Filtered subtotal' : 'Total'}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {formatCount(sorted.length)} part{sorted.length === 1 ? '' : ' lines'}
                    {visibleTotals.uncosted > 0 && !costsUnavailable && (
                      <> · {visibleTotals.uncosted} uncosted</>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(visibleTotals.partUnits)}
                </TableCell>
                <TableCell />
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {formatGrams(visibleTotals.weightG)}
                </TableCell>
                <TableCell />
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {costsUnavailable ? '—' : formatCurrency(visibleTotals.cost, currency)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
