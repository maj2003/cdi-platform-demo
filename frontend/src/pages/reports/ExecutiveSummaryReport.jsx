// ---------------------------------------------------------------------------
// src/pages/reports/ExecutiveSummaryReport.jsx — route /intelligence/executive
//
// Slide 1 of the reference deck: the page an executive sees first.
//
//   Executive Summary
//   Daikin Comforts AHU — Design / Cost Optimization Opportunities
//   [ 13 ideas ] [ weight ] [ fasteners ] [ parts ] [ saving ]
//   Idea · Subsystem · Design Change · Primary Benefit   (13 rows)
//
// ---------------------------------------------------------------------------
// WHY THE KPI CARDS ARE SUMMED FROM THE TABLE
//
// The reference deck's headline cards do not add up to its own thirteen-row table —
// see the note in lib/reportSampleData.js. Restating them above a table that sums to
// something else produces a page that fails the moment somebody adds the column up,
// in front of the audience least forgiving of it. So the cards are computed from the
// rows, and the footnote says so. Add an idea and the headline moves with it.
//
// ---------------------------------------------------------------------------
// WHAT IS REAL ON THIS PAGE
//
// The scope line is: the ideas are illustrative, the study context is live. The
// count of teardowns the study covers, and their names, come from the repository —
// so the page is honest that thirteen worked ideas are being shown against four real
// competitor BOMs, rather than implying the ideas came out of them.
// ---------------------------------------------------------------------------

import { DECK } from '@/components/reports/slide/deckTheme';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import api from '@/lib/api';
import { formatCount } from '@/lib/format';
import { ideaTotals, OPTIMISATION_IDEAS, SAVING_PER_PRODUCT_USD } from '@/lib/reportSampleData';
import { useApi } from '@/lib/useApi';
import {
  IllustrativeNotice,
  InsightBanner,
  KpiCard,
  KpiRow,
  SlideFrame,
  SlideTable,
} from '@/components/reports/slide/SlideKit';
import AhuSilhouette from '@/components/AhuSilhouette';

const COLUMNS = [
  { key: 'n', label: '#', align: 'center', width: '3rem' },
  { key: 'idea', label: 'Idea' },
  { key: 'subsystem', label: 'Subsystem', width: '15rem' },
  { key: 'change', label: 'Design Change' },
  { key: 'benefit', label: 'Primary Benefit', width: '15rem' },
];

export default function ExecutiveSummaryReport() {
  const { data: products } = useApi(({ signal }) => api.products.list({ signal }), []);

  const totals = useMemo(() => ideaTotals(), []);

  const rows = OPTIMISATION_IDEAS.map((i) => ({
    key: i.n,
    cells: {
      n: i.n,
      idea: i.idea,
      subsystem: i.subsystem,
      change: i.change,
      // The benefit is the row's payload, so it is the one cell that carries the
      // deck's green — the same treatment a winning value gets elsewhere.
      benefit: { value: i.benefit, highlight: 'win' },
    },
  }));

  const studied = (products ?? []).length;

  return (
    <SlideFrame
      kicker="Product Evaluation Summary"
      title="Executive Summary"
      subtitle="Daikin Comforts AHU — Design / Cost Optimization Opportunities. Detailed competitive product study considering eBOM, design observations and cost benchmarking."
      footnote="KPI figures are the sum of the itemised ideas below, so the headline and the table always reconcile. Benefit column shows the primary saving per idea."
      banner={
        <InsightBanner headline={{ value: `$${SAVING_PER_PRODUCT_USD}`, label: 'Potential saving per product' }}>
          Thirteen design changes across the cabinet, coil, blower, filtration and electrical
          modules remove <strong>{(totals.weightG / 1000).toFixed(2)} kg</strong>,{' '}
          <strong>{totals.fasteners} fasteners</strong> and <strong>{totals.parts} parts</strong> per
          unit with no change in function — the priority design-simplification levers surfaced by
          the benchmarking application.
        </InsightBanner>
      }
    >
      <IllustrativeNotice>
        The thirteen optimisation ideas and the saving-per-product figure are a worked example
        from the design reference, not an output of this repository. The study context below is
        live: {studied > 0 ? `${formatCount(studied)} competitor teardowns` : 'the teardowns'} in
        the repository. <Link to="/intelligence/best-of-best" className="underline">Best-of-Best</Link>{' '}
        and <Link to="/intelligence/material" className="underline">Material &amp; Commodity</Link>{' '}
        are built from that live data.
      </IllustrativeNotice>

      <KpiRow>
        <KpiCard value={totals.ideas} label="Ideas Identified" />
        <KpiCard value={`~${(totals.weightG / 1000).toFixed(1)} kg`} label="Weight Reduction Potential" />
        <KpiCard value={totals.fasteners} label="Potential Fasteners Reduction" />
        <KpiCard value={totals.parts} label="Part Count Reduction" />
        <KpiCard
          value={`$${SAVING_PER_PRODUCT_USD}`}
          label="Potential Saving Per Product"
          caveat="reference figure"
        />
      </KpiRow>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <SlideTable
          columns={COLUMNS}
          rows={rows}
          caption="Design and cost optimisation opportunities by subsystem"
        />

        {/* The unit the study is about. A schematic rather than a photo, for the
            reason given in AhuSilhouette: there are no unit photographs in this
            build, and stock imagery of one manufacturer's cabinet next to another's
            cost data would be a claim we cannot support. */}
        <aside
          className="flex flex-col items-center justify-center gap-3 rounded-lg border p-4"
          style={{ borderColor: DECK.rule, background: DECK.zebra }}
        >
          <AhuSilhouette className="h-44 w-auto text-[#9aa4c0]" />
          <p className="text-center text-xs" style={{ color: '#7a839f' }}>
            Daikin Comforts AHU — representative teardown unit
          </p>
          {studied > 0 && (
            <p className="text-center text-xs" style={{ color: '#7a839f' }}>
              Benchmarked against {formatCount(studied)} competitor teardowns
            </p>
          )}
        </aside>
      </div>
    </SlideFrame>
  );
}
