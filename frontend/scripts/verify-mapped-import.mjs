// ---------------------------------------------------------------------------
// scripts/verify-mapped-import.mjs
//
//   node scripts/make-mapped-fixture.mjs && node scripts/verify-mapped-import.mjs
//
// Parses the Mapped BOM fixture with the REAL parser the app uses (no mock, no
// reimplementation) and asserts hand-computed expectations.
//
// The Goodman sheet of the fixture is the supplied data VERBATIM (see
// make-mapped-fixture.mjs), so every Goodman expectation below is a fact about
// the real file. The strongest of them is the RECONCILIATION block: the sheet
// states its own `Subtotal <module>` and `GRAND TOTAL` rows, and this script
// checks the parser's per-module rollups against those figures. That's the one
// check that isn't the parser grading its own homework — the expected numbers
// were written by whoever built the spreadsheet, not by this code.
//
// It also asserts that CEDARS files still route to the CEDARS parser and produce
// byte-identical results through the new dispatcher, because "don't break the
// existing import" is only a claim until something checks it.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

import { parseCedarsWorkbook } from '../src/lib/importCedarsBom.js';
import {
  MAPPED_INTERNALS,
  canonicaliseModule,
  parseMappedWorkbook,
} from '../src/lib/importMappedBom.js';
import { detectWorkbookFormat, parseBomWorkbook } from '../src/lib/importWorkbook.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPPED = resolve(HERE, '../../backend/fixtures/mapped/SYNTHETIC-Daikin-Mapped-BOMs.xlsx');
const CEDARS = resolve(HERE, '../../backend/fixtures/cedars');

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  if (!Object.is(actual, expected)) {
    failures += 1;
    console.log(
      `  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`,
    );
    return false;
  }
  return true;
}
function close(actual, expected, label, tol = 1e-3) {
  checks += 1;
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures += 1;
    console.log(
      `  FAIL  ${label}\n          expected ~${expected} (±${tol})\n          actual   ${JSON.stringify(actual)}`,
    );
  }
  return ok;
}
function ok(condition, label, extra = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? `\n          ${extra}` : ''}`);
  }
  return condition;
}
function deepEq(actual, expected, label) {
  return eq(JSON.stringify(actual), JSON.stringify(expected), label);
}

const read = (path) => XLSX.read(readFileSync(path), { type: 'buffer' });

// ===========================================================================
console.log('\nDAIKIN MAPPED BOM IMPORT\n');

const workbook = read(MAPPED);
const result = parseMappedWorkbook(XLSX, workbook, { fileName: 'Daikin Mapped BOMs.xlsx' });

// ---- workbook level ------------------------------------------------------
console.log('WORKBOOK');
eq(result.format, 'mapped', 'format is "mapped"');
eq(result.products.length, 5, 'five BOM-shaped sheets are parsed (four products + one template)');
eq(result.summary.productSheets, 4, 'four of them look like products');
eq(result.summary.templateSheets, 1, 'and one is flagged as a template');
deepEq(result.summary.unmappedSheets, ['Notes'], 'the non-BOM sheet is reported, not parsed');
eq(result.summary.sheetsSeen, 6, 'all six sheets were looked at (4 products + template + Notes)');
eq(result.summary.productsFound, 5, 'summary counts every parsed sheet');
eq(result.summary.partLines, 101 + 5 + 5 + 4 + 1, 'total part lines across the workbook');
deepEq(result.summary.duplicateProducts, [], 'no two sheets describe the same brand + model');

const bySheet = Object.fromEntries(result.products.map((p) => [p.summary.sheet, p]));

// ---- product identities --------------------------------------------------
console.log('\nPRODUCT IDENTITIES (one per sheet)');
const IDENTITIES = [
  ['Main BOM Goodman', 'Goodman', 'AMST48CU1300'],
  ['Main BOM Carrier', 'Carrier', 'FJ5ANXC48L-MAP'],
  ['Main BOM Trane', 'Trane', '5TEMCB02-MAP'],
  // Lowercase "Bom" in the sheet name, and a spec line with no "Product:"
  // prefix — both handled.
  ['Main Bom Bosch', 'Bosch', 'BVA36WN1-MAP'],
];
for (const [sheet, brand, model] of IDENTITIES) {
  const p = bySheet[sheet];
  ok(Boolean(p), `sheet parsed: ${sheet}`);
  eq(p?.product.brand, brand, `${sheet}: brand is ${brand}`);
  eq(p?.product.name, model, `${sheet}: model is ${model}`);
  eq(p?.product.category, 'Air Handler', `${sheet}: category`);
  ok(
    p?.product.notes?.startsWith('Imported from Daikin Mapped BOM — '),
    `${sheet}: notes carry the spec prose`,
    p?.product.notes,
  );
  // Category is never stated by this format, so it must be flagged as a guess.
  eq(p?.summary.inferred.category, true, `${sheet}: category is flagged inferred`);
  eq(p?.summary.inferred.brand, false, `${sheet}: brand is NOT a guess`);
  eq(p?.summary.inferred.name, false, `${sheet}: model is NOT a guess`);
}

// =========================================================================
// TEMPLATE SHEET DETECTION
//
// The real workbook carries a "Reference BOM - Template" worksheet whose column
// headers are identical to a product sheet's. It was imported as a product —
// brand "Reference BOM - Template", one module "Interior", one refrigerator part.
// The fixture reproduces it, and these checks pin down that it is recognised,
// EXCLUDED BY DEFAULT, and still available to include deliberately.
// =========================================================================
console.log('\nTEMPLATE SHEET DETECTION');
const tmpl = bySheet['Reference BOM - Template'];
ok(Boolean(tmpl), 'the template sheet is still PARSED, not silently dropped');
eq(tmpl?.summary.isLikelyTemplate, true, 'and it is flagged as a likely template');
eq(tmpl?.parts.length, 1, 'its single example part is available if you choose to include it');

// The reasons are the deliverable — they are what the panel shows the user.
const reasons = tmpl?.summary.templateReasons ?? [];
ok(reasons.length >= 4, `several independent reasons are given (${reasons.length})`);
ok(
  reasons.some((r) => /no product line/i.test(r)),
  'reason: the sheet states no brand and model',
  JSON.stringify(reasons),
);
ok(
  reasons.some((r) => /reads as a template/i.test(r)),
  'reason: the sheet name reads as a template',
);
ok(reasons.some((r) => /only 1 part row/i.test(r)), 'reason: only one part row');
ok(
  reasons.some((r) => /standard AHU module/i.test(r)),
  'reason: its module is not a standard AHU module',
);
ok(
  reasons.some((r) => /brand and model are the same/i.test(r)),
  'reason: brand and model both fell back to the sheet name',
);
// The bug that let it through unnoticed: brand was NOT flagged as inferred, because
// the sheet name had filled it in.
eq(tmpl?.summary.inferred.brand, true, 'brand is now flagged as inferred, which it was not before');
eq(tmpl?.summary.inferred.name, true, 'and so is the model');

// No real product sheet may be caught by this.
for (const [sheet] of IDENTITIES) {
  eq(
    bySheet[sheet]?.summary.isLikelyTemplate,
    false,
    `${sheet} is NOT flagged as a template`,
  );
  deepEq(bySheet[sheet]?.summary.templateReasons, [], `${sheet} has no template reasons`);
}

// ---- the rule itself, exercised directly --------------------------------
console.log('\nTEMPLATE RULES');
const assess = MAPPED_INTERNALS.assessTemplateLikeness;
const REAL = {
  sheetName: 'Main BOM Goodman',
  hasProductIdentity: true,
  partLines: 101,
  moduleNames: ['Cabinet Assm', 'Blower Assm'],
  brand: 'Goodman',
  name: 'AMST48CU1300',
};
eq(assess(REAL).isLikelyTemplate, false, 'a real product sheet is not flagged');

// Each STRONG signal flags on its own.
eq(
  assess({ ...REAL, hasProductIdentity: false }).isLikelyTemplate,
  true,
  'STRONG: no product identity alone is enough',
);
eq(
  assess({ ...REAL, sheetName: 'Reference BOM - Template' }).isLikelyTemplate,
  true,
  'STRONG: a template-ish sheet name alone is enough',
);
for (const name of ['BOM Template', 'Example BOM', 'Master BOM', 'Blank sheet', 'Instructions']) {
  eq(assess({ ...REAL, sheetName: name }).isLikelyTemplate, true, `STRONG: "${name}" is flagged`);
}
// ...and a name that merely CONTAINS a keyword inside a word must not fire.
eq(
  assess({ ...REAL, sheetName: 'Main BOM Templeton' }).isLikelyTemplate,
  false,
  'the name rule is word-bounded — "Templeton" is not "Template"',
);

// A single WEAK signal must NOT flag — that is what stops a small real teardown
// (a 3-part packaging-only BOM, say) being excluded on its size alone.
eq(
  assess({ ...REAL, partLines: 2 }).isLikelyTemplate,
  false,
  'WEAK alone is not enough: a thin but properly identified sheet stays included',
);
eq(
  assess({ ...REAL, moduleNames: ['Interior'] }).isLikelyTemplate,
  false,
  'WEAK alone is not enough: unrecognised modules on an identified sheet stay included',
);
// Two weak signals together do flag.
eq(
  assess({ ...REAL, partLines: 2, moduleNames: ['Interior'] }).isLikelyTemplate,
  true,
  'two weak signals together are enough',
);
eq(
  assess({ ...REAL, partLines: 1, brand: 'X', name: 'X' }).isLikelyTemplate,
  true,
  'thin AND brand-equals-model is enough',
);
// A sheet with no modules at all must not be flagged for having "no canonical
// modules" — absence of data is not evidence of a template.
ok(
  !assess({ ...REAL, moduleNames: [] }).reasons.some((r) => /standard AHU module/.test(r)),
  'a sheet with no modules is not accused of having non-standard ones',
);

// =========================================================================
// GOODMAN — the supplied sheet. Every number here is a fact about the real file.
// =========================================================================
const g = bySheet['Main BOM Goodman'];
const gs = g.summary;

console.log('\nGOODMAN — outline structure');
eq(gs.headerRow, 3, 'the header row is row 3, found by content not by index');
// 101 numbered rows in the source, and the module tally sums to exactly that.
eq(gs.partLines, 101, 'all 101 numbered rows imported as parts');
eq(gs.partUnits, 412, 'part units respect Qty');
deepEq(
  gs.byModule,
  {
    'Packaging Assm': 8,
    'Cabinet Assm': 29,
    'Coil Assm - Evaporator': 29,
    'Blower Assm': 9,
    'Electrical Assm': 16,
    'Condensate Mgmt Assm': 8,
    'Air Filtration Assm': 2,
  },
  'parts per module match the source outline (Sl. No. 1-8, 9-37, 38-66, 67-75, 76-91, 92-99, 100-101)',
);
eq(
  Object.values(gs.byModule).reduce((s, n) => s + n, 0),
  101,
  'the module tally accounts for every part — nothing filed nowhere',
);

console.log('\nGOODMAN — outline rows are NOT parts');
eq(gs.skipped['module subtotal row'], 8, 'all 8 Subtotal rows skipped, never imported as parts');
eq(gs.skipped['grand total row'], 1, 'the GRAND TOTAL row skipped');
eq(gs.skipped['colour-key legend row'], 1, 'the colour-key legend row skipped');
ok(
  !g.parts.some((p) => /^subtotal|^grand total/i.test(p.name)),
  'no part is actually a subtotal row in disguise',
);

console.log('\nGOODMAN — module name canonicalisation');
deepEq(
  gs.modulesCanonicalised,
  { 'Air Filtation Assm': 'Air Filtration Assm' },
  'the source misspelling is snapped to the canonical spelling AND reported',
);
ok(
  !Object.keys(gs.byModule).includes('Air Filtation Assm'),
  'no part is left under the misspelled module name',
);
deepEq(
  gs.emptyModules,
  ['Electric Heater Assm'],
  'the heater module is declared with no parts — reported, and no empty module created',
);
ok(!gs.byModule['Electric Heater Assm'], 'the empty module holds no parts');

console.log('\nGOODMAN — reconciliation against the file\'s own Subtotal rows');
// THE key check. Each entry compares this parser's unitCost x quantity rollup
// against the figure the spreadsheet states for that module.
const recon = Object.fromEntries(gs.reconciliation.map((r) => [r.module, r]));
const STATED = [
  ['Packaging Assm', 11.99, 5857.3],
  ['Cabinet Assm', 55.79, 26344.7],
  ['Coil Assm - Evaporator', 144.97, 17605.2],
  ['Blower Assm', 111.18, 15594.6],
  ['Electrical Assm', 74.84, 1583.1],
  ['Condensate Mgmt Assm', 22.64, 4281.8],
  ['Air Filtration Assm', 2.23, 1483.3],
];
for (const [module, cost, weightG] of STATED) {
  eq(recon[module]?.statedCost, cost, `${module}: file states $${cost}`);
  eq(recon[module]?.statedWeightG, weightG, `${module}: file states ${weightG} g`);
  // Within a cent: each source row is stated to 2dp, so a 29-row subtotal can
  // legitimately differ from the file's own figure by rounding.
  close(recon[module]?.parsedCost, cost, `${module}: parsed cost reconciles`, 0.011);
}
eq(gs.worstCostDelta, 0.01, 'worst per-module cost gap in the whole sheet is one cent');

// Weight reconciles EXACTLY everywhere except one module, for one known reason.
for (const [module, , weightG] of STATED) {
  if (module === 'Coil Assm - Evaporator') continue;
  close(recon[module]?.parsedWeightG, weightG, `${module}: parsed weight reconciles exactly`, 0.05);
}
eq(gs.weightFromUnitFallbackRows, 1, 'exactly one row falls back to its per-unit weight');
close(
  recon['Coil Assm - Evaporator']?.weightDeltaG,
  1.6,
  'the coil module is heavier than the file states by exactly the brazing rod\'s 1.6 g — ' +
    'its Total Weight column is 0.0, so the per-unit figure was used instead',
  0.05,
);

console.log('\nGOODMAN — the file\'s own GRAND TOTAL');
eq(gs.statedGrandTotal.cost, 423.65, 'file states a $423.65 grand total');
eq(gs.statedGrandTotal.weightG, 72750, 'file states a 72,750.0 g grand total');
// Worth pinning down because it is a property OF THE SOURCE DATA, not of this
// parser: the file's GRAND TOTAL row is a cent above the sum of its own module
// subtotals. Anyone reconciling by hand will hit this, so it should be a known
// fact rather than a surprise.
close(
  STATED.reduce((s, [, c]) => s + c, 0),
  423.64,
  'the source\'s module subtotals sum to $423.64 — a cent under its own GRAND TOTAL row',
  0.005,
);
close(
  STATED.reduce((s, [, , w]) => s + w, 0),
  72750,
  'the source\'s module weights sum exactly to its GRAND TOTAL',
  0.05,
);
close(gs.sourceExtendedCostTotal, 423.64, 'summing the Cost / Set column gives $423.64', 0.005);

console.log('\nGOODMAN — field preservation, row by row');
const part = (partNo) => g.parts.find((p) => p.partNo === partNo);

// Every field the brief asked to preserve, checked on one row that has it.
const plate = part('3643208'); // Sl. No. 9 — "1  PLATE, UPPER TIE, PAINTED"
ok(Boolean(plate), 'found part 3643208 by its source Part No');
eq(plate.name, '1 — PLATE, UPPER TIE, PAINTED', 'Part Description becomes the name');
eq(plate.partNo, '3643208', 'Part No preserved');
eq(plate.moduleName, 'Cabinet Assm', 'Module preserved');
eq(plate.material, 'Pre-painted galvanized steel', 'Material / Specification preserved');
eq(plate.primaryProcess, 'Sheet-metal fabrication', 'Primary Process preserved');
eq(plate.commodity, 'Sheet metal', 'Product Category preserved as the commodity');
eq(plate.makeOrBuy, 'Make', 'Make / Buy preserved');
eq(plate.uom, 'EA', 'UOM preserved');
eq(plate.quantity, 1, 'Qty preserved');
eq(plate.weightG, 1165.7, 'Weight preserved in grams, no conversion');
eq(plate.lengthMm, 282.6, 'Length preserved in mm');
eq(plate.widthMm, 558.8, 'Width preserved in mm');
eq(plate.thicknessMm, 0.98, 'Thickness preserved in mm');
eq(plate.unitCost, 1.83, 'Cost / Set becomes the unit cost at Qty 1');
eq(
  plate.description,
  'Src: CostWeights r42 · Sheetmetal. Material assumed galvanized steel (industry std).',
  'Remarks / Assumptions preserved as the part note',
);
eq(plate.geometryType, 'sheet_metal', 'Sheet metal implies sheet_metal geometry');
eq(plate.productCategory, 'Air Handler', 'productCategory is the PRODUCT\'s category, not the commodity');

// A quantity > 1: the unit cost has to be the extended cost divided down, or
// the app's rollup will not match the spreadsheet.
const cornerPost = part('3643221'); // Sl. No. 7 — Qty 4, Total Cost $2.58
eq(cornerPost.quantity, 4, 'Qty 4 preserved');
eq(cornerPost.unitCost, 0.645, 'unit cost is Cost/Set ÷ Qty = 2.58/4, NOT the $0.6573 Rate/Unit');
close(cornerPost.unitCost * cornerPost.quantity, 2.58, 'and it multiplies back to the stated $2.58', 1e-6);
eq(cornerPost.weightG, 444.525, 'unit weight is Total Weight ÷ Qty = 1778.1/4');

// A quoted thousands-separated cell — "3,633.3" arrives as a STRING through any
// CSV round trip and must not become NaN.
eq(part('3643321').weightG, 3633.3, '"3,633.3" parses as 3633.3, not NaN');

// Fractional quantity: 0.03 EA of brazing rod.
const brazeRod = part('3643260');
eq(gs.fractionalQuantityRows, 1, 'exactly one fractional quantity in the sheet');
eq(brazeRod.quantity, 1, 'a 0.03 quantity becomes 1 — the column is an integer');
eq(brazeRod.unitCost, 1.09, 'and the whole $1.09 extended cost is kept, so the total is unharmed');

// Geometry inference.
eq(part('3642548').geometryType, 'circular', 'Aluminum coil implies circular');
eq(part('3642548').diameterOuterMm, 9.5, 'the hairpin OD is preserved');
eq(gs.geometryFromDiameterRows, 1, 'exactly one part is circular purely because it has a diameter');
eq(
  part('3643082').geometryType,
  'circular',
  'the blower wheel is circular from its 269.7 mm OD, though "Blower mechanical" says nothing',
);
eq(part('3643082').diameterOuterMm, 269.7, 'and that diameter is stored where the editor shows it');
deepEq(
  gs.byGeometryType,
  { custom: 59, sheet_metal: 27, circular: 15 },
  'geometry tally across the sheet',
);

// Fasteners.
eq(part('3643383').isFastener, true, 'a Fastener row is flagged as one');
eq(part('3643335').isFastener, false, 'a packaging row is not');

console.log('\nGOODMAN — uncosted parts are uncosted, not free');
// 21 rows carry $0.00 with a Remark saying the cost was never populated.
eq(gs.uncostedRows, 21, '21 rows have no populated cost');
eq(
  g.parts.filter((p) => p.unitCost === null).length,
  21,
  'and all 21 carry unitCost null rather than 0 — importService creates no Cost row for them',
);
ok(
  !g.parts.some((p) => p.unitCost === 0),
  'no part was given a fabricated $0.00 cost',
);
// Rows with neither Weight (g) nor Total Weight (g): Sl. No. 1, 8, 23, the eight
// gaskets 29-36, 37, 38, 59-60, 62-66, 76, 78, 81, 85-89, 91, 98-99.
eq(gs.unweighedRows, 31, '31 rows have no weight in the source');
eq(
  g.parts.filter((p) => p.weightG === null).length,
  31,
  'and all 31 carry weightG null',
);
ok(!g.parts.some((p) => p.weightG === 0), 'no part was given a fabricated 0 g weight');

console.log('\nGOODMAN — Rate / Unit is reported as divergent, not used');
// Awkwardness 3: for Make parts, Rate/Unit is a material rate, so Rate x Qty
// disagrees with Cost/Set on most sheet-metal rows. Counted, never applied.
ok(gs.rateDivergedRows > 20, `many rows diverge from Rate x Qty (${gs.rateDivergedRows})`);

// =========================================================================
// CARRIER — module inherited from the Level-2 header, because the column is blank
// =========================================================================
console.log('\nCARRIER — module from the outline header, not the Module column');
const c = bySheet['Main BOM Carrier'];
eq(c.summary.partLines, 5, '5 parts');
deepEq(
  c.summary.byModule,
  { 'Cabinet Assm': 2, 'Coil Assm - Evaporator': 2, 'Air Filtration Assm': 1 },
  'every part found its module despite an entirely empty Module column',
);
eq(c.summary.skipped['no module (no Module cell and no enclosing Level-2 header)'], undefined,
  'no part was dropped for having no module');
deepEq(c.summary.modulesCanonicalised, {},
  'this sheet spells Air Filtration correctly, so nothing is canonicalised');
eq(c.summary.worstCostDelta, 0, 'reconciles to the file\'s subtotals exactly');
eq(c.summary.worstWeightDeltaG, 0, 'weight reconciles exactly');
eq(c.summary.statedGrandTotal.cost, 77.3, 'grand total captured');
// Real numeric cells here, versus strings from the CSV round trip on sheet 1.
eq(c.parts[0].unfoldedLengthMm, 760, 'Unfolded L preserved');
eq(c.parts[0].unfoldedWidthMm, 600, 'Unfolded W preserved');
eq(c.parts[0].surfaceFinish, 'Powder paint', 'Surface finish preserved');
close(c.parts.find((p) => p.partNo === 'C-2001').unitCost, 0.55, 'Qty 80 unit cost = 44.00/80', 1e-6);

// =========================================================================
// TRANE — a populated heater module, an uncosted row, a decorated header
// =========================================================================
console.log('\nTRANE — heater module with parts, decorated header, uncosted row');
const t = bySheet['Main BOM Trane'];
eq(t.summary.byModule['Electric Heater Assm'], 2,
  'the heater module has parts here, where Goodman declares it empty');
deepEq(t.summary.emptyModules, [], 'no empty modules on this sheet');
eq(t.summary.byModule['Condensate Mgmt Assm'], 1,
  'a "▸ Condensate Mgmt Assm " header with a different glyph and a trailing space still resolves');
eq(t.parts.find((p) => p.partNo === 'T-1002').unitCost, null,
  'the $0.00 row imports uncosted, not free');
eq(t.summary.uncostedRows, 1, 'and is counted as such');
eq(t.summary.worstCostDelta, 0, 'cost reconciles to the stated subtotals');
eq(t.summary.fractionalQuantityRows, 1, 'the 0.05 quantity is reported');

// =========================================================================
// canonicaliseModule — the merge rules, directly
// =========================================================================
console.log('\nMODULE CANONICALISATION RULES');
eq(canonicaliseModule('Cabinet Assm').name, 'Cabinet Assm', 'exact name passes through');
eq(canonicaliseModule('Cabinet Assm').from, null, 'and reports no change');
eq(canonicaliseModule('? Packaging Assm').name, 'Packaging Assm', 'bullet decoration stripped');
eq(canonicaliseModule('▸  Blower  Assm ').name, 'Blower Assm', 'glyph, padding and double spaces');
eq(canonicaliseModule('Air Filtation Assm').name, 'Air Filtration Assm', 'a one-character typo snaps');
eq(canonicaliseModule('Air Filtation Assm').from, 'Air Filtation Assm', 'and says what it changed');
eq(canonicaliseModule('coil assm - evaporator').name, 'Coil Assm - Evaporator', 'case-only match');
// The property that matters most: never merge two DIFFERENT modules.
eq(canonicaliseModule('Blower Assm').name, 'Blower Assm', 'Blower is not pulled toward Cabinet');
eq(canonicaliseModule('Heat Exchanger Assm').name, 'Heat Exchanger Assm',
  'a module this app has never seen is preserved verbatim, not forced into the eight');
eq(canonicaliseModule('Heat Exchanger Assm').from, null, 'and is not reported as a change');
eq(canonicaliseModule('').name, '', 'an empty header is empty, not a false match');
eq(MAPPED_INTERNALS.CANONICAL_MODULES.length, 8, 'the eight Level-1 AHU modules');

// =========================================================================
// FORMAT DETECTION — and the promise that CEDARS still works
// =========================================================================
console.log('\nFORMAT DETECTION');
eq(detectWorkbookFormat(workbook), 'mapped', 'the Mapped workbook is detected as mapped');

const cedarsA = read(resolve(CEDARS, 'SYNTHETIC-variantA-goodman-style.xlsx'));
const cedarsB = read(resolve(CEDARS, 'SYNTHETIC-variantB-trane-style.xlsx'));
eq(detectWorkbookFormat(cedarsA), 'cedars', 'CEDARS Variant A still detected as cedars');
eq(detectWorkbookFormat(cedarsB), 'cedars', 'CEDARS Variant B still detected as cedars');

const junk = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(junk, XLSX.utils.aoa_to_sheet([['hello'], ['world']]), 'Sheet1');
eq(detectWorkbookFormat(junk), 'unknown', 'an unrelated workbook is unknown');
let thrown = null;
try {
  parseBomWorkbook(junk, {});
} catch (err) {
  thrown = err;
}
ok(Boolean(thrown), 'an unrecognised workbook throws rather than importing nothing');
ok(/CEDARS export/.test(thrown?.message ?? ''), 'the error names the CEDARS format');
ok(/Daikin Mapped BOM/.test(thrown?.message ?? ''), 'and names the Mapped format');
ok(
  /Sl\. No\./.test(thrown?.message ?? '') && /CostWeights/.test(thrown?.message ?? ''),
  'and says what each format actually needs',
  thrown?.message,
);

console.log('\nCEDARS THROUGH THE NEW DISPATCHER (must be unchanged)');
for (const [label, wb] of [['Variant A', cedarsA], ['Variant B', cedarsB]]) {
  const direct = parseCedarsWorkbook(wb, { fileName: 'x.xlsx' });
  const viaDispatcher = parseBomWorkbook(wb, { fileName: 'x.xlsx' });
  eq(viaDispatcher.format, 'cedars', `${label}: routed to the CEDARS parser`);
  eq(viaDispatcher.products.length, 1, `${label}: normalised to a one-product array`);
  eq(
    JSON.stringify(viaDispatcher.products[0].parts),
    JSON.stringify(direct.parts),
    `${label}: parts are byte-identical to a direct parse`,
  );
  deepEq(viaDispatcher.products[0].product, direct.product, `${label}: product record identical`);
  eq(
    viaDispatcher.summary.partLines,
    direct.summary.partLines,
    `${label}: part count carried through`,
  );
}

// A Mapped workbook must NOT be routed to the CEDARS parser — the bug that
// started this work was exactly that, reported as "no CostWeights sheet".
ok(
  detectWorkbookFormat(workbook) !== 'cedars',
  'the Mapped workbook is never handed to the CEDARS parser',
);

// ===========================================================================
console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
