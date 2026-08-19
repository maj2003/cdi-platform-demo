// ---------------------------------------------------------------------------
// src/lib/reportSampleData.js
//
// The illustrative content the reference deck carries and the database cannot: the
// thirteen design-optimisation ideas, the polymer-grade distribution, and per-module
// assembly times.
//
// ---------------------------------------------------------------------------
// EVERYTHING IN THIS FILE IS A WORKED EXAMPLE, AND EVERY SCREEN THAT USES IT SAYS SO
//
// These are not measured figures. There is no table of proposed design changes, no
// polymer-grade breakdown and no assembly-time study behind this build — the deck
// they come from is a design reference, and its numbers are a plausible example of
// what the finished reports say, not an output of this repository's data.
//
// So every report rendering any of it carries an IllustrativeNotice next to the
// figures. The rule is the one this app has followed since the request form's
// SIMULATED badges: an unlabelled convincing number is indistinguishable from a
// measured one, and the executive being shown the report is the one who ends up
// misinformed. It is kept in ONE file, apart from anything derived from the
// database, so the boundary between the two is a file path rather than a judgement
// call at each call site.
//
// ---------------------------------------------------------------------------
// WHY THE BENEFITS ARE STRUCTURED AND NOT JUST PROSE
//
// The reference deck's headline cards (~2.4 kg, 30 fasteners, 15 parts) do NOT add
// up to its own thirteen-row table — presumably they cover work beyond the rows
// shown. Restating them above a table that sums to something else produces a page
// that fails the first time somebody adds the column up, in front of the audience
// least forgiving of it.
//
// So each idea carries its deltas as NUMBERS and the KPI cards are summed from them.
// The cards and the table can then never disagree, and adding or removing an idea
// updates the headline automatically. The figures below are transcribed from the
// deck exactly; only the totals are ours.
// ---------------------------------------------------------------------------

/**
 * The thirteen ideas, as printed in the reference deck.
 *
 * `weightG`, `fasteners` and `parts` are the deltas — positive numbers meaning
 * "removed". `benefit` is the deck's own phrasing, kept verbatim so the page reads
 * like the slide.
 */
export const OPTIMISATION_IDEAS = Object.freeze([
  {
    n: 1,
    idea: 'Eliminate cabinet corner brackets',
    subsystem: 'Cabinet Assembly',
    change: 'Integrate corners via bent-flange design',
    benefit: '−320 g · −8 fasteners',
    weightG: 320, fasteners: 8, parts: 0,
  },
  {
    n: 2,
    idea: 'Snap-fit access panel',
    subsystem: 'Cabinet Assembly',
    change: 'Replace 6 screws with snap latches',
    benefit: '−6 fasteners',
    weightG: 0, fasteners: 6, parts: 0,
  },
  {
    n: 3,
    idea: 'Thinner cabinet skin gauge',
    subsystem: 'Cabinet Assembly',
    change: '1.0 mm → 0.8 mm galvanized sheet',
    benefit: '−640 g',
    weightG: 640, fasteners: 0, parts: 0,
  },
  {
    n: 4,
    idea: 'Consolidate coil end plates',
    subsystem: 'Coil Assembly',
    change: 'Two end plates → one formed plate',
    benefit: '−180 g',
    weightG: 180, fasteners: 0, parts: 0,
  },
  {
    n: 5,
    idea: 'Simplify blower housing mount',
    subsystem: 'Blower Assembly',
    change: '6 parts / 6 screws → 1 part / 2 screws',
    benefit: '−5 parts · −4 screws',
    weightG: 0, fasteners: 4, parts: 5,
  },
  {
    n: 6,
    idea: 'Contactless airflow sensor',
    subsystem: 'Electrical Assembly',
    change: 'Vane switch → magnet-based Hall sensor',
    benefit: '−12 g · −1 part · −2 screws',
    weightG: 12, fasteners: 2, parts: 1,
  },
  {
    n: 7,
    idea: 'Common wiring harness',
    subsystem: 'Electrical Assembly',
    change: 'Standardize harness across models',
    benefit: '−90 g',
    weightG: 90, fasteners: 0, parts: 0,
  },
  {
    n: 8,
    idea: 'Optimize drain pan geometry',
    subsystem: 'Condensate Mgmt Assembly',
    change: 'Remove non-functional rear section',
    benefit: '−70 g',
    weightG: 70, fasteners: 0, parts: 0,
  },
  {
    n: 9,
    idea: 'Slide-in filter rack',
    subsystem: 'Air Filtration Assembly',
    change: 'Track rack replaces bolted frame',
    benefit: '−3 fasteners',
    weightG: 0, fasteners: 3, parts: 0,
  },
  {
    n: 10,
    idea: 'Integrated filter gasket',
    subsystem: 'Air Filtration Assembly',
    change: 'Foam gasket molded into panel',
    benefit: '−2 parts · −4 screws',
    weightG: 0, fasteners: 4, parts: 2,
  },
  {
    n: 11,
    idea: 'Remove heater mounting sub-frame',
    subsystem: 'Electric Heater Assembly',
    change: 'Mount elements directly to cabinet',
    benefit: '−2 parts · −10 screws · −500 g',
    weightG: 500, fasteners: 10, parts: 2,
  },
  {
    n: 12,
    idea: 'Control box cover material',
    subsystem: 'Electrical Assembly',
    change: 'ABS → PP (UL), snap-fit attachment',
    benefit: '−1 screw · −19.5 g (15%)',
    weightG: 19.5, fasteners: 1, parts: 0,
  },
  {
    n: 13,
    idea: 'Cabinet panel material change',
    subsystem: 'Packaging Assembly',
    change: 'ABS → PP (UL), same design retained',
    benefit: '−105 g (15%)',
    weightG: 105, fasteners: 0, parts: 0,
  },
]);

/** The deck's saving-per-product headline. Illustrative, like the ideas it sums. */
export const SAVING_PER_PRODUCT_USD = 38;

/** Totals for the KPI cards — summed, never restated. See the header comment. */
export function ideaTotals(ideas = OPTIMISATION_IDEAS) {
  return ideas.reduce(
    (t, i) => ({
      ideas: t.ideas + 1,
      weightG: t.weightG + (i.weightG ?? 0),
      fasteners: t.fasteners + (i.fasteners ?? 0),
      parts: t.parts + (i.parts ?? 0),
    }),
    { ideas: 0, weightG: 0, fasteners: 0, parts: 0 },
  );
}

// ---------------------------------------------------------------------------
// Polymer weight distribution
// ---------------------------------------------------------------------------

/**
 * kg of each polymer grade per unit, by design, plus the grade's cost tier.
 *
 * Illustrative. The repository stores a free-text `material` per part ("PP",
 * "PA6 + 30% GF", "FR-4 / Mixed"), not a polymer-grade weight breakdown, so this
 * cannot be derived from it — the parts would have to be re-characterised by grade
 * first. Transcribed from the reference deck.
 */
export const POLYMER_GRADES = Object.freeze([
  { grade: 'HIPS', tier: 'Low', a: 8.2, b: 12.6, c: 10.4 },
  { grade: 'PP', tier: 'Low', a: 5.1, b: 4.7, c: 5.5 },
  { grade: 'PS', tier: 'Low', a: 3.4, b: 3.0, c: 3.6 },
  { grade: 'ABS', tier: 'Medium', a: 4.9, b: 3.1, c: 6.2 },
  { grade: 'POM', tier: 'Medium', a: 1.0, b: 0.8, c: 0.9 },
  { grade: 'PC', tier: 'High', a: 0.9, b: 0.6, c: 2.4 },
  // The finding: Design A carries 9.7 kg of a high-cost grade the other two have
  // all but designed out. This row is the reason the slide exists.
  { grade: 'PC-ABS', tier: 'High', a: 9.7, b: 0.1, c: 0.2, flagged: true },
]);

export const POLYMER_OPPORTUNITY = Object.freeze({
  from: { grade: 'PC-ABS', note: 'high-cost grade' },
  to: { grade: 'HIPS', note: 'equal-performance' },
  annualSavingUsd: 220_000,
  perUnitKg: 9.5,
  rationale:
    'PC-ABS is heavily used in Design A while Designs B and C already run near-zero. '
    + 'HIPS meets the same structural and thermal requirements for these plastic housings and panels.',
});

// ---------------------------------------------------------------------------
// Assembly time
// ---------------------------------------------------------------------------

/**
 * Seconds per module, by design.
 *
 * Illustrative. Assembly time is a time-and-motion study output; nothing in this
 * schema records it, and the capture station measures dimensions and mass rather
 * than duration. Keyed by the deck's module names — the report maps them onto the
 * repository's own module names where they correspond, and shows the rest as-is.
 */
export const ASSEMBLY_TIME_SEC = Object.freeze([
  { module: 'Cabinet Assembly', a: 320, b: 295, c: 268 },
  { module: 'Coil Assembly', a: 210, b: 198, c: 225 },
  { module: 'Blower / Fan Assembly', a: 175, b: 168, c: 160 },
  { module: 'Filtration Assembly', a: 95, b: 102, c: 88 },
  { module: 'Damper Assembly', a: 70, b: 78, c: 65 },
  { module: 'Condensate / Drain Pan', a: 55, b: 49, c: 60 },
  { module: 'Electric Heater Assembly', a: 140, b: 132, c: 150 },
  { module: 'Controls & Electrical', a: 265, b: 248, c: 280 },
]);
