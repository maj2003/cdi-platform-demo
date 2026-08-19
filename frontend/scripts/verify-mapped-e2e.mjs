// ---------------------------------------------------------------------------
// scripts/verify-mapped-e2e.mjs
//
// End-to-end check of the Daikin Mapped BOM import: parse the fixture with the
// real parser, POST all four products to the real running backend exactly as the
// panel does (one call per sheet, in sequence), read the rows back out, and
// confirm the app's own cost and weight reports reproduce the SOURCE
// SPREADSHEET's stated subtotals — not this script's arithmetic.
//
//   (backend must be running on :4000)
//   node scripts/make-mapped-fixture.mjs && node scripts/verify-mapped-e2e.mjs
//
// The point of the round trip is that a parse test can't catch a field that the
// backend's normaliser silently drops. Every column the brief asked to preserve
// is therefore read back OUT OF SQLITE here, not just checked in the parse.
//
// Cleans up after itself: all four imported products are deleted at the end, so
// the seeded demo data is left exactly as it was found. Set KEEP=1 to keep them.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

import { parseBomWorkbook } from '../src/lib/importWorkbook.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api';
const KEEP = process.env.KEEP === '1';
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../backend/fixtures/mapped/SYNTHETIC-Daikin-Mapped-BOMs.xlsx',
);

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  if (!Object.is(actual, expected)) {
    failures += 1;
    console.log(
      `  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`,
    );
  }
}
function close(actual, expected, label, tol = 0.01) {
  checks += 1;
  if (!(typeof actual === 'number' && Math.abs(actual - expected) <= tol)) {
    failures += 1;
    console.log(
      `  FAIL  ${label}\n          expected ~${expected} (±${tol})\n          actual   ${JSON.stringify(actual)}`,
    );
  }
}
function ok(condition, label, extra = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? `\n          ${extra}` : ''}`);
  }
}

async function call(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body };
}

const created = [];

// ===========================================================================
console.log('\nDAIKIN MAPPED BOM — END TO END\n');

const health = await call('/products');
if (health.status !== 200) {
  console.log(`  backend not reachable at ${API} (status ${health.status}). Start it first.`);
  process.exit(1);
}
// Sweep any leftovers from an interrupted run, so "four new products" and the
// final cleanup assertion both measure from a known baseline.
for (const stale of health.body.data.filter((p) => /^ZZ Mapped/.test(p.brand))) {
  await call(`/products/${stale.id}`, { method: 'DELETE' });
  console.log(`  swept a leftover from an earlier run: ${stale.brand} ${stale.name}`);
}
const productsBefore = ((await call('/products')).body?.data ?? []).length;

const workbook = XLSX.read(readFileSync(FIXTURE), { type: 'buffer' });
const parsed = parseBomWorkbook(workbook, { fileName: 'Daikin Mapped BOMs.xlsx' });
eq(parsed.format, 'mapped', 'the dispatcher routed the file to the Mapped parser');
eq(parsed.products.length, 5, 'five BOM-shaped sheets parsed');

// The panel imports what is TICKED, and a likely-template sheet starts unticked.
// This mirrors that: the template is parsed, reported, and not written — which is
// the whole fix for "Reference BOM - Template" arriving as a manufacturer.
const toImport = parsed.products.filter((p) => !p.summary.isLikelyTemplate);
const excluded = parsed.products.filter((p) => p.summary.isLikelyTemplate);
eq(toImport.length, 4, 'four of them are products to import');
eq(excluded.length, 1, 'one is held back as a template');
eq(excluded[0]?.summary.sheet, 'Reference BOM - Template', 'and it is the template sheet');

// ---------------------------------------------------------------------------
// Import all four, the way the panel does: one POST per sheet, in sequence.
// Renamed to a "ZZ Mapped" brand so this never collides with the seeded five
// and is trivially identifiable if a cleanup is ever interrupted.
// ---------------------------------------------------------------------------
console.log('IMPORT (one POST per sheet)');
const imported = [];
for (const entry of toImport) {
  const res = await call('/products/import', {
    method: 'POST',
    body: JSON.stringify({
      product: { ...entry.product, brand: `ZZ Mapped ${entry.product.brand}` },
      parts: entry.parts,
      // replaceExisting so an interrupted earlier run can't wedge this one. The
      // first version of this script didn't, and a crash before cleanup left four
      // products behind that then 409'd every subsequent run — a verification
      // script that only passes on a pristine database isn't much of one. The
      // 409 behaviour still gets its own explicit test further down.
      replaceExisting: true,
    }),
  });
  eq(res.status, 201, `POST ${entry.summary.sheet} -> 201`);
  const product = res.body?.data?.product;
  ok(Boolean(product?.id), `${entry.summary.sheet}: got a product id`);
  if (product?.id) created.push(product.id);
  imported.push({ entry, product, summary: res.body?.data?.summary });
}

const after = await call('/products');
eq(after.body.data.length, productsBefore + 4, 'four new products exist in the repository');

// ---------------------------------------------------------------------------
// GOODMAN — the supplied sheet, read back out of SQLite
// ---------------------------------------------------------------------------
const goodman = imported.find((i) => i.entry.summary.sheet === 'Main BOM Goodman');
const gid = goodman.product.id;

console.log('\nGOODMAN — structure as stored');
eq(goodman.summary.partLines, 101, 'the server reports 101 parts written');
eq(goodman.summary.partUnits, 412, 'and 412 part units');
eq(goodman.summary.modules.length, 7, 'seven modules created — not the declared-but-empty eighth');
ok(
  !goodman.summary.modules.some((m) => m.name === 'Electric Heater Assm'),
  'the empty Electric Heater Assm was NOT created',
);
ok(
  !goodman.summary.modules.some((m) => m.name === 'Air Filtation Assm'),
  'the misspelled module name is not in the database',
);
ok(
  goodman.summary.modules.some((m) => m.name === 'Air Filtration Assm'),
  'the canonical spelling is',
);
eq(goodman.summary.costedParts, 80, '80 of the 101 parts have a cost row');
eq(goodman.summary.weighedParts, 70, '70 have a weight');

const teardown = (await call(`/products/${gid}/teardown`)).body.data;
const allParts = teardown.subAssemblies.flatMap((s) => s.parts);
eq(allParts.length, 101, 'reading the teardown back gives 101 parts');

const MODULE_COUNTS = {
  'Packaging Assm': 8,
  'Cabinet Assm': 29,
  'Coil Assm - Evaporator': 29,
  'Blower Assm': 9,
  'Electrical Assm': 16,
  'Condensate Mgmt Assm': 8,
  'Air Filtration Assm': 2,
};
for (const [name, count] of Object.entries(MODULE_COUNTS)) {
  const sub = teardown.subAssemblies.find((s) => s.name === name);
  ok(Boolean(sub), `module exists in the database: ${name}`);
  eq(sub?.parts.length, count, `${name} holds ${count} parts`);
}

console.log('\nGOODMAN — every field the brief asked to preserve survived the round trip');
const stored = (partNo) => allParts.find((p) => p.partNo === partNo);
const plate = stored('3643208');
ok(Boolean(plate), 'part 3643208 found by its source Part No');
eq(plate.name, '1 — PLATE, UPPER TIE, PAINTED', 'Part Description');
eq(plate.partNo, '3643208', 'Part Number');
eq(plate.moduleName, 'Cabinet Assm', 'Module (stored on the part as well as the sub-assembly)');
eq(plate.material, 'Pre-painted galvanized steel', 'Material');
eq(plate.primaryProcess, 'Sheet-metal fabrication', 'Process');
eq(plate.quantity, 1, 'Quantity');
eq(plate.weightG, 1165.7, 'Weight');
eq(plate.lengthMm, 282.6, 'Dimensions — length');
eq(plate.widthMm, 558.8, 'Dimensions — width');
eq(plate.thicknessMm, 0.98, 'Dimensions — thickness');
eq(
  plate.description,
  'Src: CostWeights r42 · Sheetmetal. Material assumed galvanized steel (industry std).',
  'Remarks',
);
eq(plate.costs.length, 1, 'Cost — one cost row');
close(plate.costs[0].materialCost, 1.83, 'Cost — value');
eq(plate.commodity, 'Sheet metal', 'the source Product Category, stored as the commodity');
eq(plate.geometryType, 'sheet_metal', 'geometry type derived from it');
eq(plate.makeOrBuy, 'Make', 'Make / Buy');
eq(plate.uom, 'EA', 'UOM');

// The sub-assembly the part hangs off must agree with the part's own moduleName.
const cabinet = teardown.subAssemblies.find((s) => s.name === 'Cabinet Assm');
ok(
  cabinet.parts.every((p) => p.moduleName === 'Cabinet Assm'),
  'every part in Cabinet Assm also carries that module name — the bug that shipped null once',
);

console.log('\nGOODMAN — uncosted parts have NO cost row, rather than a $0.00 one');
const uncosted = allParts.filter((p) => p.costs.length === 0);
eq(uncosted.length, 21, '21 parts have no cost row at all');
ok(
  !allParts.some((p) => p.costs.some((c) => c.materialCost === 0)),
  'and not one fabricated $0.00 cost was written',
);

console.log('\nGOODMAN — the app\'s own reports reproduce the spreadsheet\'s subtotals');
// This is the check that matters: benchmarkService, which every screen reads
// from, must agree with the file the numbers came from.
// The cost and weight rollups live on the persona reports — the cost engineer's
// and design engineer's views are where benchmarkService's arithmetic surfaces.
const cost = (await call(`/reports/${gid}/cost_engineer`)).body?.data?.payload;
const weight = (await call(`/reports/${gid}/design_engineer`)).body?.data?.payload;
ok(Boolean(cost?.bySubAssembly), 'the cost report renders for the imported product');
ok(Boolean(weight?.bySubAssembly), 'the weight report renders too');

const STATED = [
  ['Packaging Assm', 11.99, 5857.3],
  ['Cabinet Assm', 55.79, 26344.7],
  ['Coil Assm - Evaporator', 144.97, 17605.2],
  ['Blower Assm', 111.18, 15594.6],
  ['Electrical Assm', 74.84, 1583.1],
  ['Condensate Mgmt Assm', 22.64, 4281.8],
  ['Air Filtration Assm', 2.23, 1483.3],
];
const costByModule = new Map(cost.bySubAssembly.map((m) => [m.name, m]));
const weightByModule = new Map(weight.bySubAssembly.map((m) => [m.name, m]));
for (const [name, statedCost, statedWeightG] of STATED) {
  close(
    costByModule.get(name)?.cost,
    statedCost,
    `${name}: the app's cost report says $${statedCost}, as the spreadsheet does`,
    0.011,
  );
  // The coil module is 1.6 g heavier than stated — the brazing rod's extended
  // weight is 0.0 in the source, so its per-unit 1.6 g was used. Known and
  // explained in importMappedBom.js; asserted here rather than tolerated.
  const tol = name === 'Coil Assm - Evaporator' ? 1.7 : 0.05;
  close(
    weightByModule.get(name)?.weightG,
    statedWeightG,
    `${name}: the app's weight report says ${statedWeightG} g`,
    tol,
  );
}
close(
  cost.totals.totalCost,
  423.64,
  'the product total matches the sum of the file\'s own module subtotals',
  0.02,
);
close(
  weight.totals.totalWeightG,
  72751.6,
  'the product weight is the file\'s 72,750.0 g plus the 1.6 g explained above',
  0.2,
);
eq(cost.totals.uncostedPartLines, 21, 'the cost report flags all 21 uncosted lines');

// ---------------------------------------------------------------------------
// The other three sheets
// ---------------------------------------------------------------------------
console.log('\nCARRIER / TRANE / BOSCH — each sheet became its own product');
const EXPECTED = [
  ['Main BOM Carrier', 'FJ5ANXC48L-MAP', 5, 3, 77.3, 18900],
  ['Main BOM Trane', '5TEMCB02-MAP', 5, 3, 116.2, 11501.5],
  ['Main Bom Bosch', 'BVA36WN1-MAP', 4, 2, 24.3, 13200],
];
for (const [sheet, model, partCount, moduleCount, totalCost, totalWeightG] of EXPECTED) {
  const it = imported.find((i) => i.entry.summary.sheet === sheet);
  ok(Boolean(it?.product), `${sheet}: product created`);
  eq(it.product.name, model, `${sheet}: stored under model ${model}`);
  eq(it.summary.partLines, partCount, `${sheet}: ${partCount} parts`);
  eq(it.summary.modules.length, moduleCount, `${sheet}: ${moduleCount} modules`);

  const c = (await call(`/reports/${it.product.id}/cost_engineer`)).body?.data?.payload;
  const w = (await call(`/reports/${it.product.id}/design_engineer`)).body?.data?.payload;
  close(c.totals.totalCost, totalCost, `${sheet}: total cost matches its GRAND TOTAL`, 0.02);
  close(w.totals.totalWeightG, totalWeightG, `${sheet}: total weight matches`, 0.2);
}

// Trane's heater module has parts here, where Goodman's is declared and empty —
// which is what makes the two sheets comparable at all.
const trane = imported.find((i) => i.entry.summary.sheet === 'Main BOM Trane');
const traneTeardown = (await call(`/products/${trane.product.id}/teardown`)).body.data;
const heater = traneTeardown.subAssemblies.find((s) => s.name === 'Electric Heater Assm');
ok(Boolean(heater), 'Trane HAS an Electric Heater Assm module');
eq(heater?.parts.length, 2, 'with two parts');
const traneScroll = traneTeardown.subAssemblies
  .flatMap((s) => s.parts)
  .find((p) => p.partNo === 'T-1002');
eq(traneScroll?.costs.length, 0, 'the $0.00 row was stored with no cost row');
eq(traneScroll?.weightG, 2000, 'but kept its weight');

// Bosch's module header decoration and lowercase sheet name still produced clean
// module names in the database.
const bosch = imported.find((i) => i.entry.summary.sheet === 'Main Bom Bosch');
const boschTeardown = (await call(`/products/${bosch.product.id}/teardown`)).body.data;
eq(bosch.product.brand, 'ZZ Mapped Bosch', 'brand came from the lowercase "Main Bom Bosch" name');
const boschModules = boschTeardown.subAssemblies.map((s) => s.name).sort();
eq(boschModules.join(', '), 'Cabinet Assm, Packaging Assm', 'clean module names, no bullet glyphs');
ok(
  boschTeardown.subAssemblies
    .flatMap((s) => s.parts)
    .some((p) => p.isFastener === true),
  'the Fastener row is flagged in the database',
);

// ---------------------------------------------------------------------------
// The four imported products must behave like any other product
// ---------------------------------------------------------------------------
console.log('\nIMPORTED PRODUCTS ARE ORDINARY PRODUCTS');
const ids = created.slice(0, 4);
const compare = await call(`/reports/compare?ids=${ids.join(',')}`);
eq(compare.status, 200, 'all four compare against each other');
eq(compare.body.data.products.length, 4, 'and all four appear in the comparison');
const bob = await call(`/reports/best-of-best?ids=${ids.join(',')}`);
eq(bob.status, 200, 'Best-of-Best accepts them');
ok(
  bob.body.data.moduleLeaders.length >= 7,
  `and finds their shared modules (${bob.body.data.moduleLeaders?.length})`,
);
// The whole reason module names are canonicalised: Goodman's filtration module
// has to line up with Carrier's for a module-level comparison to mean anything.
const filtration = bob.body.data.moduleLeaders.find((m) => m.module === 'Air Filtration Assm');
ok(Boolean(filtration), 'Air Filtration Assm is a comparable module across products');

const persona = await call(`/reports/${gid}/design_engineer`);
eq(persona.status, 200, 'a persona report renders for an imported product');

// ---------------------------------------------------------------------------
// Re-import guard
// ---------------------------------------------------------------------------
console.log('\nRE-IMPORT');
const again = await call('/products/import', {
  method: 'POST',
  body: JSON.stringify({
    product: { ...goodman.entry.product, brand: 'ZZ Mapped Goodman' },
    parts: goodman.entry.parts,
  }),
});
eq(again.status, 409, 'importing the same sheet twice is refused, not silently duplicated');
const replaced = await call('/products/import', {
  method: 'POST',
  body: JSON.stringify({
    product: { ...goodman.entry.product, brand: 'ZZ Mapped Goodman' },
    parts: goodman.entry.parts,
    replaceExisting: true,
  }),
});
eq(replaced.status, 201, 'and succeeds with replaceExisting');
if (replaced.body?.data?.product?.id) {
  created.push(replaced.body.data.product.id);
  const idx = created.indexOf(gid);
  if (idx !== -1) created.splice(idx, 1); // the original was cascaded away
}
eq(
  replaced.body.data.summary.partLines,
  101,
  'the replacement holds the same 101 parts, not 202',
);

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
if (!KEEP) {
  for (const id of created) await call(`/products/${id}`, { method: 'DELETE' });
  const finalCount = ((await call('/products')).body?.data ?? []).length;
  eq(finalCount, productsBefore, 'cleanup left the repository exactly as it was found');
  console.log(`\ncleaned up ${created.length} imported products (KEEP=1 to keep them)`);
} else {
  console.log(`\nkept imported product ids: ${created.join(', ')}`);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
