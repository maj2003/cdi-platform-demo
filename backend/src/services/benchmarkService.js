// ---------------------------------------------------------------------------
// src/services/benchmarkService.js
//
// Turns a teardown tree into the three persona views.
//
// ---------------------------------------------------------------------------
// SCOPE — read this before adding anything clever.
//
// Every calculation in this file is a sum, a share-of-total, a sort, or a
// percentage delta. That is deliberate and it is the ceiling, not the starting
// point. This is a proof-of-concept demonstrating that the pipeline works
// end-to-end; it is explicitly NOT an attempt to reproduce any real
// benchmarking engine, scoring model, or cost algorithm. If a request starts
// with "can it also weight the categories by…", the answer for this build is
// no — that conversation belongs on the work laptop with the real engine.
//
// The upside of staying this simple: every number on screen can be traced to
// one line of arithmetic during the demo, out loud, without hedging.
// ---------------------------------------------------------------------------
//
// STRUCTURE:
//   Pure builders   — teardown object in, plain payload out. No I/O, no
//                     database, no Express. Trivially testable.
//   I/O wrappers    — fetch the teardown, call a builder, persist the result.
//
// Keeping those apart is what lets you unit-test the arithmetic without a
// database, and it is why the builders take a teardown rather than an id.
// ---------------------------------------------------------------------------

import { products, reports, PERSONAS } from '../data/index.js';
import { badRequest, notFound, parseId } from '../lib/http.js';

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/**
 * Round for presentation only.
 *
 * All arithmetic below runs at full float precision and rounds once, at the
 * point the number enters the payload. Rounding intermediate values and then
 * summing them is how a breakdown ends up not adding to its own total — the
 * single most noticeable class of bug in a report someone is projecting.
 */
const money = (n) => Number(n.toFixed(2));
const grams = (n) => Number(n.toFixed(1));
const pct = (part, whole) => (whole === 0 ? 0 : Number(((part / whole) * 100).toFixed(1)));

/**
 * A part's cost row.
 *
 * `costs` is an array because the Prisma relation is one-to-many even though
 * the schema's @@unique([partId]) allows only one row. Parts with no cost
 * captured yet are real (mid-teardown), so this returns zeros rather than
 * throwing — a missing cost should read as "not costed", not crash the report.
 */
function costOf(part) {
  const row = part.costs?.[0];
  return {
    materialCost: row?.materialCost ?? 0,
    processCost: row?.processCost ?? 0,
    labourCost: row?.labourCost ?? 0,
    currency: row?.currency ?? 'USD',
    costed: Boolean(row),
  };
}

/**
 * Flatten the tree into one row per part, carrying its sub-assembly context.
 *
 * QUANTITY CONVENTION — the most important assumption in this file:
 *   `weightG` and the three cost columns are PER UNIT.
 *   `quantity` is how many of that part are in the product.
 *   So the product-level figure is always value × quantity ("extended").
 *
 * Both the unit and extended figures are carried through, because the two
 * personas want different ones: a cost engineer negotiating a component price
 * cares about unit cost, while any product total has to be extended. Mixing
 * them silently would understate every product that uses paired parts — which
 * in the seed data is most of them.
 */
function flatten(teardown) {
  return teardown.subAssemblies.flatMap((sub) =>
    sub.parts.map((part) => {
      const c = costOf(part);
      const qty = part.quantity ?? 1;
      const unitCost = c.materialCost + c.processCost + c.labourCost;

      return {
        partId: part.id,
        partName: part.name,
        subAssemblyId: sub.id,
        subAssemblyName: sub.name,
        material: part.material ?? 'Unspecified',
        finish: part.finish ?? null,
        quantity: qty,
        costed: c.costed,

        materialCost: c.materialCost,
        processCost: c.processCost,
        labourCost: c.labourCost,
        currency: c.currency,
        unitCost,
        extendedCost: unitCost * qty,

        unitWeightG: part.weightG ?? 0,
        extendedWeightG: (part.weightG ?? 0) * qty,

        lengthMm: part.lengthMm ?? null,
        widthMm: part.widthMm ?? null,
        heightMm: part.heightMm ?? null,
        measurementCount: part.measurements?.length ?? 0,
      };
    }),
  );
}

/** Sum a numeric field across rows. */
const sumBy = (rows, field) => rows.reduce((acc, r) => acc + r[field], 0);

/**
 * Group rows by a key and reduce each group. Used for the material and
 * sub-assembly rollups so both breakdowns share one code path — if they
 * diverged, the two views could disagree about the same product.
 */
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/**
 * The currency for a product's costs.
 *
 * Single-currency by design — there is no FX conversion in this build. If a
 * teardown ever mixes currencies, summing them would produce a confident,
 * meaningless number, so this throws instead.
 */
function resolveCurrency(rows) {
  const found = [...new Set(rows.filter((r) => r.costed).map((r) => r.currency))];
  if (found.length > 1) {
    throw badRequest(
      `Product mixes currencies (${found.join(', ')}). No FX conversion in this build.`,
    );
  }
  return found[0] ?? 'USD';
}

/** Shared identity block so every payload names its own subject. */
const identity = (teardown) => ({
  productId: teardown.id,
  productName: teardown.name,
  brand: teardown.brand,
  category: teardown.category,
});

// ---------------------------------------------------------------------------
// Pure builders — one per persona
// ---------------------------------------------------------------------------

/**
 * COST ENGINEER — where the money is.
 *
 * Cost broken down by part, by material, by sub-assembly, and by cost type,
 * every level carrying its share of total so the views are directly chartable.
 *
 * @param {object} teardown  from productRepository.getTeardown
 * @returns {object} payload for reports.save
 */
export function buildCostEngineerView(teardown) {
  const rows = flatten(teardown);
  const currency = resolveCurrency(rows);

  const totalCost = sumBy(rows, 'extendedCost');
  const uncosted = rows.filter((r) => !r.costed);

  const byPart = rows
    .map((r) => ({
      partId: r.partId,
      partName: r.partName,
      subAssemblyName: r.subAssemblyName,
      material: r.material,
      quantity: r.quantity,
      unitCost: money(r.unitCost),
      extendedCost: money(r.extendedCost),
      sharePct: pct(r.extendedCost, totalCost),
      costed: r.costed,
    }))
    .sort((a, b) => b.extendedCost - a.extendedCost);

  const byMaterial = [...groupBy(rows, (r) => r.material)]
    .map(([material, group]) => ({
      material,
      cost: money(sumBy(group, 'extendedCost')),
      sharePct: pct(sumBy(group, 'extendedCost'), totalCost),
      partLines: group.length,
      units: sumBy(group, 'quantity'),
    }))
    .sort((a, b) => b.cost - a.cost);

  const bySubAssembly = [...groupBy(rows, (r) => r.subAssemblyId)]
    .map(([id, group]) => ({
      subAssemblyId: id,
      name: group[0].subAssemblyName,
      cost: money(sumBy(group, 'extendedCost')),
      sharePct: pct(sumBy(group, 'extendedCost'), totalCost),
      partLines: group.length,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Material vs process vs labour — the split that says whether this product is
  // expensive because of what it's made of or how it's put together.
  const byCostType = [
    ['material', sumBy(rows, 'materialCost')],
    ['process', sumBy(rows, 'processCost')],
    ['labour', sumBy(rows, 'labourCost')],
  ].map(([type, unitSum]) => {
    // Re-extend by quantity per row rather than using the unit sum directly.
    const extended = rows.reduce((acc, r) => acc + r[`${type}Cost`] * r.quantity, 0);
    return { type, value: money(extended), sharePct: pct(extended, totalCost) };
  });

  return {
    ...identity(teardown),
    persona: PERSONAS.COST_ENGINEER,
    currency,
    totals: {
      totalCost: money(totalCost),
      partLines: rows.length,
      partUnits: sumBy(rows, 'quantity'),
      // Surfaced, not hidden: a total computed over a partially-costed teardown
      // is still useful, but the reader has to know it's incomplete.
      uncostedPartLines: uncosted.length,
    },
    byCostType,
    bySubAssembly,
    byMaterial,
    byPart,
    topDrivers: byPart.slice(0, 5),
  };
}

/**
 * DESIGN ENGINEER — weight, materials, dimensions, part count.
 */
export function buildDesignEngineerView(teardown) {
  const rows = flatten(teardown);

  const totalWeightG = sumBy(rows, 'extendedWeightG');
  const partUnits = sumBy(rows, 'quantity');

  const byPart = rows
    .map((r) => ({
      partId: r.partId,
      partName: r.partName,
      subAssemblyName: r.subAssemblyName,
      material: r.material,
      finish: r.finish,
      quantity: r.quantity,
      unitWeightG: grams(r.unitWeightG),
      extendedWeightG: grams(r.extendedWeightG),
      sharePct: pct(r.extendedWeightG, totalWeightG),
      dimensionsMm:
        r.lengthMm === null ? null : { l: r.lengthMm, w: r.widthMm, h: r.heightMm },
      // Bounding-box volume, NOT solid volume — these are moulded shells and
      // coils, mostly air. Reported as an envelope for packaging/footprint
      // discussion only. Deliberately no density figure: weight ÷ bounding box
      // would look authoritative and be meaningless.
      envelopeVolumeCm3:
        r.lengthMm && r.widthMm && r.heightMm
          ? Number(((r.lengthMm * r.widthMm * r.heightMm) / 1000).toFixed(1))
          : null,
      measurementCount: r.measurementCount,
    }))
    .sort((a, b) => b.extendedWeightG - a.extendedWeightG);

  const byMaterial = [...groupBy(rows, (r) => r.material)]
    .map(([material, group]) => ({
      material,
      weightG: grams(sumBy(group, 'extendedWeightG')),
      sharePct: pct(sumBy(group, 'extendedWeightG'), totalWeightG),
      partLines: group.length,
      units: sumBy(group, 'quantity'),
    }))
    .sort((a, b) => b.weightG - a.weightG);

  const bySubAssembly = [...groupBy(rows, (r) => r.subAssemblyId)]
    .map(([id, group]) => ({
      subAssemblyId: id,
      name: group[0].subAssemblyName,
      weightG: grams(sumBy(group, 'extendedWeightG')),
      sharePct: pct(sumBy(group, 'extendedWeightG'), totalWeightG),
      partLines: group.length,
      partUnits: sumBy(group, 'quantity'),
    }))
    .sort((a, b) => b.weightG - a.weightG);

  // Largest single part on each axis — a crude packaging envelope. Not the
  // product's assembled dimensions, which nobody measured.
  const dimensioned = rows.filter((r) => r.lengthMm !== null);
  const largestPartEnvelopeMm = dimensioned.length
    ? {
        maxLengthMm: Math.max(...dimensioned.map((r) => r.lengthMm)),
        maxWidthMm: Math.max(...dimensioned.map((r) => r.widthMm)),
        maxHeightMm: Math.max(...dimensioned.map((r) => r.heightMm)),
      }
    : null;

  return {
    ...identity(teardown),
    persona: PERSONAS.DESIGN_ENGINEER,
    totals: {
      totalWeightG: grams(totalWeightG),
      totalWeightKg: Number((totalWeightG / 1000).toFixed(3)),
      partLines: rows.length,
      partUnits,
      distinctMaterials: byMaterial.length,
      subAssemblies: bySubAssembly.length,
      dimensionedPartLines: dimensioned.length,
    },
    bySubAssembly,
    byMaterial,
    byPart,
    heaviestParts: byPart.slice(0, 5),
    largestPartEnvelopeMm,
  };
}

/**
 * EXECUTIVE — four numbers and one chart.
 *
 * Built by reusing the other two builders rather than recomputing. If the
 * executive summary derived its own totals, it could quietly disagree with the
 * detail views — and the exec view is the one people screenshot.
 */
export function buildExecutiveView(teardown) {
  const cost = buildCostEngineerView(teardown);
  const design = buildDesignEngineerView(teardown);

  const totalCost = cost.totals.totalCost;
  const totalWeightKg = design.totals.totalWeightKg;

  return {
    ...identity(teardown),
    persona: PERSONAS.EXECUTIVE,
    currency: cost.currency,
    headline: {
      totalCost,
      totalWeightKg,
      partUnits: design.totals.partUnits,
      // The one derived ratio in the whole file, and it is just a division.
      // Useful because it normalises across unit sizes.
      costPerKg: totalWeightKg > 0 ? money(totalCost / totalWeightKg) : null,
    },
    // Single headline chart: cost by sub-assembly. Pre-shaped as {label, value}
    // so the frontend can hand it straight to Recharts without reshaping —
    // reshaping in the component is where chart bugs live.
    headlineChart: {
      title: 'Cost by sub-assembly',
      unit: cost.currency,
      data: cost.bySubAssembly.map((s) => ({ label: s.name, value: s.cost })),
    },
    keyPoints: [
      `${cost.bySubAssembly[0]?.name ?? 'n/a'} is the largest cost block at ${cost.bySubAssembly[0]?.sharePct ?? 0}% of total.`,
      `Most expensive single part: ${cost.topDrivers[0]?.partName ?? 'n/a'} (${cost.currency} ${cost.topDrivers[0]?.extendedCost ?? 0}).`,
      `Heaviest sub-assembly: ${design.bySubAssembly[0]?.name ?? 'n/a'} at ${design.bySubAssembly[0]?.sharePct ?? 0}% of mass.`,
      `${design.totals.partUnits} physical parts across ${design.totals.partLines} distinct lines and ${design.totals.distinctMaterials} materials.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Persona dispatch
// ---------------------------------------------------------------------------

const BUILDERS = {
  [PERSONAS.COST_ENGINEER]: buildCostEngineerView,
  [PERSONAS.DESIGN_ENGINEER]: buildDesignEngineerView,
  [PERSONAS.EXECUTIVE]: buildExecutiveView,
};

function builderFor(persona) {
  const builder = BUILDERS[persona];
  if (!builder) {
    throw badRequest(
      `Unknown persona "${persona}". Expected one of: ${Object.keys(BUILDERS).join(', ')}`,
    );
  }
  return builder;
}

// ---------------------------------------------------------------------------
// I/O wrappers
// ---------------------------------------------------------------------------

/**
 * Compute a persona view for a product, and persist it by default.
 *
 * @param {number|string} id
 * @param {string} persona    one of PERSONAS
 * @param {{persist?: boolean}} [opts]
 * @returns {Promise<{report: object, persisted: boolean}>}
 */
export async function generateReport(id, persona, { persist = true } = {}) {
  const productId = parseId(id, 'productId');
  const build = builderFor(persona);

  const teardown = await products.getTeardown(productId);
  if (!teardown) throw notFound(`No product with id ${productId}`);

  const payload = build(teardown);

  if (!persist) return { report: { productId, persona, payload }, persisted: false };

  const saved = await reports.save(productId, persona, payload);
  return { report: saved, persisted: true };
}

/**
 * Return the last stored report, computing one only if none exists.
 *
 * Why not always recompute: the reports page becomes an instant read on
 * revisit, and the stored snapshot is what "generated at 14:32" actually means.
 * The tradeoff is staleness — so `refresh: true` forces a recompute, and
 * anything that edits a teardown should call reports.clearForProduct().
 */
export async function getReport(id, persona, { refresh = false } = {}) {
  const productId = parseId(id, 'productId');
  builderFor(persona); // validate before touching the database

  if (!refresh) {
    const existing = await reports.getLatest(productId, persona);
    if (existing) return { report: existing, cached: true };
  }

  const { report } = await generateReport(productId, persona);
  return { report, cached: false };
}

/**
 * Report history for a product — metadata only, no payloads.
 *
 * Passthrough, but it exists so routes never import the data layer directly.
 * The moment one route does, the layering stops being enforceable by grep.
 */
export async function listHistory(id) {
  const productId = parseId(id, 'productId');
  const product = await products.getProductById(productId);
  if (!product) throw notFound(`No product with id ${productId}`);
  return reports.listByProduct(productId);
}

/**
 * Drop stored reports for a product, optionally just one persona.
 *
 * Call this after editing a teardown. A cached report computed from stale parts
 * still renders and still carries a timestamp — it looks authoritative while
 * being wrong, which is worse than having no report at all.
 */
export async function clearReports(id, persona = null) {
  const productId = parseId(id, 'productId');
  if (persona) builderFor(persona); // validate before deleting anything
  const cleared = await reports.clearForProduct(productId, persona);
  return { productId, persona: persona ?? 'all', cleared };
}

/** Generate all three persona reports in one call — the "run benchmarking" button. */
export async function generateAllReports(id) {
  const productId = parseId(id, 'productId');
  const out = {};
  for (const persona of Object.values(PERSONAS)) {
    const { report } = await generateReport(productId, persona);
    out[persona] = report;
  }
  return out;
}

/**
 * Product-vs-product comparison.
 *
 * The first id is the baseline and every delta is expressed against it, because
 * "12% heavier" needs a stated reference to mean anything. Deltas are plain
 * differences and percentage changes — no normalisation, no weighting.
 *
 * @param {string|string[]} rawIds  "1,2,3" or an array
 */
export async function compareProducts(rawIds) {
  const list = Array.isArray(rawIds) ? rawIds : String(rawIds ?? '').split(',');
  const ids = list
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((v) => parseId(v, 'productId'));

  if (ids.length < 2) throw badRequest('Comparison requires at least two product ids');
  if (ids.length > 5) throw badRequest('Comparison supports at most five products');

  const teardowns = await products.getTeardowns(ids);
  if (teardowns.length !== ids.length) {
    const found = new Set(teardowns.map((t) => t.id));
    throw notFound(`No product with id ${ids.filter((i) => !found.has(i)).join(', ')}`);
  }

  // getTeardowns sorts by name; re-order to the caller's sequence so index 0 is
  // the baseline they actually asked for.
  const ordered = ids.map((id) => teardowns.find((t) => t.id === id));

  const summaries = ordered.map((teardown) => {
    const cost = buildCostEngineerView(teardown);
    const design = buildDesignEngineerView(teardown);
    return {
      ...identity(teardown),
      currency: cost.currency,
      totalCost: cost.totals.totalCost,
      totalWeightKg: design.totals.totalWeightKg,
      partLines: design.totals.partLines,
      partUnits: design.totals.partUnits,
      distinctMaterials: design.totals.distinctMaterials,
      costPerKg:
        design.totals.totalWeightKg > 0
          ? money(cost.totals.totalCost / design.totals.totalWeightKg)
          : null,
      costBySubAssembly: cost.bySubAssembly.map((s) => ({ label: s.name, value: s.cost })),
      weightByMaterial: design.byMaterial.map((m) => ({ label: m.material, value: m.weightG })),
    };
  });

  const baseline = summaries[0];
  const METRICS = ['totalCost', 'totalWeightKg', 'partLines', 'partUnits', 'costPerKg'];

  const comparisons = summaries.slice(1).map((s) => ({
    productId: s.productId,
    productName: s.productName,
    brand: s.brand,
    deltas: Object.fromEntries(
      METRICS.map((metric) => {
        const base = baseline[metric];
        const value = s[metric];
        if (base === null || value === null) return [metric, null];
        return [
          metric,
          {
            baseline: base,
            value,
            delta: Number((value - base).toFixed(2)),
            deltaPct: base === 0 ? null : Number((((value - base) / base) * 100).toFixed(1)),
          },
        ];
      }),
    ),
  }));

  return {
    baselineProductId: baseline.productId,
    products: summaries,
    comparisons,
    // Long-format rows: one object per product per metric. This is the shape a
    // grouped bar chart wants, and building it here keeps the reshaping logic
    // out of the React component.
    chartSeries: METRICS.map((metric) => ({
      metric,
      data: summaries.map((s) => ({ label: `${s.brand} ${s.productName}`, value: s[metric] })),
    })),
  };
}
// ---------------------------------------------------------------------------
// BEST-OF-BEST — the Competitive Intelligence Engine's headline view
// ---------------------------------------------------------------------------
//
// Three leaderboards and one synthetic target:
//
//   1. Product leaders  — who wins each headline metric outright.
//   2. Module leaders   — who builds each AHU module cheapest, and lightest.
//   3. Composite target — the cost and weight you would get by taking the
//                         cheapest (or lightest) version of EVERY module from
//                         whichever competitor does it best. A unit nobody
//                         sells, and the number to beat.
//
// ---------------------------------------------------------------------------
// WHY THIS LIVES HERE AND NOT IN THE BROWSER
//
// Same rule as the rest of this file: benchmarkService is the only place a total
// is defined. The composite is a genuinely new aggregation, but everything it
// aggregates was already produced by buildCostEngineerView /
// buildDesignEngineerView — the per-module `cost` and `weightG` figures are
// taken verbatim, never re-summed from parts. That is the difference between
// deriving a new view and quietly growing a second cost engine.
//
// ---------------------------------------------------------------------------
// THE TWO HONEST CAVEATS, BOTH IN THE PAYLOAD RATHER THAN BURIED IN A COMMENT
//
// 1. NOT EVERY PRODUCT HAS EVERY MODULE. Electric Heater Assm is absent on two
//    of the four seeded units. So "cheapest Electric Heater" is a contest
//    between the two that have one, and the composite — which spans every
//    module seen anywhere — describes a FULLY-FEATURED unit. Comparing that
//    total against a product with no heater would flatter the composite by
//    exactly the price of a heater. So every product also gets a LIKE-FOR-LIKE
//    composite restricted to the modules it actually has, and that is the
//    comparison the UI leads with. `moduleCoverage` reports the gaps.
//
// 2. THE COMPOSITE IS NOT PURCHASABLE. Module costs come from different
//    products at different production scales, with no integration cost, no
//    re-engineering and no supplier reality. It is a floor for target-setting,
//    not a quote. `caveats` ships in the payload so the UI cannot render the
//    number without it.
// ---------------------------------------------------------------------------

/**
 * Metrics the product-level leaderboard ranks. All "lower is better".
 *
 * `costPerKg` is included because it was asked for, with one thing worth
 * knowing: a LOW cost/kg means cheap mass — heavy steel bought cheaply — so a
 * lightweight premium design scores badly on it by construction. It measures
 * cost efficiency of mass, not design quality. `note` carries that to the UI so
 * the metric cannot be read as "best engineered".
 */
const BOB_METRICS = Object.freeze([
  {
    key: 'totalCost',
    label: 'Lowest total cost',
    unit: 'currency',
    note: 'Total extended BOM cost across every costed part.',
  },
  {
    key: 'totalWeightKg',
    label: 'Lowest total weight',
    unit: 'kg',
    note: 'Total extended mass across every part.',
  },
  {
    key: 'partLines',
    label: 'Fewest part lines',
    unit: 'count',
    note: 'Distinct part lines — a proxy for assembly complexity.',
  },
  {
    key: 'costPerKg',
    label: 'Lowest cost per kg',
    unit: 'currencyPerKg',
    note: 'Cost efficiency of mass, not design quality — a light premium unit scores badly here by construction.',
  },
]);

/** Winner, runner-up and the gap between them, for one "lower is better" metric. */
function leaderFor(summaries, metric) {
  const ranked = summaries
    .filter((s) => s[metric.key] !== null && s[metric.key] !== undefined)
    .sort((a, b) => a[metric.key] - b[metric.key]);

  if (!ranked.length) return { ...metric, winner: null, runnerUp: null, ranking: [] };

  const asEntry = (s) => ({
    productId: s.productId,
    brand: s.brand,
    productName: s.productName,
    value: s[metric.key],
  });

  const winner = ranked[0];
  const runnerUp = ranked[1] ?? null;

  return {
    ...metric,
    winner: asEntry(winner),
    runnerUp: runnerUp ? asEntry(runnerUp) : null,
    // How far clear the winner is, framed as "the runner-up is X% worse" so the
    // sign is always positive and always means the same thing.
    gapToRunnerUpPct:
      runnerUp && winner[metric.key] > 0
        ? Number(
            (((runnerUp[metric.key] - winner[metric.key]) / winner[metric.key]) * 100).toFixed(1),
          )
        : null,
    ranking: ranked.map(asEntry),
  };
}

/**
 * Best-of-best across 2–5 products.
 *
 * @param {string|string[]} rawIds  "1,2,3" or an array. Unlike compareProducts
 *   there is no baseline — every product is ranked against every other.
 * @returns {Promise<object>} see the header comment above for the shape
 */
export async function buildBestOfBest(rawIds) {
  const list = Array.isArray(rawIds) ? rawIds : String(rawIds ?? '').split(',');
  const ids = list
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((v) => parseId(v, 'productId'));

  if (ids.length < 2) throw badRequest('Best-of-best requires at least two product ids');
  if (ids.length > 5) throw badRequest('Best-of-best supports at most five products');

  const teardowns = await products.getTeardowns(ids);
  if (teardowns.length !== ids.length) {
    const found = new Set(teardowns.map((t) => t.id));
    throw notFound(`No product with id ${ids.filter((i) => !found.has(i)).join(', ')}`);
  }

  // Same re-order as compareProducts: getTeardowns sorts by name, callers care
  // about the sequence they asked for.
  const ordered = ids.map((id) => teardowns.find((t) => t.id === id));

  // ---- per-product views, built once and reused --------------------------
  const views = ordered.map((teardown) => ({
    teardown,
    cost: buildCostEngineerView(teardown),
    design: buildDesignEngineerView(teardown),
  }));

  const currency = views[0].cost.currency;

  const summaries = views.map(({ teardown, cost, design }) => ({
    ...identity(teardown),
    totalCost: cost.totals.totalCost,
    totalWeightKg: design.totals.totalWeightKg,
    totalWeightG: design.totals.totalWeightG,
    partLines: cost.totals.partLines,
    partUnits: cost.totals.partUnits,
    costPerKg:
      design.totals.totalWeightKg > 0
        ? money(cost.totals.totalCost / design.totals.totalWeightKg)
        : null,
    moduleCount: cost.bySubAssembly.length,
  }));

  // ---- 1. product-level leaderboard -------------------------------------
  const productLeaders = BOB_METRICS.map((metric) => leaderFor(summaries, metric));

  // Who wins the most metrics outright — the "overall" line an exec looks for.
  const winTally = {};
  for (const leader of productLeaders) {
    if (!leader.winner) continue;
    winTally[leader.winner.productId] = (winTally[leader.winner.productId] ?? 0) + 1;
  }
  const topEntry = Object.entries(winTally).sort((a, b) => b[1] - a[1])[0];
  const overall = topEntry
    ? {
        ...summaries.find((s) => s.productId === Number(topEntry[0])),
        metricsWon: topEntry[1],
        metricsTotal: productLeaders.filter((l) => l.winner).length,
        // A 2-2 split has no real overall winner, and saying otherwise would be
        // reading a tie as a verdict.
        outright: Object.values(winTally).filter((n) => n === topEntry[1]).length === 1,
      }
    : null;

  // ---- 2. module-level leaderboard --------------------------------------
  // Module identity is the sub-assembly NAME, not its id — ids are per-product,
  // and the entire point is comparing "Cabinet Assm" across four teardowns.
  // seed.js guarantees the eight module names are identical across products.
  const moduleNames = [];
  for (const { cost } of views) {
    for (const row of cost.bySubAssembly) {
      if (!moduleNames.includes(row.name)) moduleNames.push(row.name);
    }
  }
  moduleNames.sort((a, b) => a.localeCompare(b));

  const moduleLeaders = moduleNames.map((moduleName) => {
    const entries = views
      .map(({ teardown, cost, design }) => {
        const costRow = cost.bySubAssembly.find((r) => r.name === moduleName);
        const weightRow = design.bySubAssembly.find((r) => r.name === moduleName);
        if (!costRow && !weightRow) return null;
        return {
          productId: teardown.id,
          brand: teardown.brand,
          productName: teardown.name,
          cost: costRow?.cost ?? null,
          weightG: weightRow?.weightG ?? null,
          partLines: costRow?.partLines ?? weightRow?.partLines ?? 0,
        };
      })
      .filter(Boolean);

    const byCost = entries.filter((e) => e.cost !== null).sort((a, b) => a.cost - b.cost);
    const byWeight = entries
      .filter((e) => e.weightG !== null)
      .sort((a, b) => a.weightG - b.weightG);

    return {
      module: moduleName,
      // Explicitly reported: a module only 2 of 4 products carry is a much
      // weaker "winner" than one all four compete on, and a reader should be
      // able to tell which they are looking at.
      productCount: entries.length,
      productTotal: views.length,
      cheapest: byCost[0] ?? null,
      dearest: byCost.length > 1 ? byCost[byCost.length - 1] : null,
      lightest: byWeight[0] ?? null,
      heaviest: byWeight.length > 1 ? byWeight[byWeight.length - 1] : null,
      // The spread is the size of the opportunity in that module.
      costSpreadPct:
        byCost.length > 1 && byCost[0].cost > 0
          ? Number(
              (((byCost[byCost.length - 1].cost - byCost[0].cost) / byCost[0].cost) * 100).toFixed(1),
            )
          : null,
      entries,
    };
  });

  // ---- 3. the composite target -----------------------------------------
  // Cheapest-of-each for cost, lightest-of-each for weight, selected
  // INDEPENDENTLY: the cost target is what a best-cost sourcing strategy
  // yields and the weight target what a best-mass one does. They are not the
  // same bill of materials, and one number implying both would be a quiet lie.
  // `sameSource` flags the modules where the two happen to agree.
  const compositeModules = moduleLeaders
    .filter((m) => m.cheapest || m.lightest)
    .map((m) => ({
      module: m.module,
      cost: m.cheapest?.cost ?? null,
      // productName carried alongside brand because a set can contain two
      // models from the same brand (Carrier FJ5ANXA18L and FJ5ANXC48L), and
      // "sourced from Carrier" would then be ambiguous.
      costFrom: m.cheapest
        ? {
            brand: m.cheapest.brand,
            productName: m.cheapest.productName,
            productId: m.cheapest.productId,
          }
        : null,
      weightG: m.lightest?.weightG ?? null,
      weightFrom: m.lightest
        ? {
            brand: m.lightest.brand,
            productName: m.lightest.productName,
            productId: m.lightest.productId,
          }
        : null,
      sameSource: m.cheapest && m.lightest ? m.cheapest.productId === m.lightest.productId : null,
      productCount: m.productCount,
    }));

  const compositeTotalCost = money(compositeModules.reduce((sum, m) => sum + (m.cost ?? 0), 0));
  const compositeTotalWeightG = grams(
    compositeModules.reduce((sum, m) => sum + (m.weightG ?? 0), 0),
  );
  const compositeTotalWeightKg = Number((compositeTotalWeightG / 1000).toFixed(3));

  /** The modules one product actually carries. */
  const modulesOf = (productId) =>
    new Set(
      views.find((v) => v.teardown.id === productId).cost.bySubAssembly.map((r) => r.name),
    );

  const vsProducts = summaries.map((s) => {
    const owned = modulesOf(s.productId);
    const subset = compositeModules.filter((m) => owned.has(m.module));

    // Like-for-like: the composite restricted to this product's own modules.
    // See caveat 1 — without this, a product with no electric heater looks
    // worse than it is by exactly the price of a heater.
    const lflCost = money(subset.reduce((sum, m) => sum + (m.cost ?? 0), 0));
    const lflWeightG = grams(subset.reduce((sum, m) => sum + (m.weightG ?? 0), 0));

    return {
      productId: s.productId,
      brand: s.brand,
      productName: s.productName,
      totalCost: s.totalCost,
      totalWeightKg: s.totalWeightKg,
      likeForLikeCompositeCost: lflCost,
      likeForLikeCompositeWeightKg: Number((lflWeightG / 1000).toFixed(3)),
      likeForLikeModules: subset.length,
      // "How much of this product's cost sits above best-in-class, module for
      // module." Positive means there is headroom to take out.
      headroomCost: money(s.totalCost - lflCost),
      headroomCostPct:
        lflCost > 0 ? Number((((s.totalCost - lflCost) / lflCost) * 100).toFixed(1)) : null,
      headroomWeightKg: Number((s.totalWeightKg - lflWeightG / 1000).toFixed(3)),
      headroomWeightPct:
        lflWeightG > 0
          ? Number(((((s.totalWeightKg * 1000) - lflWeightG) / lflWeightG) * 100).toFixed(1))
          : null,
      missingModules: compositeModules
        .map((m) => m.module)
        .filter((name) => !owned.has(name)),
    };
  });

  return {
    currency,
    products: summaries,
    productLeaders,
    overall,
    moduleLeaders,
    composite: {
      totalCost: compositeTotalCost,
      totalWeightG: compositeTotalWeightG,
      totalWeightKg: compositeTotalWeightKg,
      costPerKg:
        compositeTotalWeightKg > 0 ? money(compositeTotalCost / compositeTotalWeightKg) : null,
      moduleCount: compositeModules.length,
      modules: compositeModules,
      vsProducts,
      // Modules not every product carries, so the UI can say so out loud.
      moduleCoverage: moduleLeaders
        .filter((m) => m.productCount < m.productTotal)
        .map((m) => ({
          module: m.module,
          productCount: m.productCount,
          productTotal: m.productTotal,
        })),
      caveats: [
        'A target, not a purchasable unit — module costs come from different products at different production scales, with no integration or re-engineering cost included.',
        'Cheapest-per-module and lightest-per-module are chosen independently, so the cost target and the weight target are not the same bill of materials.',
        // Added once the set spanned 1.5, 3 and 4 tons. Before that every unit
        // was within one ton of the others and this was a footnote; with a
        // 1.5-ton in the mix the cheapest coil is cheapest largely because it
        // is a third of the size, which makes it an invalid target for a 4-ton
        // design. Stated plainly rather than left for the reader to notice.
        'Modules are compared across units of different rated capacity, so the cheapest version of a capacity-driven module (coil, blower, heater) may come from a smaller unit and not be a valid target for a larger one.',
      ],
    },
  };
}
