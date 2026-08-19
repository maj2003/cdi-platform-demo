// ---------------------------------------------------------------------------
// scripts/verify-seed.mjs — check the seeded AHU benchmark set against live data.
//
//   npm run verify:seed        (from backend/)
//
// Reads through the real data layer (= live Prisma) and the real
// benchmarkService, not a copy of either, then asserts:
//   - 4 products, in the intended baseline order
//   - the 8 Level-1 module names, and that every part's `moduleName` column
//     agrees with the sub-assembly it actually lives under
//   - geometryType is sane per part class (cabinet panels sheet_metal, coil
//     tubing circular, ...)
//   - per-module cost and weight rollups work AND sum to the product totals
//   - the benchmarking story holds: cheapest / lightest / over-engineered are
//     the products they're supposed to be
//
// Expected totals are hand-computed literals from the catalog, so a silent
// arithmetic change in benchmarkService would fail this rather than move with it.
// ---------------------------------------------------------------------------

import { products, parts, disconnect } from '../src/data/index.js';
import {
  buildCostEngineerView,
  buildDesignEngineerView,
  compareProducts,
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

const MODULES = [
  'Packaging Assm',
  'Cabinet Assm',
  'Coil Assm - Evaporator',
  'Blower Assm',
  'Electrical Assm',
  'Condensate Mgmt Assm',
  'Air Filtration Assm',
  'Electric Heater Assm',
];

/**
 * Hand-computed from the catalog, in catalog (= cost ramp) order.
 *
 * Two products share the brand "Carrier", so everything below keys on
 * brand + name rather than brand alone.
 */
const EXPECTED = [
  { brand: 'Goodman', name: 'AMST48CU300', modules: 7, parts: 16, weightG: 49195, cost: 250.18 },
  { brand: 'Carrier', name: 'FJ5ANXA18L', modules: 8, parts: 19, weightG: 37236, cost: 275.67 },
  { brand: 'Bosch', name: 'BVA36WN1-M15', modules: 7, parts: 18, weightG: 33970, cost: 323.46 },
  { brand: 'Carrier', name: 'FJ5ANXC48L', modules: 8, parts: 21, weightG: 54425, cost: 367.98 },
  { brand: 'Trane', name: '5TEMCB02', modules: 8, parts: 25, weightG: 64636, cost: 499.21 },
];

const label = (p) => `${p.brand} ${p.name}`;

// ===========================================================================
console.log('\nSEEDED AHU BENCHMARK SET — live Prisma\n');

const all = await products.listProducts();

/**
 * The SEEDED products only.
 *
 * Since the BOM Authoring Workbench landed, a user can create products in-app,
 * so the database legitimately contains rows this script knows nothing about.
 * Asserting "the database has exactly five products" would then fail for a
 * correct app, and passing every id to compareProducts (capped at five) would
 * make the script CRASH rather than report — which is a much worse failure mode.
 * So this verifies the seeded set specifically, and simply notes anything extra.
 */
const list = EXPECTED.map((e) => all.find((p) => p.brand === e.brand && p.name === e.name)).filter(
  Boolean,
);
const extras = all.filter((p) => !list.includes(p));

eq(list.length, EXPECTED.length, `all ${EXPECTED.length} seeded products are present`);
if (extras.length) {
  console.log(
    `  note  ${extras.length} non-seeded product${extras.length === 1 ? '' : 's'} also in the database ` +
      `(${extras.map((p) => `${p.brand} ${p.name}`).join(', ')}) — ignored by this script.`,
  );
}
ok(
  !list.some((p) => p.category.includes('Split AC')),
  'no split-AC products left behind from the previous seed',
  `found: ${list.map(label).join(', ')}`,
);

// Set equality rather than positional matching.
//
// The catalog is ordered as the cost ramp, and on a database seeded from empty
// that is also id order. But a product ADDED later takes the next autoincrement
// id and therefore sorts last regardless of where it sits in the catalog — the
// FJ5ANXA18L is second in the catalog and last by id on this database. So
// asserting "product 1 is the A18L" would only pass on a freshly-created
// database, which is a worse test, not a better one. What actually matters is
// asserted instead: the full set is present, the baseline is the lowest id, and
// the cost ramp holds when sorted by cost.
for (const expected of EXPECTED) {
  ok(
    list.some((p) => p.brand === expected.brand && p.name === expected.name),
    `${label(expected)} is present`,
  );
}
// Against the genuinely lowest id, not list[0] — `list` is now built in EXPECTED
// order, so checking list[0] would be checking the array literal, not the data.
eq(
  label([...list].sort((a, b) => a.id - b.id)[0]),
  'Goodman AMST48CU300',
  'the lowest-id seeded product is still the Goodman baseline',
);
ok(
  list.filter((p) => p.brand === 'Carrier').length === 2,
  'both Carrier models are present and distinguishable by name',
  list.filter((p) => p.brand === 'Carrier').map((p) => p.name).join(', '),
);

const rows = [];

for (const expected of EXPECTED) {
  const listed = list.find((p) => p.brand === expected.brand && p.name === expected.name);
  if (!listed) {
    failures += 1;
    console.log(`  FAIL  ${expected.brand} ${expected.name} is missing entirely`);
    continue;
  }

  console.log(`${expected.brand} — ${expected.name}  (id=${listed.id})`);

  const teardown = await products.getTeardown(listed.id);
  const cost = buildCostEngineerView(teardown);
  const design = buildDesignEngineerView(teardown);

  // ---- the ILLUSTRATIVE DATA guard rail is present -----------------------
  ok(
    listed.notes?.startsWith('ILLUSTRATIVE DATA'),
    'notes open with the ILLUSTRATIVE DATA disclaimer (it renders in the UI)',
  );

  // ---- module structure -------------------------------------------------
  const subNames = teardown.subAssemblies.map((s) => s.name);
  eq(subNames.length, expected.modules, `${expected.modules} Level-1 modules`);
  ok(
    subNames.every((n) => MODULES.includes(n)),
    'every sub-assembly is one of the 8 documented AHU modules',
    `got: ${subNames.join(' | ')}`,
  );
  // Electric Heater Assm is deliberately absent on two models.
  eq(
    subNames.includes('Electric Heater Assm'),
    expected.modules === 8,
    `Electric Heater Assm ${expected.modules === 8 ? 'present' : 'absent'} as designed`,
  );

  // ---- moduleName column agrees with the tree ---------------------------
  // The important one: the sub-assembly drives every report rollup, while
  // moduleName is what a BOM export reads. If they disagree, one screen is
  // lying and nothing warns you.
  let mismatched = 0;
  let missingModuleName = 0;
  for (const sub of teardown.subAssemblies) {
    for (const part of sub.parts) {
      if (part.moduleName === null) missingModuleName += 1;
      else if (part.moduleName !== sub.name) mismatched += 1;
    }
  }
  eq(missingModuleName, 0, 'no part has a null moduleName');
  eq(mismatched, 0, 'every part.moduleName matches its sub-assembly name');

  // ---- part count and BOM metadata coverage -----------------------------
  const allParts = teardown.subAssemblies.flatMap((s) => s.parts);
  eq(allParts.length, expected.parts, `${expected.parts} part lines`);
  ok(allParts.length >= 15 && allParts.length <= 25, 'part count within the 15-25 target');

  eq(allParts.filter((p) => !p.partNo).length, 0, 'every part has a partNo');
  eq(allParts.filter((p) => !p.commodity).length, 0, 'every part has a commodity');
  eq(allParts.filter((p) => !p.primaryProcess).length, 0, 'every part has a primaryProcess');
  eq(allParts.filter((p) => !p.surfaceFinish).length, 0, 'every part has a surfaceFinish');
  eq(allParts.filter((p) => !p.geometryType).length, 0, 'every part has a geometryType');
  eq(allParts.filter((p) => !p.material).length, 0, 'every part has a material');
  eq(allParts.filter((p) => !p.description).length, 0, 'every part has a description');
  eq(allParts.filter((p) => p.weightG === null).length, 0, 'every part has a weight');
  eq(allParts.filter((p) => p.weightLbs === null).length, 0, 'every part carries weight in lbs too');
  eq(allParts.filter((p) => p.costs.length === 0).length, 0, 'every part has a cost row');
  eq(allParts.filter((p) => !p.functionName || !p.comparisonName).length, 0,
    'every part has functionName + comparisonName (needed for cross-product comparison)');

  // weightLbs must actually agree with weightG, not just be non-null.
  const badLbs = allParts.filter(
    (p) => Math.abs(p.weightLbs - p.weightG / 453.59237) > 0.001,
  );
  eq(badLbs.length, 0, 'weightLbs agrees with weightG on every part');

  // ---- geometryType is right for the part class -------------------------
  const cabinetPanels = allParts.filter((p) => /Wrapper Panel|Base Pan$/.test(p.name));
  ok(
    cabinetPanels.length > 0 &&
      cabinetPanels.every((p) => p.geometryType === 'sheet_metal' || p.material.startsWith('PP')),
    'cabinet panels are sheet_metal (or custom where they are moulded composite)',
    cabinetPanels.map((p) => `${p.name}=${p.geometryType}`).join(', '),
  );
  const coilSlab = allParts.find((p) => /Evaporator Coil/.test(p.name));
  eq(coilSlab?.geometryType, 'circular', 'the evaporator coil slab is circular');
  ok(coilSlab?.diameterOuterMm > 0, 'the coil slab carries a tube outer diameter');
  ok(coilSlab?.fpi > 0, 'the coil slab carries fins-per-inch');
  const boards = allParts.filter((p) => /Board|Module$/.test(p.name) && p.commodity === 'Electrical');
  ok(
    boards.length > 0 && boards.every((p) => p.geometryType === 'rectangular'),
    'electrical boards are rectangular',
    boards.map((p) => `${p.name}=${p.geometryType}`).join(', '),
  );

  // ---- per-module rollups work and reconcile to the product totals ------
  const byModule = cost.bySubAssembly;
  eq(byModule.length, expected.modules, 'cost rolls up across every module');
  ok(
    byModule.every((m) => MODULES.includes(m.name)),
    'every cost-rollup group is named after a real module',
  );
  const moduleCostSum = byModule.reduce((s, m) => s + m.cost, 0);
  close(moduleCostSum, cost.totals.totalCost, 'per-module costs sum to the product total', 0.05);

  const weightByModule = design.bySubAssembly;
  eq(weightByModule.length, expected.modules, 'weight rolls up across every module');
  const moduleWeightSum = weightByModule.reduce((s, m) => s + m.weightG, 0);
  close(moduleWeightSum, design.totals.totalWeightG, 'per-module weights sum to the product total', 1);

  // ---- totals match the hand-computed catalog figures -------------------
  close(cost.totals.totalCost, expected.cost, 'total cost matches the catalog');
  close(design.totals.totalWeightG, expected.weightG, 'total weight matches the catalog', 1);

  const topModule = [...byModule].sort((a, b) => b.cost - a.cost)[0];
  console.log(
    `    ${expected.parts} parts · ${(design.totals.totalWeightG / 1000).toFixed(1)} kg · ` +
      `$${cost.totals.totalCost.toFixed(2)} · $${(cost.totals.totalCost / (design.totals.totalWeightG / 1000)).toFixed(2)}/kg · ` +
      `top module ${topModule.name} $${topModule.cost.toFixed(2)}\n`,
  );

  rows.push({
    brand: expected.brand,
    // Two Carriers in the set, so the story checks below identify products by
    // brand + name. Brand alone would make "which Carrier" ambiguous.
    label: label(expected),
    parts: allParts.length,
    weightKg: design.totals.totalWeightG / 1000,
    cost: cost.totals.totalCost,
    costPerKg: cost.totals.totalCost / (design.totals.totalWeightG / 1000),
  });
}

// ===========================================================================
// The benchmarking story — this is what makes the comparison views worth looking at
// ===========================================================================
console.log('THE BENCHMARKING STORY');

const by = (key) => [...rows].sort((a, b) => a[key] - b[key]);
const cheapest = by('cost')[0];
const dearest = by('cost')[rows.length - 1];
const lightest = by('weightKg')[0];
const heaviest = by('weightKg')[rows.length - 1];
const mostParts = [...rows].sort((a, b) => b.parts - a.parts)[0];
const highestCostPerKg = [...rows].sort((a, b) => b.costPerKg - a.costPerKg)[0];

// These four crowns are the documented benchmarking story. Adding the 1.5-ton
// A18L could easily have taken the cheapest and lightest titles just by being
// small — it is deliberately positioned above the Goodman on cost and above the
// Bosch on weight so it doesn't (see seed.js's header). If that positioning ever
// drifts, these fail rather than the story silently changing.
eq(cheapest.label, 'Goodman AMST48CU300', 'Goodman is still the cheapest (budget baseline)');
eq(lightest.label, 'Bosch BVA36WN1-M15', 'Bosch is still the lightest');
eq(highestCostPerKg.label, 'Bosch BVA36WN1-M15', 'Bosch still has the highest cost/kg');
eq(dearest.label, 'Trane 5TEMCB02', 'Trane is still the most expensive (over-engineered)');
eq(heaviest.label, 'Trane 5TEMCB02', 'Trane is still the heaviest');
eq(mostParts.label, 'Trane 5TEMCB02', 'Trane still has the most parts');

// The new Carrier sits where it was designed to: second on cost, second on weight.
eq(by('cost')[1].label, 'Carrier FJ5ANXA18L', 'the A18L is second cheapest');
eq(by('weightKg')[1].label, 'Carrier FJ5ANXA18L', 'the A18L is second lightest');
ok(
  by('cost')[1].cost > cheapest.cost,
  'the A18L costs MORE than the Goodman despite being far smaller (ECM + TXV + heat content)',
  `${by('cost')[1].cost} vs ${cheapest.cost}`,
);
ok(
  by('weightKg')[1].weightKg > lightest.weightKg,
  'the A18L is HEAVIER than the 3-ton Bosch (G90 steel vs composite build)',
  `${by('weightKg')[1].weightKg} vs ${lightest.weightKg}`,
);

// Every product must be distinguishable, or the charts are identical bars.
const costs = rows.map((r) => r.cost);
ok(new Set(costs).size === rows.length, 'every total cost is distinct');
ok(
  Math.min(...costs) * 1.5 < Math.max(...costs),
  'the cost spread is wide enough to be visible on a chart',
  `min ${Math.min(...costs).toFixed(2)} max ${Math.max(...costs).toFixed(2)}`,
);
ok(new Set(rows.map((r) => r.parts)).size === rows.length, 'every part count is distinct');

// ---- compare endpoint across the whole set -------------------------------
// Note: compareProducts caps at five, so the set is now exactly at that ceiling.
// A sixth product would need the cap raised in benchmarkService, ComparePage and
// BestOfBestPage together.
console.log(`\nCOMPARE (all ${rows.length}, Goodman as baseline)`);
// Seeded ids in id order, so the baseline is the Goodman and the cap is respected
// even when the database also holds products created in-app.
const ids = [...list].sort((a, b) => a.id - b.id).map((p) => p.id);
const comparison = await compareProducts(ids);
eq(comparison.products.length, EXPECTED.length, 'compare returns every product');
eq(comparison.baselineProductId, ids[0], 'Goodman is the baseline');
eq(
  comparison.comparisons.length,
  EXPECTED.length - 1,
  'every non-baseline product is compared against it',
);
ok(
  comparison.products.every((p) => p.costBySubAssembly.length >= 7),
  'every product supplies a per-module cost series for the chart',
);
// Delta objects are { baseline, value, delta, deltaPct } — see compareProducts.
const signed = (n) => `${n > 0 ? '+' : ''}${n}%`;
for (const c of comparison.comparisons) {
  const d = c.deltas.totalCost;
  ok(d !== null && d.deltaPct > 0, `${c.brand} costs more than the baseline (${signed(d?.deltaPct)})`);
  console.log(
    // brand + model: two Carriers in the set make brand alone ambiguous.
    `    ${`${c.brand} ${c.productName}`.padEnd(24)} cost ${signed(d.deltaPct).padEnd(8)} ` +
      `weight ${signed(c.deltas.totalWeightKg.deltaPct).padEnd(8)} ` +
      `cost/kg ${signed(c.deltas.costPerKg.deltaPct)}`,
  );
}

// Bosch must be lighter than the baseline while costing more — the divergence
// that makes the indexed compare chart interesting rather than four parallel lines.
const bosch = comparison.comparisons.find((c) => c.brand === 'Bosch');
ok(bosch.deltas.totalWeightKg.deltaPct < 0, 'Bosch is lighter than the baseline');
ok(bosch.deltas.totalCost.deltaPct > 0, 'Bosch still costs more than the baseline');
ok(
  bosch.deltas.costPerKg.deltaPct > 50,
  'Bosch cost/kg is dramatically above baseline — the premium-compact story',
  `got ${bosch.deltas.costPerKg.deltaPct}%`,
);

// ---- flat parts read (the endpoint the BOM export uses) -------------------
// Looked up by name rather than by list position: an appended product shifts
// every index, and a test that silently starts checking a different product is
// worse than one that fails.
const trane = list.find((p) => p.name === '5TEMCB02');
const flat = await parts.listByProduct(trane.id);
eq(flat.length, 25, 'flat per-product parts read returns all 25 Trane parts');
ok(flat.every((p) => p.subAssembly?.name), 'flat parts carry their sub-assembly name');

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
await disconnect();
if (failures > 0) process.exitCode = 1;
