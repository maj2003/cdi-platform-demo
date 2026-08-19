// ---------------------------------------------------------------------------
// scripts/verify-bob.mjs — check the Best-of-Best leaderboards and composite.
//
//   npm run verify:bob        (from backend/)
//
// Recomputes the per-module minima INDEPENDENTLY from the persona view builders
// and compares them against what buildBestOfBest produced, so the aggregation is
// checked rather than echoed. Then asserts the invariants that actually matter:
//
//   * every metric's winner is really the minimum
//   * the composite equals the sum of per-module minima
//   * LIKE-FOR-LIKE composite <= that product's own total, for EVERY product.
//     This is the load-bearing one: a best-in-class target that exceeds a
//     product you can already buy is not a target, it's a bug.
//   * the raw composite is HIGHER than the cheapest product's total on this
//     dataset — the trap that makes like-for-like necessary. Asserted on
//     purpose, so anyone "simplifying" the page to compare raw totals breaks
//     this test instead of shipping a misleading number.
// ---------------------------------------------------------------------------

import { products, disconnect } from '../src/data/index.js';
import {
  buildBestOfBest,
  buildCostEngineerView,
  buildDesignEngineerView,
} from '../src/services/benchmarkService.js';

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  if (!Object.is(actual, expected)) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}
function close(actual, expected, label, tol = 0.02) {
  checks += 1;
  if (!(typeof actual === 'number' && Math.abs(actual - expected) <= tol)) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ~${expected}\n          actual   ${JSON.stringify(actual)}`);
  }
}
function ok(condition, label, extra = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? `\n          ${extra}` : ''}`);
  }
}

// ===========================================================================
console.log('\nBEST-OF-BEST — live Prisma\n');

/**
 * The five SEEDED products, in id order.
 *
 * Since the BOM Authoring Workbench landed, a user can create products in-app,
 * so the database can hold more than the seeded set. buildBestOfBest caps at
 * five, so passing every id would make this script THROW rather than report — a
 * much worse failure mode than a failed assertion. The seeded models are named
 * explicitly, and anything extra is noted and ignored.
 */
const SEEDED = ['AMST48CU300', 'BVA36WN1-M15', 'FJ5ANXC48L', '5TEMCB02', 'FJ5ANXA18L'];
const allProducts = await products.listProducts();
const list = allProducts
  .filter((p) => SEEDED.includes(p.name))
  .sort((a, b) => a.id - b.id);
const extras = allProducts.filter((p) => !SEEDED.includes(p.name));
if (extras.length) {
  console.log(
    `  note  ignoring ${extras.length} non-seeded product${extras.length === 1 ? '' : 's'} ` +
      `(${extras.map((p) => `${p.brand} ${p.name}`).join(', ')})\n`,
  );
}

const ids = list.map((p) => p.id);
ok(ids.length >= 2, 'at least two products to rank');
eq(ids.length, SEEDED.length, `all ${SEEDED.length} seeded products found`);

const bob = await buildBestOfBest(ids);

// ---- independent recomputation -------------------------------------------
// Walk the persona views ourselves and build our own module -> minima map.
const own = new Map(); // module -> { minCost, minCostBrand, minWeight, minWeightBrand, n }
const ownTotals = [];

for (const id of ids) {
  const teardown = await products.getTeardown(id);
  const cost = buildCostEngineerView(teardown);
  const design = buildDesignEngineerView(teardown);

  ownTotals.push({
    brand: teardown.brand,
    productId: id,
    totalCost: cost.totals.totalCost,
    totalWeightKg: design.totals.totalWeightKg,
    partLines: cost.totals.partLines,
    costPerKg: cost.totals.totalCost / design.totals.totalWeightKg,
    modules: new Set(cost.bySubAssembly.map((r) => r.name)),
  });

  for (const row of cost.bySubAssembly) {
    const entry = own.get(row.name) ?? { n: 0 };
    entry.n += 1;
    if (entry.minCost === undefined || row.cost < entry.minCost) {
      entry.minCost = row.cost;
      entry.minCostBrand = teardown.brand;
    }
    own.set(row.name, entry);
  }
  for (const row of design.bySubAssembly) {
    const entry = own.get(row.name);
    if (entry.minWeight === undefined || row.weightG < entry.minWeight) {
      entry.minWeight = row.weightG;
      entry.minWeightBrand = teardown.brand;
    }
  }
}

// ---- 1. product leaderboard ----------------------------------------------
console.log('PRODUCT LEADERBOARD');
for (const leader of bob.productLeaders) {
  const values = ownTotals.map((t) => t[leader.key]);
  const trueMin = Math.min(...values);
  const trueWinner = ownTotals.find((t) => t[leader.key] === trueMin);

  eq(leader.winner.brand, trueWinner.brand, `${leader.label}: winner is the true minimum`);
  close(leader.winner.value, trueMin, `${leader.label}: winning value`, 0.02);
  ok(leader.ranking.length === ownTotals.length, `${leader.label}: full ranking returned`);
  // Ranking must be ascending — "lower is better" for every metric here.
  ok(
    leader.ranking.every((r, i, arr) => i === 0 || arr[i - 1].value <= r.value),
    `${leader.label}: ranking is ascending`,
  );
  console.log(`    ${leader.label.padEnd(22)} ${leader.winner.brand.padEnd(9)} ${leader.winner.value}`);
}
eq(bob.productLeaders.length, 4, 'all four metrics ranked');
ok(bob.overall !== null, 'an overall leader is reported');
eq(
  bob.overall.metricsWon,
  bob.productLeaders.filter((l) => l.winner.productId === bob.overall.productId).length,
  'overall metricsWon matches the per-metric winners',
);

// ---- 2. module leaderboard ----------------------------------------------
console.log('\nMODULE LEADERBOARD');
eq(bob.moduleLeaders.length, own.size, 'every module appears exactly once');
for (const m of bob.moduleLeaders) {
  const mine = own.get(m.module);
  ok(mine !== undefined, `module ${m.module} was seen in the raw views`);
  eq(m.cheapest.brand, mine.minCostBrand, `${m.module}: cheapest brand`);
  close(m.cheapest.cost, mine.minCost, `${m.module}: cheapest cost`, 0.02);
  eq(m.lightest.brand, mine.minWeightBrand, `${m.module}: lightest brand`);
  close(m.lightest.weightG, mine.minWeight, `${m.module}: lightest weight`, 0.2);
  eq(m.productCount, mine.n, `${m.module}: product count`);
  eq(m.productTotal, ids.length, `${m.module}: product total`);
  console.log(
    `    ${m.module.padEnd(24)} ${String(m.productCount)}/${m.productTotal}  ` +
      // Model rather than brand: two Carrier models are in the set, so brand
      // alone makes the output unreadable.
      `cheapest ${m.cheapest.productName.padEnd(13)} $${String(m.cheapest.cost).padEnd(7)} ` +
      `lightest ${m.lightest.productName.padEnd(13)} ${(m.lightest.weightG / 1000).toFixed(2)}kg`,
  );
}

// Coverage gaps must be reported, not silently absorbed.
const partial = [...own.entries()].filter(([, v]) => v.n < ids.length).map(([k]) => k);
eq(
  bob.composite.moduleCoverage.length,
  partial.length,
  'every partially-present module is reported in moduleCoverage',
);
for (const name of partial) {
  ok(
    bob.composite.moduleCoverage.some((c) => c.module === name),
    `moduleCoverage names ${name}`,
  );
}

// ---- 3. the composite ---------------------------------------------------
console.log('\nCOMPOSITE TARGET');
const trueCompositeCost = [...own.values()].reduce((s, v) => s + v.minCost, 0);
const trueCompositeWeightG = [...own.values()].reduce((s, v) => s + v.minWeight, 0);

close(bob.composite.totalCost, trueCompositeCost, 'composite cost = sum of per-module minima', 0.05);
close(
  bob.composite.totalWeightG,
  trueCompositeWeightG,
  'composite weight = sum of per-module minima',
  0.5,
);
eq(bob.composite.moduleCount, own.size, 'composite spans every module');
close(
  bob.composite.costPerKg,
  bob.composite.totalCost / (bob.composite.totalWeightG / 1000),
  'composite cost/kg is consistent with its own totals',
  0.02,
);
console.log(
  `    $${bob.composite.totalCost}  ${bob.composite.totalWeightKg} kg  ` +
    `$${bob.composite.costPerKg}/kg  over ${bob.composite.moduleCount} modules`,
);

// Each module's cost target must come from the product that actually achieves it.
for (const m of bob.composite.modules) {
  const mine = own.get(m.module);
  eq(m.costFrom.brand, mine.minCostBrand, `composite ${m.module}: cost sourced from the winner`);
  eq(m.weightFrom.brand, mine.minWeightBrand, `composite ${m.module}: weight sourced from the winner`);
}

// ---- THE LOAD-BEARING INVARIANT ----------------------------------------
console.log('\nHEADROOM (like-for-like)');
for (const v of bob.composite.vsProducts) {
  const mine = ownTotals.find((t) => t.productId === v.productId);

  // Recompute the like-for-like target independently: minima over only the
  // modules this product actually carries.
  const lflCost = [...own.entries()]
    .filter(([name]) => mine.modules.has(name))
    .reduce((s, [, val]) => s + val.minCost, 0);
  const lflWeightG = [...own.entries()]
    .filter(([name]) => mine.modules.has(name))
    .reduce((s, [, val]) => s + val.minWeight, 0);

  close(v.likeForLikeCompositeCost, lflCost, `${v.brand}: like-for-like target cost`, 0.05);
  close(
    v.likeForLikeCompositeWeightKg * 1000,
    lflWeightG,
    `${v.brand}: like-for-like target weight`,
    0.5,
  );

  // A best-in-class target can never exceed a product built to that spec.
  ok(
    v.likeForLikeCompositeCost <= v.totalCost + 0.02,
    `${v.brand}: like-for-like target does NOT exceed its own total cost`,
    `target ${v.likeForLikeCompositeCost} vs actual ${v.totalCost}`,
  );
  ok(
    v.likeForLikeCompositeWeightKg <= v.totalWeightKg + 0.001,
    `${v.brand}: like-for-like target does NOT exceed its own total weight`,
    `target ${v.likeForLikeCompositeWeightKg} vs actual ${v.totalWeightKg}`,
  );
  ok(v.headroomCost >= -0.02, `${v.brand}: cost headroom is non-negative`);
  ok(v.headroomCostPct >= -0.1, `${v.brand}: cost headroom % is non-negative`);
  close(
    v.headroomCost,
    v.totalCost - v.likeForLikeCompositeCost,
    `${v.brand}: headroom = actual − target`,
    0.02,
  );

  // Missing modules must be exactly the ones this product lacks.
  const trulyMissing = [...own.keys()].filter((n) => !mine.modules.has(n)).sort();
  eq(
    JSON.stringify([...v.missingModules].sort()),
    JSON.stringify(trulyMissing),
    `${v.brand}: missingModules is accurate`,
  );

  console.log(
    `    ${`${v.brand} ${v.productName}`.padEnd(24)} actual $${String(v.totalCost).padEnd(8)} ` +
      `target $${String(v.likeForLikeCompositeCost).padEnd(8)} ` +
      `headroom $${String(v.headroomCost).padEnd(8)} (+${v.headroomCostPct}%)` +
      (v.missingModules.length ? `  [no ${v.missingModules.join(', ')}]` : ''),
  );
}

// ---- the trap, asserted on purpose --------------------------------------
// On this dataset the RAW composite exceeds the cheapest product's total,
// because it includes a module that product doesn't have. If anyone changes the
// page to compare raw totals, this fails rather than quietly shipping "the
// best-in-class target is worse than the Goodman".
console.log('\nTHE LIKE-FOR-LIKE TRAP');
const cheapestReal = [...ownTotals].sort((a, b) => a.totalCost - b.totalCost)[0];
if (partial.length > 0) {
  ok(
    bob.composite.totalCost > cheapestReal.totalCost,
    'raw composite exceeds the cheapest real product (because of the partial module)',
    `composite ${bob.composite.totalCost} vs ${cheapestReal.brand} ${cheapestReal.totalCost}`,
  );
  const cheapestVs = bob.composite.vsProducts.find((v) => v.productId === cheapestReal.productId);
  ok(
    cheapestVs.likeForLikeCompositeCost < cheapestReal.totalCost,
    'but its LIKE-FOR-LIKE target is below its own total — which is why that framing exists',
    `lfl ${cheapestVs.likeForLikeCompositeCost} vs actual ${cheapestReal.totalCost}`,
  );
  console.log(
    `    raw composite $${bob.composite.totalCost} > ${cheapestReal.brand} $${cheapestReal.totalCost}, ` +
      `but like-for-like $${cheapestVs.likeForLikeCompositeCost} < $${cheapestReal.totalCost}  ✓`,
  );
}

// Caveats must ship with the payload — the UI relies on them being there.
ok(bob.composite.caveats.length >= 2, 'the composite carries its caveats in the payload');

// ---- validation ---------------------------------------------------------
console.log('\nVALIDATION');
let threw = null;
try {
  await buildBestOfBest(String(ids[0]));
} catch (err) {
  threw = err;
}
eq(threw?.status, 400, 'a single product id is rejected with 400');

threw = null;
try {
  await buildBestOfBest('999998,999999');
} catch (err) {
  threw = err;
}
eq(threw?.status, 404, 'unknown product ids are rejected with 404');

threw = null;
try {
  await buildBestOfBest('1,2,3,4,5,6');
} catch (err) {
  threw = err;
}
eq(threw?.status, 400, 'more than five products is rejected with 400');

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
await disconnect();
if (failures > 0) process.exitCode = 1;
