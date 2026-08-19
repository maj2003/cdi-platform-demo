// ---------------------------------------------------------------------------
// src/lib/exportPptx.js — client-side .pptx export of a product's benchmark
// summary: title, executive summary, cost breakdown, and an optional
// comparison slide.
//
// Same builder + I/O-wrapper split as exportBom.js: buildBenchmarkDeck takes
// plain report data and returns a pptxgen instance; the download call is the
// only line that touches the browser.
//
// EVERY NUMBER ON THESE SLIDES IS READ, NOT COMPUTED. Total cost, weight,
// part count, the cost-breakdown chart, the top-line insight and the
// comparison deltas all come straight off the executive / cost-engineer /
// compare report payloads — the same numbers the Reports and Compare pages
// render. A second implementation of that arithmetic here is exactly the bug
// this app's two-fetch pattern exists to avoid (see ProductDetailPage.jsx's
// header comment).
// ---------------------------------------------------------------------------

import pptxgen from 'pptxgenjs';
import { PALETTE } from '@/lib/chartData';
import { formatCount, formatCurrency, formatWeight } from '@/lib/format';

// pptxgenjs wants hex without the leading '#'. Same blue as the baseline
// product's chart series and the app's --primary token (see index.css and
// chartData.js's PALETTE note) — one brand color, defined once, used
// everywhere, including here.
const ACCENT = PALETTE[0].replace('#', '').toUpperCase();
const INK = '1A1A1A';
const MUTED = '6B7280';
const FONT = 'Arial';

const SLIDE_W = 13.33; // pptx.layout = 'LAYOUT_WIDE' (13.33in x 7.5in)
const SLIDE_H = 7.5;
const MARGIN = 0.7;
const CONTENT_W = SLIDE_W - MARGIN * 2;

/** A thin accent bar plus the deck's small kicker label — the one recurring brand mark on every slide. */
function addHeader(slide, kicker, title) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.12, fill: { color: ACCENT } });
  slide.addText(kicker, {
    x: MARGIN, y: 0.4, w: CONTENT_W, h: 0.35,
    fontSize: 12, bold: true, color: ACCENT, fontFace: FONT, charSpacing: 1,
  });
  slide.addText(title, {
    x: MARGIN, y: 0.75, w: CONTENT_W, h: 0.6,
    fontSize: 26, bold: true, color: INK, fontFace: FONT,
  });
}

function addTitleSlide(pptx, teardown) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: ACCENT } });

  slide.addText('PRODUCT BENCHMARKING — TEARDOWN ANALYSIS', {
    x: MARGIN, y: 0.6, w: CONTENT_W, h: 0.4,
    fontSize: 13, bold: true, color: ACCENT, fontFace: FONT, charSpacing: 1,
  });
  slide.addText(teardown.name, {
    x: MARGIN, y: 2.9, w: CONTENT_W, h: 1.1,
    fontSize: 40, bold: true, color: INK, fontFace: FONT,
  });
  slide.addText(`${teardown.brand} · ${teardown.category}`, {
    x: MARGIN, y: 3.9, w: CONTENT_W, h: 0.5,
    fontSize: 18, color: MUTED, fontFace: FONT,
  });
  slide.addText(
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    {
      x: MARGIN, y: SLIDE_H - 0.9, w: CONTENT_W, h: 0.4,
      fontSize: 12, color: MUTED, fontFace: FONT,
    },
  );
  return slide;
}

/** One stat card: a big number over a small label — the exec-summary building block. */
function statCard(x, label, value) {
  return {
    label: {
      text: label.toUpperCase(),
      options: { x, y: 1.9, w: 2.7, h: 0.5, fontSize: 13, color: MUTED, fontFace: FONT },
    },
    value: {
      text: value,
      options: { x, y: 2.3, w: 2.7, h: 0.9, fontSize: 28, bold: true, color: INK, fontFace: FONT },
    },
  };
}

/**
 * @param {object} pptx
 * @param {object} executivePayload  api.reports.get(id, PERSONAS.EXECUTIVE) .payload
 */
function addExecutiveSummarySlide(pptx, executivePayload) {
  const slide = pptx.addSlide();
  addHeader(slide, 'EXECUTIVE SUMMARY', 'The numbers that matter');

  const { headline, currency, keyPoints } = executivePayload;
  const cards = [
    statCard(MARGIN, 'Total cost', formatCurrency(headline.totalCost, currency)),
    statCard(MARGIN + 3.1, 'Total weight', formatWeight(headline.totalWeightKg)),
    statCard(MARGIN + 6.2, 'Part units', formatCount(headline.partUnits)),
    statCard(MARGIN + 9.3, 'Cost / kg', formatCurrency(headline.costPerKg, currency)),
  ];
  for (const card of cards) {
    slide.addText(card.label.text, card.label.options);
    slide.addText(card.value.text, card.value.options);
  }

  // The top-line insight — the report's own first key point, verbatim.
  const insight = keyPoints?.[0];
  if (insight) {
    slide.addShape('rect', {
      x: MARGIN, y: 3.8, w: CONTENT_W, h: 1.2,
      fill: { color: 'F5F8FB' }, line: { color: ACCENT, width: 1 },
    });
    slide.addText(insight, {
      x: MARGIN + 0.3, y: 3.8, w: CONTENT_W - 0.6, h: 1.2,
      fontSize: 16, color: INK, fontFace: FONT, valign: 'middle', italic: true,
    });
  }

  // The rest of the key points, as supporting bullets.
  const rest = (keyPoints ?? []).slice(1);
  if (rest.length > 0) {
    slide.addText(
      rest.map((text) => ({ text, options: { bullet: true, breakLine: true, color: MUTED } })),
      { x: MARGIN, y: 5.2, w: CONTENT_W, h: 1.8, fontSize: 14, fontFace: FONT },
    );
  }
  return slide;
}

/**
 * @param {object} pptx
 * @param {object} executivePayload  for headlineChart (cost by sub-assembly, pre-shaped)
 * @param {object} costPayload       for topDrivers (top 5 parts by extended cost)
 */
function addCostBreakdownSlide(pptx, executivePayload, costPayload) {
  const slide = pptx.addSlide();
  addHeader(slide, 'COST ENGINEER VIEW', 'Cost breakdown by sub-assembly');

  const { data, unit } = executivePayload.headlineChart;
  slide.addChart(
    pptx.ChartType.bar,
    [{ name: `Cost (${unit})`, labels: data.map((d) => d.label), values: data.map((d) => d.value) }],
    {
      x: MARGIN, y: 1.6, w: CONTENT_W, h: 3.1,
      chartColors: [ACCENT],
      showLegend: false,
      showValue: true,
      dataLabelColor: INK,
      dataLabelFontSize: 10,
      catAxisLabelFontSize: 11,
      valAxisLabelFontSize: 10,
      barGapWidthPct: 35,
    },
  );

  const drivers = costPayload.topDrivers ?? [];
  if (drivers.length > 0) {
    slide.addText('Top cost drivers', {
      x: MARGIN, y: 4.9, w: CONTENT_W, h: 0.4, fontSize: 14, bold: true, color: INK, fontFace: FONT,
    });
    const rows = [
      [
        { text: 'Part', options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT } } },
        { text: 'Sub-assembly', options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT } } },
        { text: 'Extended cost', options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT }, align: 'right' } },
      ],
      ...drivers.map((d) => [
        { text: d.partName },
        { text: d.subAssemblyName },
        { text: formatCurrency(d.extendedCost, costPayload.currency), options: { align: 'right' } },
      ]),
    ];
    slide.addTable(rows, {
      x: MARGIN, y: 5.3, w: CONTENT_W, h: 1.7,
      fontSize: 12, fontFace: FONT, color: INK, border: { color: 'E5E7EB', pt: 0.5 },
      autoPage: false,
    });
  }
  return slide;
}

/**
 * @param {object} pptx
 * @param {object} comparison  api.reports.compare(...) response — this product is comparison.products[0] (the baseline)
 */
function addComparisonSlide(pptx, comparison) {
  const slide = pptx.addSlide();
  addHeader(slide, 'COMPARE', `Benchmarked against ${comparison.products.length - 1} other teardown(s)`);

  const currency = comparison.products[0]?.currency;
  slide.addChart(
    pptx.ChartType.bar,
    [
      {
        name: `Total cost (${currency})`,
        labels: comparison.products.map((p) => p.brand),
        values: comparison.products.map((p) => p.totalCost),
      },
    ],
    {
      x: MARGIN, y: 1.6, w: CONTENT_W, h: 3.2,
      chartColors: [ACCENT],
      showLegend: false,
      showValue: true,
      dataLabelColor: INK,
      dataLabelFontSize: 10,
      catAxisLabelFontSize: 11,
      valAxisLabelFontSize: 10,
      barGapWidthPct: 35,
    },
  );

  const baselineBrand = comparison.products[0]?.brand;
  const bullets = comparison.comparisons.map((c) => {
    const pct = c.deltas.totalCost?.deltaPct;
    const sign = pct > 0 ? '+' : '';
    const text =
      pct === null || pct === undefined
        ? `${c.brand}: cost delta not available`
        : `${c.brand}: ${sign}${pct}% cost vs ${baselineBrand}`;
    return { text, options: { bullet: true, breakLine: true } };
  });
  if (bullets.length > 0) {
    slide.addText(bullets, {
      x: MARGIN, y: 5.1, w: CONTENT_W, h: 1.9, fontSize: 14, color: INK, fontFace: FONT,
    });
  }
  return slide;
}

/**
 * Build the deck for one product.
 *
 * @param {object} teardown            api.products.teardown(id)
 * @param {object} executivePayload    api.reports.get(id, PERSONAS.EXECUTIVE).payload
 * @param {object} costPayload         api.reports.get(id, PERSONAS.COST_ENGINEER).payload
 * @param {object} [comparison]        api.reports.compare([id, ...]).payload-shaped response;
 *   optional — omitted (or with fewer than 2 products) skips the comparison slide entirely
 *   rather than rendering an empty or misleading one.
 * @returns {pptxgen}
 */
export function buildBenchmarkDeck(teardown, executivePayload, costPayload, comparison = null) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${teardown.brand} ${teardown.name} — Benchmark Summary`;

  addTitleSlide(pptx, teardown);
  addExecutiveSummarySlide(pptx, executivePayload);
  addCostBreakdownSlide(pptx, executivePayload, costPayload);

  if (comparison && comparison.products?.length >= 2) {
    addComparisonSlide(pptx, comparison);
  }

  return pptx;
}

/** A filesystem-safe filename from a product's brand + name. */
function filenameFor(teardown) {
  const slug = `${teardown.brand}-${teardown.name}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug}-Benchmark.pptx`;
}

/** Build the deck and trigger a browser download — the one I/O line. */
export async function exportBenchmarkToPowerPoint(teardown, executivePayload, costPayload, comparison = null) {
  const pptx = buildBenchmarkDeck(teardown, executivePayload, costPayload, comparison);
  await pptx.writeFile({ fileName: filenameFor(teardown) });
}
