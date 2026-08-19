// ---------------------------------------------------------------------------
// scripts/verify-cedars-e2e.mjs
//
// End-to-end check of the BOM import: parse a fixture with the real parser,
// POST it to the real running backend, read the rows back out, and confirm the
// cost/weight reports the app renders reproduce the SOURCE SPREADSHEET's own
// totals — not just this script's arithmetic.
//
//   (backend must be running on :4000)
//   node scripts/verify-cedars-fixture.mjs && node scripts/verify-cedars-e2e.mjs
//
// Cleans up after itself: both imported products are deleted at the end, so the
// seeded demo data is left exactly as it was found. Set KEEP=1 to keep them.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

import { parseCedarsWorkbook } from '../src/lib/importCedarsBom.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api';
const KEEP = process.env.KEEP === '1';
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/fixtures/cedars');

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  if (!Object.is(actual, expected)) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}

function close(actual, expected, label, tol = 0.01) {
  checks += 1;
  if (!(typeof actual === 'number' && Math.abs(actual - expected) <= tol)) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ~${expected}\n          actual   ${JSON.stringify(actual)}`);
  }
}

async function call(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function parse(file) {
  const wb = XLSX.read(readFileSync(resolve(FIXTURES, file)), { type: 'buffer' });
  return parseCedarsWorkbook(wb, { fileName: file });
}

const created = [];

async function importFixture(file, { replaceExisting = false } = {}) {
  const parsed = parse(file);
  const res = await call('/products/import', {
    method: 'POST',
    body: JSON.stringify({
      product: parsed.product,
      parts: parsed.parts,
      replaceExisting,
    }),
  });
  return { parsed, res };
}

// ===========================================================================
console.log(`\nBackend: ${API}`);
const health = await call('/health');
if (health.status !== 200) {
  console.log(`\nFAIL — backend not reachable at ${API}. Start it with "npm run dev" in backend/.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// VARIANT B round trip
// ---------------------------------------------------------------------------
console.log('\nVARIANT B — import, read back, report');
const { parsed: bParsed, res: bRes } = await importFixture('SYNTHETIC-variantB-trane-style.xlsx');

eq(bRes.status, 201, 'POST /products/import returns 201');
if (bRes.status !== 201) {
  console.log('        body:', JSON.stringify(bRes.body));
} else {
  created.push(bRes.body.data.product.id);
}

const bProductId = bRes.body?.data?.product?.id;
const bSummary = bRes.body?.data?.summary;

// The server's summary is computed from the rows it actually WROTE, so this
// compares the database against the parser rather than echoing the request.
eq(bSummary?.partLines, 22, 'server wrote 22 part rows');
eq(bSummary?.modules?.length, 4, 'server created 4 sub-assemblies');
eq(bSummary?.costedParts, 22, 'every part got a cost row');
eq(bSummary?.weighedParts, 22, 'every part got a weight');
eq(bSummary?.byCommodity?.Steel, 3, 'commodity Steel persisted');
eq(bSummary?.byCommodity?.Fasteners, 2, 'commodity Fasteners persisted');
eq(bSummary?.byCommodity?.Insulation, 2, 'commodity Insulation persisted');
eq(bSummary?.byCommodity?.Misc, 2, 'commodity Misc persisted');
eq(bSummary?.byGeometryType?.sheet_metal, 3, 'geometryType sheet_metal persisted');
eq(bSummary?.byGeometryType?.circular, 4, 'geometryType circular persisted');

const moduleNames = (bSummary?.modules ?? []).map((m) => m.name).sort();
eq(
  JSON.stringify(moduleNames),
  JSON.stringify(['Blower Electrical', 'Cabinet/Enclosure', 'Coil Assembly', 'Packaging']),
  'the four module names are exactly the spec\'s',
);

// ---- read the tree back and check a part survived the round trip field-for-field
const teardown = (await call(`/products/${bProductId}/teardown`)).body?.data;
const allParts = teardown?.subAssemblies?.flatMap((s) => s.parts) ?? [];
const s1 = allParts.find((p) => p.name === 'Sheetmetal 1');

console.log('  Sheetmetal 1, read back out of SQLite');
eq(s1?.commodity, 'Steel', 'commodity');
eq(s1?.moduleName, 'Cabinet/Enclosure', 'moduleName column');
eq(s1?.geometryType, 'sheet_metal', 'geometryType');
eq(s1?.quantity, 2, 'quantity');
eq(s1?.partNo, 'CEDARS-1', 'partNo');
eq(s1?.uom, 'EA', 'uom');
eq(s1?.description, 'Cabinet side panel, left', 'description');
eq(s1?.surfaceFinish, 'Pre-Painted', 'surfaceFinish');
eq(s1?.finish, 'Galvanized', 'finish');
eq(s1?.imageUrl, 'https://cedars.example/steel-1.jpg', 'imageUrl');
eq(s1?.scrapRatePct, 6.5, 'scrapRatePct');
eq(s1?.weightLbs, 4.25, 'weightLbs (raw imperial preserved)');
close(s1?.weightG, 1927.768, 'weightG', 0.01);
close(s1?.lengthMm, 800.1, 'lengthMm', 0.01);
close(s1?.thicknessMm, 0.762, 'thicknessMm', 1e-4);
eq(s1?.productCategory, 'Air Handler', 'productCategory mirrors the product');

const coil = allParts.find((p) => p.name === 'Slab 1');
close(coil?.diameterOuterMm, 9.52, 'coil diameter stayed mm, not re-converted', 0.001);
eq(coil?.fpi, 14, 'fpi');
eq(coil?.diameterInnerMm, null, 'diameterInnerMm untouched — wall thickness has its own column');
close(coil?.wallThicknessMm, 0.3048, 'wallThicknessMm', 1e-4);

const wire = allParts.find((p) => p.name === 'Line Voltage Harness');
eq(wire?.wireGauge, '18 AWG', 'wireGauge');

// ---- THE CHECK THAT MATTERS: does the app's own rollup equal the file's totals?
console.log('  report rollups vs the source spreadsheet');
const bCost = (await call(`/reports/${bProductId}/cost_engineer`)).body?.data?.payload;
const bDesign = (await call(`/reports/${bProductId}/design_engineer`)).body?.data?.payload;

// 235.05 is the sum of the fixture's own "Total Cost" column, computed by hand.
close(bCost?.totals?.totalCost, 235.05, 'cost report total == file Total Cost sum', 0.02);
eq(bParsed.summary.sourceExtendedCostTotal, 235.05, 'parser recorded the same file total');
close(bDesign?.totals?.totalWeightG, 52.532 * 453.59237, 'design report total weight == file Total Lbs sum in grams', 1);

// Per-module rollup — spec §7 calls this the analysis view that matters.
// The payload's per-sub-assembly rows key the label as `name` (see
// benchmarkService's bySubAssembly), not `subAssemblyName`.
const bySub = Object.fromEntries((bCost?.bySubAssembly ?? []).map((row) => [row.name, row.cost]));
console.log(`        module costs: ${JSON.stringify(bySub)}`);
close(
  Object.values(bySub).reduce((s, v) => s + v, 0),
  235.05,
  'module costs sum to the file total',
  0.02,
);
eq(Object.keys(bySub).length, 4, 'cost rolls up across exactly four modules');

// ---- duplicate protection ----
console.log('  duplicate / replace behaviour');
const dup = await importFixture('SYNTHETIC-variantB-trane-style.xlsx');
eq(dup.res.status, 409, 're-importing the same file without replace returns 409');

const replaced = await importFixture('SYNTHETIC-variantB-trane-style.xlsx', {
  replaceExisting: true,
});
eq(replaced.res.status, 201, 're-importing with replaceExisting succeeds');
if (replaced.res.status === 201) {
  created[created.indexOf(bProductId)] = replaced.res.body.data.product.id;
  eq(replaced.res.body.data.summary.partLines, 22, 'replacement wrote 22 parts, not 44');
  const listed = (await call('/products')).body?.data ?? [];
  eq(
    listed.filter((p) => p.brand === 'Trane' && p.name === 'TAM7A0C24V21').length,
    1,
    'exactly one Trane TAM7A0C24V21 exists after the replace',
  );
}

// ---------------------------------------------------------------------------
// VARIANT A round trip
// ---------------------------------------------------------------------------
console.log('\nVARIANT A — import, read back, report');
const { res: aRes } = await importFixture('SYNTHETIC-variantA-goodman-style.xlsx');
eq(aRes.status, 201, 'POST returns 201');
if (aRes.status !== 201) console.log('        body:', JSON.stringify(aRes.body));
else created.push(aRes.body.data.product.id);

const aProductId = aRes.body?.data?.product?.id;
eq(aRes.body?.data?.summary?.partLines, 8, 'server wrote 8 part rows');
eq(aRes.body?.data?.summary?.modules?.length, 4, 'server created 4 sub-assemblies');
eq(aRes.body?.data?.product?.brand, 'Goodman', 'brand');

const aCost = (await call(`/reports/${aProductId}/cost_engineer`)).body?.data?.payload;
close(aCost?.totals?.totalCost, 177.18, 'cost report total == file Total Cost sum', 0.02);

// ---------------------------------------------------------------------------
// Rejection cases — the endpoint should refuse malformed input, not half-write it
// ---------------------------------------------------------------------------
console.log('\nvalidation');
const noParts = await call('/products/import', {
  method: 'POST',
  body: JSON.stringify({ product: { name: 'X', brand: 'Y', category: 'Z' }, parts: [] }),
});
eq(noParts.status, 400, 'empty parts array is rejected');

const noProduct = await call('/products/import', {
  method: 'POST',
  body: JSON.stringify({ product: { brand: 'Y' }, parts: [{ name: 'a', moduleName: 'm' }] }),
});
eq(noProduct.status, 400, 'missing product name/category is rejected');

const badGeometry = await call('/products/import', {
  method: 'POST',
  body: JSON.stringify({
    product: { name: 'Bad Geometry Test', brand: 'ZZ Test', category: 'T' },
    parts: [{ name: 'a', moduleName: 'm', geometryType: 'trapezoid' }],
  }),
});
eq(badGeometry.status, 400, 'an invalid geometryType is rejected (not silently stored)');

const beforeCount = ((await call('/products')).body?.data ?? []).length;
const badMidway = await call('/products/import', {
  method: 'POST',
  body: JSON.stringify({
    product: { name: 'Atomicity Test', brand: 'ZZ Test', category: 'T' },
    parts: [
      { name: 'good', moduleName: 'M', geometryType: 'custom' },
      { name: 'bad', moduleName: 'M', geometryType: 'not-a-real-type' },
    ],
  }),
});
eq(badMidway.status, 400, 'a bad row partway through the batch is rejected');
const afterCount = ((await call('/products')).body?.data ?? []).length;
eq(afterCount, beforeCount, 'ATOMIC: the failed import left no half-written product behind');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
if (!KEEP) {
  for (const id of created) await call(`/products/${id}`, { method: 'DELETE' });
  console.log(`\ncleaned up ${created.length} imported products (KEEP=1 to keep them)`);
} else {
  console.log(`\nkept imported product ids: ${created.join(', ')}`);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
