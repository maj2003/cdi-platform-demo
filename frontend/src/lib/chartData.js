// ---------------------------------------------------------------------------
// src/lib/chartData.js — shaping helpers for the report charts.
//
// These do NOT compute anything. They reorder, truncate and relabel figures the
// backend already calculated. The rule from benchmarkService holds all the way
// out to the pixels: arithmetic happens in exactly one place, server-side.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CHART PALETTE — explicit hex, no CSS variables. See the note below.
//
// WHY NOT var(--chart-1):
// The previous version used `var(--chart-1, #2563eb)` on the assumption that a
// missing variable would fall back to the hex. It doesn't, and that assumption
// is what produced grey charts.
//
// A CSS var() fallback only applies when the variable is UNDEFINED. Several
// shadcn versions define these tokens as bare HSL channels —
// `--chart-1: 12 76% 61%` — intended for use as `hsl(var(--chart-1))`. So the
// variable IS defined, the fallback never fires, and `fill` receives the string
// "12 76% 61%", which is not a valid colour. The browser discards it and paints
// the SVG default. Every series ends up the same grey.
//
// Hard-coding removes the whole class of problem: no dependency on which
// shadcn version generated the theme, or on whether the tokens are raw channels
// or complete colours.
//
// The colours are the Okabe–Ito qualitative palette, designed to stay
// distinguishable under the common forms of colour-vision deficiency — which
// matters more than usual here, because the donut relies entirely on hue to
// separate categories. They're mid-tone, so they read on light and dark
// backgrounds alike.
//
// The tradeoff, stated plainly: these do NOT follow your theme. If you later
// want them themed, define real colours in index.css —
//   :root { --chart-1: #0072b2; ... }
// — and switch this array back to plain `var(--chart-1)` references with no
// fallback, so a mistake fails loudly instead of silently going grey.
// ---------------------------------------------------------------------------
// First entry is Maya light blue (#44C8F5, same as --accent in index.css) —
// the dominant ambient brand accent, not the darker cerulean (--primary),
// because the baseline series is the "this is our brand" color a reader's eye
// lands on first, and that role belongs to the lighter, more-used accent.
// The other seven stay the original Okabe–Ito hues; swapping those for
// on-brand colors would trade away the colour-vision-deficiency
// distinguishability this palette exists for, and only the first slot needs
// to match the brand. One known tradeoff worth naming: slot 4 ("sky",
// #56b4e9) is now visually close to slot 0 — acceptable for the common case
// (a handful of sub-assemblies/materials), less so if a chart ever plots 5+
// categories where both slots land.
export const PALETTE = [
  '#44c8f5', // Maya light blue (brand accent; was #0097e0 cerulean, before that #0072b2)
  '#e69f00', // orange
  '#009e73', // green
  '#cc79a7', // magenta
  '#56b4e9', // sky
  '#d55e00', // vermillion
  '#f0e442', // yellow
  '#8c564b', // brown
];

/**
 * Neutral grey, reserved for the "Other" bucket.
 *
 * Deliberate: the grouped tail is a residual, not a category, and giving it a
 * vivid colour makes it compete visually with real materials that matter more.
 */
export const OTHER_COLOR = '#9ca3af';

/** Cycle the palette so an N-slice chart never runs out of colours. */
export const colorAt = (i) => PALETTE[i % PALETTE.length];

/**
 * Colour for a pie/donut slice, greying out the rolled-up "Other" bucket.
 *
 * @param {string} label  slice label as produced by topNWithOther
 * @param {number} i      slice index
 */
export const sliceColor = (label, i) =>
  typeof label === 'string' && label.startsWith('Other (') ? OTHER_COLOR : colorAt(i);

/**
 * Keep the largest N rows and roll the rest into a single "Other" slice.
 *
 * WHY: the seeded products carry 10–17 distinct materials. A pie with 17 slices
 * is a colour swatch, not a chart — the long tail is individually meaningless
 * but collectively worth showing, which is exactly what "Other" is for.
 *
 * @param {Array<object>} rows      already sorted descending by the backend
 * @param {string} valueKey
 * @param {string} labelKey
 * @param {number} [limit=6]
 */
export function topNWithOther(rows, valueKey, labelKey, limit = 6) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (rows.length <= limit) {
    return rows.map((r) => ({ label: r[labelKey], value: r[valueKey] }));
  }

  const head = rows.slice(0, limit).map((r) => ({ label: r[labelKey], value: r[valueKey] }));
  const tail = rows.slice(limit);
  const otherValue = tail.reduce((sum, r) => sum + r[valueKey], 0);

  return [
    ...head,
    {
      label: `Other (${tail.length})`,
      value: Number(otherValue.toFixed(2)),
    },
  ];
}

/**
 * Shorten a long label for an axis tick, keeping the end where the
 * distinguishing words usually are ("…Fan Motor" beats "BLDC Fan Mo…").
 */
export function truncateLabel(label, max = 24) {
  if (!label || label.length <= max) return label;
  return `…${label.slice(-(max - 1))}`;
}