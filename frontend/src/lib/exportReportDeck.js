// ---------------------------------------------------------------------------
// src/lib/exportReportDeck.js — the four report pages as a .pptx.
//
//   1. Title
//   2. Executive Summary        KPI cards + the thirteen opportunities
//   3. Best-of-Best             module winners, cost / parts / weight
//   4. Material & Commodity     eight commodity rows across the designs
//   5. Polymer Optimization     grade table + the substitution callout
//
// ---------------------------------------------------------------------------
// SAME BUILDER/IO SPLIT, AND SAME RULE ABOUT NUMBERS, AS exportPptx.js
//
// `buildReportDeck` takes plain data and returns a pptxgen instance; the download
// call is the only line that touches the browser. And every figure on these slides
// is READ from the same payloads the report pages render — the Best-of-Best service
// for module winners, the commodity roll-up for the material slide. Nothing is
// recomputed here, because a deck that quietly disagrees with the screen it was
// exported from is worse than no deck.
//
// ---------------------------------------------------------------------------
// THE ILLUSTRATIVE LABELS SURVIVE THE EXPORT
//
// This is the whole point of carrying them. A screenshot of a labelled web page is
// still labelled; a PowerPoint slide that dropped the label on the way out is a
// fabricated figure in a deck that will be forwarded. So each slide states, on the
// slide, whether its figures are live or illustrative — see the SOURCE line.
// ---------------------------------------------------------------------------

import pptxgen from 'pptxgenjs';

import { formatCurrency } from '@/lib/format';

const NAVY = '141C3A';       // CDI deep navy
const VIOLET = '7B3FE4';     // the mark's play triangle
const DAIKIN = '00A0E4';     // the supporting brand
const INK = '16203F';
const MUTED = '7A839F';
const WIN = 'DFF3E3';
const WIN_TEXT = '186A3B';
const ALERT = 'FDEAEA';
const ALERT_TEXT = 'B3261E';
const ACCENT = '2E7BF6';     // CDI electric blue
const FONT = 'Arial';

const SLIDE_W = 13.33;
const MARGIN = 0.55;
const CONTENT_W = SLIDE_W - MARGIN * 2;

/**
 * The CDI mark, drawn from shapes.
 *
 * pptxgenjs takes images as base64, and embedding a rasterised logo would put a
 * fixed-resolution bitmap on every slide of a deck that gets projected. The mark is
 * three simple forms — a ring, a bar, a triangle — so drawing it as vector shapes
 * keeps it crisp at any projector size and needs no asset in the bundle. It is a
 * simplification of the full mark, not a redraw of it: the same navy ring, the same
 * violet play triangle, in the same arrangement.
 */
function addCdiMark(slide, x, y, h, onDark) {
  const ink = onDark ? 'FFFFFF' : NAVY;
  slide.addShape('donut', {
    x, y, w: h, h, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  slide.addShape('rect', {
    x: x + h * 0.36, y: y + h * 0.26, w: h * 0.12, h: h * 0.48, fill: { color: ink },
  });
  slide.addShape('triangle', {
    x: x + h * 0.62, y: y + h * 0.28, w: h * 0.34, h: h * 0.44,
    fill: { color: VIOLET }, rotate: 90,
  });
}

/**
 * The brand band, kicker and title every slide opens with.
 *
 * The band carries CDI and names Daikin as the client on EVERY slide, not just the
 * cover. A deck gets split up — one slide pasted into a steering pack, another
 * forwarded on its own — and a slide that only says who made it on page one says
 * nothing at all by the time it has been separated from page one.
 */
function addHeader(slide, kicker, title, subtitle) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.42, fill: { color: NAVY } });
  addCdiMark(slide, MARGIN, 0.07, 0.28, true);
  slide.addText('COMPETITIVE DECISION INTELLIGENCE', {
    x: MARGIN + 0.4, y: 0.06, w: 5, h: 0.3,
    fontFace: FONT, fontSize: 10, bold: true, color: 'FFFFFF', charSpacing: 1.2, valign: 'middle',
  });
  slide.addText(
    [
      { text: 'Prepared for ', options: { color: 'FFFFFFB3' } },
      { text: 'Daikin', options: { color: DAIKIN, bold: true } },
      { text: '  ·  Product Benchmarking', options: { color: 'FFFFFFB3' } },
    ],
    {
      x: SLIDE_W - MARGIN - 4, y: 0.06, w: 4, h: 0.3,
      fontFace: FONT, fontSize: 9, align: 'right', valign: 'middle',
    },
  );

  slide.addText(kicker.toUpperCase(), {
    x: MARGIN, y: 0.62, w: CONTENT_W, h: 0.22,
    fontFace: FONT, fontSize: 10, bold: true, color: ACCENT, charSpacing: 1.4,
  });
  slide.addText(title, {
    x: MARGIN, y: 0.84, w: CONTENT_W, h: 0.45,
    fontFace: FONT, fontSize: 24, bold: true, color: INK,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN, y: 1.28, w: CONTENT_W, h: 0.3,
      fontFace: FONT, fontSize: 10.5, color: MUTED,
    });
  }
}

/**
 * The provenance line. Present on every slide, deliberately.
 *
 * A deck outlives the page it came from, so "these numbers are a worked example"
 * has to travel with the slide rather than sit on the screen it was exported from.
 */
function addSource(slide, live, note) {
  slide.addText(
    [
      { text: live ? 'LIVE DATA  ' : 'ILLUSTRATIVE  ', options: { bold: true, color: live ? WIN_TEXT : 'A5720F' } },
      { text: note, options: { color: MUTED } },
    ],
    { x: MARGIN, y: 6.95, w: CONTENT_W, h: 0.3, fontFace: FONT, fontSize: 9 },
  );
}

/** The closing takeaway bar. */
function addBanner(slide, headline, body) {
  const y = 6.15;
  slide.addShape('rect', { x: MARGIN, y, w: CONTENT_W, h: 0.68, fill: { color: NAVY } });
  if (headline) {
    slide.addText(headline, {
      x: MARGIN + 0.15, y: y + 0.1, w: 2.1, h: 0.48,
      fontFace: FONT, fontSize: 20, bold: true, color: 'FFFFFF',
    });
  }
  slide.addText(body, {
    x: MARGIN + (headline ? 2.35 : 0.15), y: y + 0.08, w: CONTENT_W - (headline ? 2.5 : 0.3), h: 0.52,
    fontFace: FONT, fontSize: 10.5, color: 'FFFFFF', valign: 'middle',
  });
}

/** Shared table styling, so every slide's table is the same table. */
function tableOpts(colW, y = 1.75) {
  return {
    x: MARGIN, y, w: CONTENT_W, colW,
    fontFace: FONT, fontSize: 10, color: '243056',
    border: { type: 'solid', color: 'D5DCEC', pt: 0.5 },
    align: 'center', valign: 'middle',
    autoPage: false,
  };
}

const head = (text) => ({
  text,
  options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, align: 'center' },
});

// ---------------------------------------------------------------------------

/**
 * The footer: CDI on the left, the client on the right, on every content slide.
 *
 * Belt and braces with the header band, and worth it. Slides get cropped, and a
 * screenshot of the lower two thirds of a table is exactly the artefact that ends
 * up in someone's email with no idea whose numbers it is showing.
 */
function addFooter(slide) {
  slide.addShape('rect', {
    x: MARGIN, y: 7.16, w: CONTENT_W, h: 0.012, fill: { color: 'D5DCEC' },
  });
  slide.addText('Competitive Decision Intelligence', {
    x: MARGIN, y: 7.2, w: 5, h: 0.24,
    fontFace: FONT, fontSize: 8, bold: true, color: NAVY,
  });
  slide.addText(
    [
      { text: 'Prepared for ', options: { color: MUTED } },
      { text: 'Daikin', options: { color: DAIKIN, bold: true } },
      { text: ' Product Benchmarking', options: { color: MUTED } },
    ],
    { x: SLIDE_W - MARGIN - 5, y: 7.2, w: 5, h: 0.24, fontFace: FONT, fontSize: 8, align: 'right' },
  );
}

/**
 * The cover.
 *
 * CDI is the deck's identity and Daikin is who it was prepared for, so the cover
 * states both in that relationship — the platform above, the client below, rather
 * than two logos sharing a line as if they were partners on it.
 */
function addTitleSlide(pptx, ctx) {
  const slide = pptx.addSlide();
  slide.background = { color: NAVY };

  addCdiMark(slide, MARGIN, 2.05, 0.95, true);
  slide.addText('Competitive Decision Intelligence', {
    x: MARGIN + 1.25, y: 2.05, w: CONTENT_W - 1.25, h: 0.6,
    fontFace: FONT, fontSize: 34, bold: true, color: 'FFFFFF',
  });
  slide.addText('FROM COMPETITIVE SIGNALS TO STRATEGIC DECISIONS', {
    x: MARGIN + 1.25, y: 2.62, w: CONTENT_W - 1.25, h: 0.3,
    fontFace: FONT, fontSize: 11, color: 'FFFFFFA6', charSpacing: 2,
  });

  // The accent rule, in the mark's own blue → violet ramp.
  slide.addShape('rect', { x: MARGIN, y: 3.35, w: 2.2, h: 0.05, fill: { color: ACCENT } });
  slide.addShape('rect', { x: MARGIN + 2.2, y: 3.35, w: 1.1, h: 0.05, fill: { color: VIOLET } });

  slide.addText('Executive Report Pack', {
    x: MARGIN, y: 3.6, w: CONTENT_W, h: 0.6,
    fontFace: FONT, fontSize: 30, bold: true, color: 'FFFFFF',
  });
  slide.addText(
    [
      { text: 'Prepared for ', options: { color: 'FFFFFFA6' } },
      { text: 'Daikin', options: { color: DAIKIN, bold: true } },
      { text: ' — Comforts AHU · Design / Cost Optimization Opportunities', options: { color: 'FFFFFFA6' } },
    ],
    { x: MARGIN, y: 4.2, w: CONTENT_W, h: 0.35, fontFace: FONT, fontSize: 14 },
  );
  slide.addText(
    `Benchmarked designs: ${ctx.designs.join('  ·  ')}`,
    { x: MARGIN, y: 4.65, w: CONTENT_W, h: 0.3, fontFace: FONT, fontSize: 11, color: 'FFFFFF8C' },
  );
  slide.addText(
    'Executive Summary · Best-of-Best · Material & Commodity · Polymer Optimization',
    { x: MARGIN, y: 5.05, w: CONTENT_W, h: 0.3, fontFace: FONT, fontSize: 11, color: ACCENT },
  );
}

function addExecutiveSlide(pptx, exec) {
  const slide = pptx.addSlide();
  addHeader(
    slide,
    'Product Evaluation Summary',
    'Executive Summary',
    'Daikin Comforts AHU — detailed competitive product study considering eBOM, design observations and cost benchmarking',
  );

  // KPI cards.
  const cards = [
    [String(exec.totals.ideas), 'Ideas Identified'],
    [`~${(exec.totals.weightG / 1000).toFixed(1)} kg`, 'Weight Reduction Potential'],
    [String(exec.totals.fasteners), 'Potential Fasteners Reduction'],
    [String(exec.totals.parts), 'Part Count Reduction'],
    [`$${exec.savingPerProduct}`, 'Potential Saving Per Product'],
  ];
  const cardW = (CONTENT_W - 0.4) / 5;
  cards.forEach(([value, label], i) => {
    const x = MARGIN + i * (cardW + 0.1);
    slide.addShape('rect', {
      x, y: 1.72, w: cardW, h: 0.95,
      fill: { color: 'FFFFFF' }, line: { color: 'D5DCEC', width: 0.75 },
    });
    slide.addText(value, {
      x, y: 1.82, w: cardW, h: 0.42, fontFace: FONT, fontSize: 20, bold: true,
      color: WIN_TEXT, align: 'center',
    });
    slide.addText(label, {
      x, y: 2.22, w: cardW, h: 0.4, fontFace: FONT, fontSize: 8.5, color: '243056', align: 'center',
    });
  });

  const rows = [
    [head('#'), head('Idea'), head('Subsystem'), head('Design Change'), head('Primary Benefit')],
    ...exec.ideas.map((i) => ([
      { text: String(i.n), options: { align: 'center' } },
      { text: i.idea, options: { align: 'left' } },
      { text: i.subsystem, options: { align: 'left' } },
      { text: i.change, options: { align: 'left' } },
      { text: i.benefit, options: { fill: { color: WIN }, color: WIN_TEXT, bold: true, align: 'left' } },
    ])),
  ];
  slide.addTable(rows, { ...tableOpts([0.4, 2.6, 2.3, 4.0, 2.9], 2.85), fontSize: 8.5, rowH: 0.26 });

  addBanner(
    slide,
    `$${exec.savingPerProduct}`,
    `Thirteen design changes remove ${(exec.totals.weightG / 1000).toFixed(2)} kg, `
    + `${exec.totals.fasteners} fasteners and ${exec.totals.parts} parts per unit with no change in function.`,
  );
  addFooter(slide);
  addSource(slide, false,
    'Optimisation ideas and saving-per-product are a worked example from the design reference. '
    + 'KPI figures are the sum of the itemised ideas, so the headline and the table reconcile.');
}

function addBestOfBestSlide(pptx, bob) {
  const slide = pptx.addSlide();
  addHeader(
    slide, 'Benchmarking', 'Cost Benchmarking — Best-of-Best Comparison',
    'Module-level winners across the compared designs. Gap is the spread to the next-lowest.',
  );

  const rows = [
    [head('Module'), ...bob.designs.map((d) => head(d)), head('BoB'), head('Gap')],
    ...bob.rows.map((r) => ([
      { text: r.module, options: { align: 'left' } },
      ...r.values.map((v) => ({
        text: v.text,
        options: v.win ? { fill: { color: WIN }, color: WIN_TEXT, bold: true } : {},
      })),
      { text: r.bob, options: { bold: true } },
      { text: r.gap, options: { fill: { color: 'FDF1E3' }, color: 'A55A12' } },
    ])),
  ];
  const designCols = bob.designs.length;
  const w = (CONTENT_W - 3.2) / (designCols + 2);
  slide.addTable(rows, {
    ...tableOpts([3.2, ...Array(designCols + 2).fill(w)], 1.8),
    fontSize: 9.5, rowH: 0.3,
  });

  addBanner(slide, bob.headline, bob.body);
  addFooter(slide);
  addSource(slide, true,
    'Computed from the live teardown data by the Best-of-Best service — the same figures the '
    + 'application renders. Green marks the best value in each row.');
}

function addCommoditySlide(pptx, mat) {
  const slide = pptx.addSlide();
  addHeader(
    slide, 'Benchmarking', 'Material & Commodity Benchmarking',
    'Commodity-level cost, weight and part breakdown across candidate designs',
  );

  const header = [head('Commodity')];
  for (const d of mat.designs) header.push(head(`${d} — Parts`), head('Wt kg'), head('Cost $'));
  header.push(head('Cost Contribution'));

  const rows = [
    header,
    ...mat.rows.map((r) => ([
      { text: r.label, options: { align: 'left' } },
      ...r.cells.map((c) => ({
        text: c.text,
        options: c.win ? { fill: { color: WIN }, color: WIN_TEXT, bold: true } : {},
      })),
      { text: r.share, options: {} },
    ])),
    [
      { text: 'BOM Total', options: { align: 'left', bold: true, fill: { color: 'E8EDF8' } } },
      ...mat.totals.map((t) => ({ text: t, options: { bold: true, fill: { color: 'E8EDF8' } } })),
      { text: '100%', options: { bold: true, fill: { color: 'E8EDF8' } } },
    ],
  ];
  const perDesign = 3 * mat.designs.length;
  const w = (CONTENT_W - 2.4 - 1.3) / perDesign;
  slide.addTable(rows, {
    ...tableOpts([2.4, ...Array(perDesign).fill(w), 1.3], 1.8),
    fontSize: 8.5, rowH: 0.28,
  });

  addBanner(slide, mat.headline, mat.body);
  addFooter(slide);
  addSource(slide, true,
    'Aggregated from the live BOMs — every part classified into the eight commodity groups by '
    + 'material, then commodity, then part name. Costs read from each design\'s cost report.');
}

function addPolymerSlide(pptx, poly) {
  const slide = pptx.addSlide();
  addHeader(
    slide, 'Material Optimization Opportunity', 'Polymer Weight Distribution',
    'Benchmarking polymer usage by grade to pinpoint high-cost material over-use and substitution opportunities',
  );

  const rows = [
    [head('Polymer Grade'), head('Design A'), head('Design B'), head('Design C'), head('Cost Tier')],
    ...poly.grades.map((g) => {
      const alert = g.flagged;
      const base = alert ? { fill: { color: ALERT }, color: ALERT_TEXT, bold: true } : {};
      return [
        { text: g.grade, options: { align: 'left', ...base } },
        { text: g.a.toFixed(1), options: base },
        { text: g.b.toFixed(1), options: base },
        { text: g.c.toFixed(1), options: base },
        {
          text: g.tier,
          options: {
            ...base,
            color: alert ? ALERT_TEXT : g.tier === 'Low' ? WIN_TEXT : g.tier === 'Medium' ? 'A55A12' : ALERT_TEXT,
            bold: true,
          },
        },
      ];
    }),
  ];
  slide.addTable(rows, { ...tableOpts([2.0, 1.5, 1.5, 1.5, 1.4], 1.8), fontSize: 10, rowH: 0.3 });

  // The opportunity callout, to the right of the table.
  const x = MARGIN + 8.2;
  const w = CONTENT_W - 8.2;
  slide.addShape('rect', { x, y: 1.8, w, h: 0.4, fill: { color: NAVY } });
  slide.addText('Optimization Opportunity', {
    x: x + 0.15, y: 1.85, w: w - 0.3, h: 0.3,
    fontFace: FONT, fontSize: 11, bold: true, color: 'FFFFFF',
  });
  slide.addShape('rect', { x: x + 0.15, y: 2.4, w: (w - 0.8) / 2, h: 0.6, fill: { color: ALERT } });
  slide.addText(poly.from, {
    x: x + 0.15, y: 2.5, w: (w - 0.8) / 2, h: 0.4,
    fontFace: FONT, fontSize: 13, bold: true, color: ALERT_TEXT, align: 'center',
  });
  slide.addText('→', {
    x: x + 0.15 + (w - 0.8) / 2, y: 2.5, w: 0.5, h: 0.4,
    fontFace: FONT, fontSize: 16, bold: true, color: ACCENT, align: 'center',
  });
  slide.addShape('rect', {
    x: x + 0.65 + (w - 0.8) / 2, y: 2.4, w: (w - 0.8) / 2, h: 0.6, fill: { color: WIN },
  });
  slide.addText(poly.to, {
    x: x + 0.65 + (w - 0.8) / 2, y: 2.5, w: (w - 0.8) / 2, h: 0.4,
    fontFace: FONT, fontSize: 13, bold: true, color: WIN_TEXT, align: 'center',
  });
  slide.addText(poly.saving, {
    x, y: 3.3, w, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color: ACCENT, align: 'center',
  });
  slide.addText('material cost-down at current volumes', {
    x, y: 3.75, w, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED, align: 'center',
  });
  slide.addText(poly.rationale, {
    x, y: 4.1, w, h: 1.4, fontFace: FONT, fontSize: 9, color: '243056', align: 'center',
  });

  addBanner(slide, null, poly.body);
  addFooter(slide);
  addSource(slide, false,
    'Polymer-grade breakdown and the annual saving are a worked example from the design '
    + 'reference. This repository stores a free-text material per part, not a grade-level '
    + 'weight distribution.');
}

// ---------------------------------------------------------------------------

/**
 * @param {object} data  the four report models, already shaped by the caller
 * @returns {pptxgen}
 */
export function buildReportDeck(data) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Product Benchmarking';
  pptx.title = 'Executive Report Pack';

  addTitleSlide(pptx, data.context);
  addExecutiveSlide(pptx, data.executive);
  if (data.bestOfBest) addBestOfBestSlide(pptx, data.bestOfBest);
  if (data.material) addCommoditySlide(pptx, data.material);
  addPolymerSlide(pptx, data.polymer);

  return pptx;
}

/** Build and download. The one line that touches the browser. */
export async function exportReportPack(data) {
  const pptx = buildReportDeck(data);
  await pptx.writeFile({ fileName: 'Benchmarking-Executive-Report-Pack.pptx' });
}

/** Re-exported so callers format money the same way the pages do. */
export { formatCurrency };
