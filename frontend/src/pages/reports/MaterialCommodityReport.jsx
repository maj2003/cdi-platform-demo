// ---------------------------------------------------------------------------
// src/pages/reports/MaterialCommodityReport.jsx — route /intelligence/material
//
// Slide 3 of the reference deck: commodity-level cost, weight and part breakdown
// across designs — the fact base for material-selection and design-choice decisions.
//
//   Commodity | Design A (Parts Wt Cost) | Design B (…) | Design C (…) | Cost Contribution
//
// ---------------------------------------------------------------------------
// THIS ONE IS BUILT FROM THE REAL BOMs
//
// Every figure on this page is an aggregation of actual parts. The eight commodity
// rows are the deck's taxonomy; each real part is classified into one of them by
// lib/commodityGroups.js, which reads material first, then the importer's commodity
// column, then the part name.
//
// Cost comes from the COST REPORT, not from the part rows — extended cost is the
// benchmark service's definition, and recomputing it here is how two screens start
// disagreeing about the same BOM. Weight is summed from the parts with quantity
// applied, because a commodity row is about how much of that material is in the unit,
// not how many distinct line items mention it.
//
// ---------------------------------------------------------------------------
// WHAT DOESN'T FIT IS REPORTED, NOT HIDDEN
//
// A commodity table whose rows do not add up to the BOM total is a table that will
// be quoted wrongly. Parts the classifier cannot place are counted and named rather
// than folded into whichever row is closest, so the totals still reconcile with the
// teardown and the gap is visible.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';

import api, { PERSONAS } from '@/lib/api';
import { COMMODITY_GROUPS, rollUpByCommodity } from '@/lib/commodityGroups';
import { formatCurrency } from '@/lib/format';
import { designLabel, useReportSelection } from '@/lib/reportSelection';
import { useApi } from '@/lib/useApi';
import {
  InsightBanner,
  LiveDataNotice,
  ShareBar,
  SlideFrame,
  SlideTable,
} from '@/components/reports/slide/SlideKit';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

/** Every teardown and cost report for the selected designs, in one hook. */
function useDesignData(ids) {
  const key = ids.join(',');
  return useApi(
    async ({ signal }) => {
      const list = key ? key.split(',').map(Number) : [];
      // Concurrent: these are independent GETs, and a report that takes N times as
      // long to assemble for no reason is just a slower report.
      return Promise.all(
        list.map(async (id) => {
          const [teardown, cost] = await Promise.all([
            api.products.teardown(id, { signal }),
            api.reports.get(id, PERSONAS.COST_ENGINEER, { signal }).catch(() => null),
          ]);
          return { id, teardown, cost };
        }),
      );
    },
    [key],
    { enabled: ids.length > 0, keepPreviousData: true },
  );
}

export default function MaterialCommodityReport() {
  const { data: products } = useApi(({ signal }) => api.products.list({ signal }), []);
  const { ids, selected } = useReportSelection(products);
  const { data: designs, loading, error } = useDesignData(ids);

  const analysis = useMemo(() => {
    if (!designs?.length) return null;
    const byDesign = designs.map((d) => {
      const parts = (d.teardown?.subAssemblies ?? []).flatMap((s) => s.parts);
      const byPart = d.cost?.payload?.byPart ?? [];
      const costByPartId = new Map(
        byPart.filter((r) => r.costed !== false).map((r) => [r.partId, r.extendedCost]),
      );
      return { id: d.id, teardown: d.teardown, ...rollUpByCommodity(parts, costByPartId) };
    });
    // Cost contribution is a share of the WHOLE compared set, not of one design —
    // the question the column answers is "where does the money sit across these
    // units", which is what makes it a material-selection lever.
    const grandCost = byDesign.reduce((s, d) => s + d.totals.cost, 0);
    return { byDesign, grandCost };
  }, [designs]);

  const currency = 'USD';

  const groups = useMemo(() => ([
    { label: 'Commodity', rowSpan: 2 },
    ...selected.map((p) => ({ label: designLabel(p), span: 3 })),
    { label: 'Cost Contribution', rowSpan: 2 },
  ]), [selected]);

  // `spanned` on the first and last: their headers are the rowSpan=2 cells in the
  // group row above, so they must not emit a second header cell — see SlideKit.
  const columns = useMemo(() => ([
    { key: 'commodity', label: '', width: '13rem', spanned: true },
    ...selected.flatMap((p) => ([
      { key: `p${p.id}`, label: 'Parts', align: 'right' },
      { key: `w${p.id}`, label: 'Wt kg', align: 'right' },
      { key: `c${p.id}`, label: 'Cost $', align: 'right' },
    ])),
    { key: 'share', label: '', width: '10rem', spanned: true },
  ]), [selected]);

  const rows = useMemo(() => {
    if (!analysis) return [];
    const out = COMMODITY_GROUPS.map((g, gi) => {
      const perDesign = analysis.byDesign.map((d) => d.rows[gi]);
      const costs = perDesign.map((r) => r.cost).filter((c) => c > 0);
      const cheapest = costs.length ? Math.min(...costs) : null;
      const cells = { commodity: g.label };
      analysis.byDesign.forEach((d, i) => {
        const r = perDesign[i];
        cells[`p${d.id}`] = r.parts || '—';
        cells[`w${d.id}`] = r.weightG ? (r.weightG / 1000).toFixed(1) : '—';
        cells[`c${d.id}`] = r.cost > 0
          ? { value: formatCurrency(r.cost, currency), highlight: r.cost === cheapest ? 'win' : null }
          : '—';
      });
      const groupCost = perDesign.reduce((s, r) => s + r.cost, 0);
      const pct = analysis.grandCost > 0 ? (groupCost / analysis.grandCost) * 100 : 0;
      cells.share = <ShareBar pct={pct} />;
      return { key: g.key, cells };
    });

    const totals = { commodity: 'BOM Total' };
    analysis.byDesign.forEach((d) => {
      totals[`p${d.id}`] = d.totals.parts;
      totals[`w${d.id}`] = (d.totals.weightG / 1000).toFixed(1);
      totals[`c${d.id}`] = formatCurrency(d.totals.cost, currency);
    });
    totals.share = <ShareBar pct={100} />;
    out.push({ key: '__total', cells: totals, emphasis: 'total' });
    return out;
  }, [analysis, currency]);

  if (error) {
    return (
      <SlideFrame title="Material &amp; Commodity Benchmarking">
        <Alert variant="destructive">
          <AlertTitle>Could not load the commodity breakdown</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </SlideFrame>
    );
  }
  if ((loading && !designs) || !analysis) {
    return (
      <SlideFrame title="Material &amp; Commodity Benchmarking">
        <Skeleton className="h-96" />
      </SlideFrame>
    );
  }

  const unplaced = analysis.byDesign.reduce((s, d) => s + d.unclassified.parts, 0);
  const uncosted = analysis.byDesign.reduce((s, d) => s + d.totals.uncosted, 0);
  // The biggest commodity across the set — the headline lever.
  const leader = COMMODITY_GROUPS
    .map((g, gi) => ({
      label: g.label,
      cost: analysis.byDesign.reduce((s, d) => s + d.rows[gi].cost, 0),
    }))
    .sort((a, b) => b.cost - a.cost)[0];
  const leaderPct = analysis.grandCost > 0 ? (leader.cost / analysis.grandCost) * 100 : 0;
  const cheapestDesign = [...analysis.byDesign].sort((a, b) => a.totals.cost - b.totals.cost)[0];
  const dearestDesign = [...analysis.byDesign].sort((a, b) => b.totals.cost - a.totals.cost)[0];
  const spread = dearestDesign.totals.cost - cheapestDesign.totals.cost;

  return (
    <SlideFrame
      kicker="Benchmarking"
      title="Material &amp; Commodity Benchmarking"
      subtitle="Commodity-level cost, weight and part breakdown across candidate designs — the fact base for material-selection and design-choice decisions."
      footnote="Green = lowest cost for that commodity across the compared designs · Cost contribution is the commodity's share of total BOM cost across the whole set · Weight includes quantity"
      banner={
        <InsightBanner
          headline={{ value: formatCurrency(spread, currency), label: 'BOM cost spread across the set' }}
        >
          <strong>{leader.label}</strong> carries {leaderPct.toFixed(0)}% of total BOM cost across
          these {analysis.byDesign.length} designs — the primary lever for material substitution
          and design simplification. {designLabel(products?.find((p) => p.id === cheapestDesign.id))}{' '}
          has the lowest BOM at {formatCurrency(cheapestDesign.totals.cost, currency)}.
        </InsightBanner>
      }
    >
      <LiveDataNotice>
        Aggregated from the live teardown data — every part in each BOM classified into the eight
        commodity groups by material, then the importer's commodity column, then part name. Costs
        are read from each design's cost report, not recomputed here.
      </LiveDataNotice>

      <SlideTable
        groups={groups}
        columns={columns}
        rows={rows}
        caption="Commodity breakdown by design"
      />

      {(unplaced > 0 || uncosted > 0) && (
        <Alert>
          <AlertTitle className="text-sm">What the rows do not cover</AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            {unplaced > 0 && (
              <p>
                <strong>{unplaced} part{unplaced === 1 ? '' : 's'}</strong> could not be classified
                into a commodity group and are counted in the BOM total but in no row —{' '}
                {analysis.byDesign
                  .flatMap((d) => d.unclassified.names)
                  .slice(0, 4)
                  .map((n) => `"${n}"`)
                  .join(', ')}
                . They are shown here rather than folded into the nearest row, so the totals still
                reconcile with the teardown.
              </p>
            )}
            {uncosted > 0 && (
              <p>
                <strong>{uncosted} part{uncosted === 1 ? '' : 's'}</strong> carry no cost in the
                source data. They count toward parts and weight but contribute nothing to cost —
                deliberately not treated as $0.00, which is a real price one part in this
                repository genuinely has.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </SlideFrame>
  );
}
