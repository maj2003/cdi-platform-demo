// ---------------------------------------------------------------------------
// src/pages/reports/BestOfBestReport.jsx — route /intelligence/best-of-best
//
// Slide 2 of the reference deck: module-level winners across designs, four ways.
//
//   Cost · Part Count · Weight · Assembly Time
//   Module | Design A | Design B | Design C | BoB | Gap
//
// ---------------------------------------------------------------------------
// THREE OF THESE FOUR TABLES ARE REAL
//
// Cost, part count and weight all come from /api/reports/best-of-best — the same
// endpoint the existing leaderboard page uses, so the two cannot disagree about who
// wins a module. Nothing is recomputed here: the service is the single definition of
// a module total, and a second one in the browser is how two screens start telling
// different stories about the same BOM.
//
// Assembly time is NOT in this schema. It is a time-and-motion output, and the
// capture station measures dimensions and mass rather than duration. It is rendered
// from the reference deck's figures with an Illustrative notice on it — the same
// rule the rest of the app follows.
//
// ---------------------------------------------------------------------------
// GAP IS SPREAD-TO-NEXT-BEST, AND PARTIAL COVERAGE IS DISCLOSED
//
// "Gap" is what the winner beats the RUNNER-UP by, not the range across all designs:
// the actionable number is what it would cost to match the best, not the distance
// between the best and the worst.
//
// A module that only some designs carry is flagged. Comparing a coil module three
// designs have against one that a fourth simply does not is a comparison of
// different things, and a Best-of-Best composite built from it silently understates
// the target — which is exactly the trap the existing Best-of-Best page documents.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';

import api from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { ASSEMBLY_TIME_SEC } from '@/lib/reportSampleData';
import { designLabel, useReportSelection } from '@/lib/reportSelection';
import { useApi } from '@/lib/useApi';
import {
  IllustrativeNotice,
  InsightBanner,
  LiveDataNotice,
  SlideFrame,
  SlideTable,
} from '@/components/reports/slide/SlideKit';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Turn one metric into a Module × Design table with BoB and Gap.
 *
 * `valueOf(entry)` pulls the metric off a moduleLeaders entry; lower always wins on
 * all four of these metrics, which is why there is no direction flag.
 */
function buildTable(moduleLeaders, ids, valueOf, format) {
  const rows = [];
  const bobTotals = { total: 0, known: true };
  const designTotals = new Map(ids.map((id) => [id, { sum: 0, complete: true }]));
  let partial = 0;

  for (const mod of moduleLeaders ?? []) {
    const byProduct = new Map((mod.entries ?? []).map((e) => [e.productId, valueOf(e)]));
    const present = ids.map((id) => byProduct.get(id)).filter((v) => v !== undefined && v !== null);
    if (present.length === 0) continue;

    const sorted = [...present].sort((a, b) => a - b);
    const best = sorted[0];
    const runnerUp = sorted.length > 1 ? sorted[1] : null;
    const gap = runnerUp === null ? null : runnerUp - best;
    if (present.length < ids.length) partial += 1;

    const cells = { module: mod.module };
    for (const id of ids) {
      const v = byProduct.get(id);
      cells[`d${id}`] = v === undefined || v === null
        ? '—'
        : { value: format(v), highlight: v === best ? 'win' : null };
      const t = designTotals.get(id);
      if (v === undefined || v === null) t.complete = false;
      else t.sum += v;
    }
    cells.bob = format(best);
    cells.gap = gap === null ? '—' : { value: format(gap), highlight: 'gap' };
    bobTotals.total += best;

    rows.push({ key: mod.module, cells });
  }

  // The totals row. A design missing a module gets its total marked incomplete
  // rather than shown as a smaller number that looks like an advantage.
  const totalCells = { module: 'Total' };
  for (const id of ids) {
    const t = designTotals.get(id);
    totalCells[`d${id}`] = t.complete ? format(t.sum) : `${format(t.sum)}*`;
  }
  totalCells.bob = format(bobTotals.total);
  const bestDesignTotal = Math.min(
    ...ids.map((id) => designTotals.get(id).sum).filter((n) => Number.isFinite(n)),
  );
  totalCells.gap = Number.isFinite(bestDesignTotal)
    ? { value: format(bestDesignTotal - bobTotals.total), highlight: 'gap' }
    : '—';
  rows.push({ key: '__total', cells: totalCells, emphasis: 'total' });

  return { rows, partial, anyIncomplete: [...designTotals.values()].some((t) => !t.complete) };
}

function Section({ title, columns, table, footnote, notice }) {
  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold" style={{ color: '#1f2a63' }}>{title}</h3>
      {notice}
      <SlideTable columns={columns} rows={table.rows} caption={title} />
      <p className="text-[11px]" style={{ color: '#7a839f' }}>
        {footnote}
        {table.anyIncomplete && ' · * total covers only the modules this design carries'}
      </p>
    </div>
  );
}

export default function BestOfBestReport() {
  const { data: products } = useApi(({ signal }) => api.products.list({ signal }), []);
  const { ids, selected } = useReportSelection(products);
  const idsKey = ids.join(',');

  const { data: bob, loading, error } = useApi(
    ({ signal }) => api.reports.bestOfBest(idsKey.split(',').map(Number), { signal }),
    [idsKey],
    { enabled: ids.length >= 2, keepPreviousData: true },
  );

  const currency = bob?.currency ?? 'USD';

  const columns = useMemo(() => ([
    { key: 'module', label: 'Module', width: '16rem' },
    ...selected.map((p) => ({ key: `d${p.id}`, label: designLabel(p), align: 'right' })),
    { key: 'bob', label: 'BoB', align: 'right' },
    { key: 'gap', label: 'Gap', align: 'right' },
  ]), [selected]);

  const cost = useMemo(
    () => buildTable(bob?.moduleLeaders, ids, (e) => e.cost, (v) => formatCurrency(v, currency)),
    [bob, ids, currency],
  );
  const partCount = useMemo(
    () => buildTable(bob?.moduleLeaders, ids, (e) => e.partLines, (v) => String(v)),
    [bob, ids],
  );
  const weight = useMemo(
    () => buildTable(bob?.moduleLeaders, ids, (e) => e.weightG / 1000, (v) => v.toFixed(1)),
    [bob, ids],
  );

  // Assembly time has no product dimension in the source deck — it is Design A/B/C.
  // Mapped onto the FIRST THREE selected designs by position and labelled as such,
  // rather than pretending the figures belong to those specific units.
  const timeColumns = useMemo(() => ([
    { key: 'module', label: 'Module', width: '16rem' },
    ...selected.slice(0, 3).map((p, i) => ({
      key: `t${i}`, label: `${designLabel(p)}`, align: 'right',
    })),
    { key: 'bob', label: 'Best of Best', align: 'right' },
  ]), [selected]);

  const timeRows = useMemo(() => {
    const cols = Math.min(3, selected.length);
    if (cols === 0) return [];
    const rows = ASSEMBLY_TIME_SEC.map((m) => {
      const vals = [m.a, m.b, m.c].slice(0, cols);
      const best = Math.min(...vals);
      const cells = { module: m.module };
      vals.forEach((v, i) => {
        cells[`t${i}`] = { value: String(v), highlight: v === best ? 'win' : null };
      });
      cells.bob = String(best);
      return { key: m.module, cells };
    });
    const totals = { module: 'Total (sec)' };
    for (let i = 0; i < cols; i += 1) {
      totals[`t${i}`] = String(ASSEMBLY_TIME_SEC.reduce((s, m) => s + [m.a, m.b, m.c][i], 0));
    }
    totals.bob = String(
      ASSEMBLY_TIME_SEC.reduce((s, m) => s + Math.min(...[m.a, m.b, m.c].slice(0, cols)), 0),
    );
    rows.push({ key: '__total', cells: totals, emphasis: 'total' });
    return rows;
  }, [selected]);

  if (ids.length < 2) {
    return (
      <SlideFrame title="Best-of-Best Comparison" subtitle="Module-level winners across designs.">
        <Alert>
          <AlertTitle className="text-sm">At least two designs are needed</AlertTitle>
          <AlertDescription className="text-xs">
            Best-of-Best compares module totals between designs, so a single teardown has
            nothing to be best of.
          </AlertDescription>
        </Alert>
      </SlideFrame>
    );
  }

  if (error) {
    return (
      <SlideFrame title="Best-of-Best Comparison">
        <Alert variant="destructive">
          <AlertTitle>Could not load the comparison</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </SlideFrame>
    );
  }

  if (loading && !bob) {
    return (
      <SlideFrame title="Best-of-Best Comparison">
        <div className="space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      </SlideFrame>
    );
  }

  const composite = bob?.composite;
  const dearest = Math.max(...(bob?.products ?? []).map((p) => p.totalCost));
  const bobSaving = Number.isFinite(dearest) && composite
    ? dearest - composite.totalCost
    : null;

  return (
    <SlideFrame
      kicker="Benchmarking"
      title="Best-of-Best Comparison"
      subtitle={`Module-level winners across ${selected.length} designs — the composite target you would hit by taking the best version of every module from whichever design builds it best.`}
      banner={
        bobSaving !== null ? (
          <InsightBanner
            headline={{
              value: formatCurrency(bobSaving, currency),
              label: 'Best-of-Best cost-down vs the dearest design, per unit',
            }}
          >
            Taking the cheapest version of every module gives a composite BOM of{' '}
            <strong>{formatCurrency(composite.totalCost, currency)}</strong> at{' '}
            <strong>{composite.totalWeightKg.toFixed(1)} kg</strong> across{' '}
            {composite.moduleCount} modules. The Gap column is what each module's winner beats
            the runner-up by — the cost of matching the best, module by module.
          </InsightBanner>
        ) : null
      }
    >
      <LiveDataNotice>
        Cost, part count and weight are computed from the live teardown data by the same
        Best-of-Best service the leaderboard page uses. Green marks the best value in each row.
      </LiveDataNotice>

      <Section
        title="Cost Benchmarking — Best-of-Best Comparison"
        columns={columns}
        table={cost}
        footnote="Green = lowest cost of the compared designs · BoB = Best of Best · Gap = spread to next-lowest"
      />
      <Section
        title="Part Count Benchmarking — Best-of-Best Comparison"
        columns={columns}
        table={partCount}
        footnote="Green = fewest part lines · BoB = Best of Best · Gap = spread to next-lowest"
      />
      <Section
        title="Weight Benchmarking — Best-of-Best Comparison"
        columns={columns}
        table={weight}
        footnote="kg per unit · Green = lightest design · BoB = Best of Best · Gap = spread to next-lowest"
      />
      <Section
        title="Assembly Time — Best-of-Best Comparison"
        columns={timeColumns}
        table={{ rows: timeRows, anyIncomplete: false }}
        notice={
          <IllustrativeNotice>
            Assembly time is a time-and-motion study output and is not recorded anywhere in this
            schema — the capture station measures dimensions and mass, not duration. These
            seconds are the reference deck's figures, shown against the first three selected
            designs by position. Every other table on this page is live.
          </IllustrativeNotice>
        }
        footnote="Seconds per module · Green = fastest of the compared designs"
      />

      {cost.partial > 0 && (
        <Alert>
          <AlertTitle className="text-sm">
            {cost.partial} module{cost.partial === 1 ? '' : 's'} are not carried by every design
          </AlertTitle>
          <AlertDescription className="text-xs">
            Those rows are compared across the designs that have them, and a design missing a
            module gets a starred total. A composite built without noting this understates the
            target, because it credits a design for a module it simply does not have.
          </AlertDescription>
        </Alert>
      )}
    </SlideFrame>
  );
}
