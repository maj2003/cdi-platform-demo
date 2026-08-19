// ---------------------------------------------------------------------------
// src/pages/reports/PolymerOptimizationReport.jsx — route /intelligence/polymer
//
// Slide 4 of the reference deck: polymer weight distribution as a material
// optimisation *opportunity*, not a table.
//
//   grade table (7 grades × 3 designs, cost tier)   |   Optimization Opportunity
//                                                   |   PC-ABS -> HIPS
//                                                   |   ~$220K / year
//
// ---------------------------------------------------------------------------
// THE POINT OF THE PAGE IS ONE ROW
//
// Design A carries 9.7 kg of PC-ABS where the other two designs run near-zero. That
// single row is the finding; everything else is the context that makes it credible.
// So the row is flagged red, the callout states the substitution and the saving, and
// the layout puts the two side by side rather than making the reader hold a number
// from a table in their head while they read a paragraph underneath it.
//
// ---------------------------------------------------------------------------
// THIS PAGE IS ILLUSTRATIVE, AND SAYS SO TWICE
//
// The repository stores a free-text `material` per part — "PP", "PA6 + 30% GF",
// "FR-4 / Mixed" — not a polymer-grade weight breakdown. Deriving this table would
// mean re-characterising every plastic part by grade first, which is a materials
// engineering exercise and not a query.
//
// The live data DOES have something to say here, so the page says it: the real
// polymer tonnage per design, from the same classifier the commodity report uses, is
// shown underneath. That is the honest bridge — the shape of the opportunity is the
// deck's worked example, the mass of plastic actually in these units is measured.
// ---------------------------------------------------------------------------

import { DECK } from '@/components/reports/slide/deckTheme';
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';

import api, { PERSONAS } from '@/lib/api';
import { rollUpByCommodity } from '@/lib/commodityGroups';
import { formatCurrency } from '@/lib/format';
import { POLYMER_GRADES, POLYMER_OPPORTUNITY } from '@/lib/reportSampleData';
import { designLabel, useReportSelection } from '@/lib/reportSelection';
import { useApi } from '@/lib/useApi';
import {
  IllustrativeNotice,
  InsightBanner,
  LiveDataNotice,
  SlideFrame,
  SlideTable,
} from '@/components/reports/slide/SlideKit';
import { Skeleton } from '@/components/ui/skeleton';

const TIER_COLOUR = {
  Low: DECK.winText,
  Medium: '#a55a12',
  High: DECK.alertText,
};

const COLUMNS = [
  { key: 'grade', label: 'Polymer Grade', width: '12rem' },
  { key: 'a', label: 'Design A', align: 'center' },
  { key: 'b', label: 'Design B', align: 'center' },
  { key: 'c', label: 'Design C', align: 'center' },
  { key: 'tier', label: 'Cost Tier', align: 'center', width: '8rem' },
];

export default function PolymerOptimizationReport() {
  const { data: products } = useApi(({ signal }) => api.products.list({ signal }), []);
  const { ids, selected } = useReportSelection(products);
  const key = ids.join(',');

  // The measured counterpart: how much polymer is actually in each design.
  const { data: live } = useApi(
    async ({ signal }) => {
      const list = key ? key.split(',').map(Number) : [];
      return Promise.all(
        list.map(async (id) => {
          const [teardown, cost] = await Promise.all([
            api.products.teardown(id, { signal }),
            api.reports.get(id, PERSONAS.COST_ENGINEER, { signal }).catch(() => null),
          ]);
          const parts = (teardown?.subAssemblies ?? []).flatMap((s) => s.parts);
          const costByPartId = new Map(
            (cost?.payload?.byPart ?? [])
              .filter((r) => r.costed !== false)
              .map((r) => [r.partId, r.extendedCost]),
          );
          const roll = rollUpByCommodity(parts, costByPartId);
          const polymer = roll.rows.find((r) => r.key === 'polymer');
          return { id, polymer, totalWeightG: roll.totals.weightG, totalCost: roll.totals.cost };
        }),
      );
    },
    [key],
    { enabled: ids.length > 0, keepPreviousData: true },
  );

  const rows = useMemo(() => {
    const out = POLYMER_GRADES.map((g) => {
      const cells = {
        grade: g.grade,
        a: g.a.toFixed(1),
        b: g.b.toFixed(1),
        c: g.c.toFixed(1),
        tier: { value: g.tier },
      };
      return { key: g.grade, cells, emphasis: g.flagged ? 'alert' : undefined };
    });
    const t = POLYMER_GRADES.reduce(
      (acc, g) => ({ a: acc.a + g.a, b: acc.b + g.b, c: acc.c + g.c }),
      { a: 0, b: 0, c: 0 },
    );
    out.push({
      key: '__total',
      emphasis: 'total',
      cells: {
        grade: 'Total (kg / unit)',
        a: t.a.toFixed(1), b: t.b.toFixed(1), c: t.c.toFixed(1), tier: '',
      },
    });
    return out;
  }, []);

  const { annualSavingUsd, perUnitKg, from, to, rationale } = POLYMER_OPPORTUNITY;

  return (
    <SlideFrame
      kicker="Material Optimization Opportunity"
      title="Polymer Weight Distribution"
      subtitle="Benchmarking polymer usage by grade across designs to pinpoint high-cost material over-use and lower-cost substitution opportunities."
      footnote="Red = high-cost grade over-used in Design A · Cost tier by $/kg · kg per unit"
      banner={
        <InsightBanner>
          Switching <strong>{from.grade}</strong> to <strong>{to.grade}</strong> on high-volume
          plastic parts unlocks <strong>~${(annualSavingUsd / 1000).toFixed(0)}K / year</strong>{' '}
          with no performance trade-off — a priority material-substitution lever surfaced by the
          benchmarking application.
        </InsightBanner>
      }
    >
      <IllustrativeNotice>
        The polymer-grade breakdown and the ${(annualSavingUsd / 1000).toFixed(0)}K figure are a
        worked example from the design reference. This repository stores a free-text material per
        part, not a grade-level weight distribution, so deriving this table would need every
        plastic part re-characterised by grade first. The measured polymer mass in the live
        designs is shown below the table.
      </IllustrativeNotice>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <SlideTable columns={COLUMNS} rows={rows.map((r) => ({
          ...r,
          cells: {
            ...r.cells,
            // The tier is rendered as coloured text rather than a badge, matching the
            // reference: three tiers in a column of seven read better as a colour ramp
            // than as seven pills.
            tier: r.cells.tier?.value
              ? (
                <span style={{ color: TIER_COLOUR[r.cells.tier.value], fontWeight: 600 }}>
                  {r.cells.tier.value}
                </span>
              )
              : '',
          },
        }))} caption="Polymer weight by grade and design" />

        {/* ---- the opportunity callout ---- */}
        <aside className="overflow-hidden rounded-lg border" style={{ borderColor: DECK.rule }}>
          <div
            className="px-4 py-3 text-sm font-semibold text-white"
            style={{ background: `linear-gradient(90deg, ${DECK.navy} 0%, ${DECK.accent} 100%)` }}
          >
            Optimization Opportunity
          </div>
          <div className="space-y-4 p-5 text-center">
            <div className="flex items-center justify-center gap-3">
              <span
                className="flex-1 rounded-lg border px-3 py-3"
                style={{ borderColor: '#e8b4b0', background: DECK.alert }}
              >
                <span className="block text-lg font-semibold" style={{ color: DECK.alertText }}>
                  {from.grade}
                </span>
                <span className="block text-[11px]" style={{ color: DECK.alertText }}>
                  {from.note}
                </span>
              </span>
              <ArrowRight aria-hidden className="size-7 shrink-0" style={{ color: DECK.accent }} />
              <span
                className="flex-1 rounded-lg border px-3 py-3"
                style={{ borderColor: '#a9d5bb', background: DECK.win }}
              >
                <span className="block text-lg font-semibold" style={{ color: DECK.winText }}>
                  {to.grade}
                </span>
                <span className="block text-[11px]" style={{ color: DECK.winText }}>
                  {to.note}
                </span>
              </span>
            </div>

            <div>
              <p className="text-4xl font-semibold" style={{ color: DECK.accent }}>
                ~${(annualSavingUsd / 1000).toFixed(0)}K / year
              </p>
              <p className="text-xs" style={{ color: '#7a839f' }}>
                material cost-down at current volumes
              </p>
            </div>

            <p className="text-xs leading-relaxed" style={{ color: DECK.bodyText }}>
              ≈ {perUnitKg} kg of high-cost polymer removed per unit — {rationale}
            </p>
          </div>
        </aside>
      </div>

      {/* ---- the measured counterpart ---- */}
      {live?.length > 0 ? (
        <div className="space-y-2">
          <LiveDataNotice>
            Measured polymer content in the selected designs, from the same classifier the
            Material &amp; Commodity report uses. This is what the repository can actually say
            about plastic today.
          </LiveDataNotice>
          <SlideTable
            columns={[
              { key: 'design', label: 'Design', width: '18rem' },
              { key: 'parts', label: 'Polymer parts', align: 'right' },
              { key: 'weight', label: 'Polymer kg / unit', align: 'right' },
              { key: 'share', label: 'Share of unit mass', align: 'right' },
              { key: 'cost', label: 'Polymer cost', align: 'right' },
            ]}
            rows={live.map((d) => {
              const product = selected.find((p) => p.id === d.id);
              const kg = (d.polymer?.weightG ?? 0) / 1000;
              const share = d.totalWeightG > 0
                ? ((d.polymer?.weightG ?? 0) / d.totalWeightG) * 100
                : 0;
              return {
                key: d.id,
                cells: {
                  design: designLabel(product),
                  parts: d.polymer?.parts ?? 0,
                  weight: kg.toFixed(2),
                  share: `${share.toFixed(1)}%`,
                  cost: formatCurrency(d.polymer?.cost ?? 0, 'USD'),
                },
              };
            })}
            caption="Measured polymer content per design"
          />
        </div>
      ) : (
        <Skeleton className="h-32" />
      )}
    </SlideFrame>
  );
}
