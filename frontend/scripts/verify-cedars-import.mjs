// ---------------------------------------------------------------------------
// scripts/verify-cedars-import.mjs
//
//   node scripts/make-cedars-fixture.mjs && node scripts/verify-cedars-import.mjs
//
// Parses both synthetic fixtures with the REAL parser the app uses (no mock, no
// reimplementation) and asserts hand-computed expectations against it.
//
// Every expected number below was worked out by hand from the fixture source
// and is written as a literal, not derived from the parser's own output — an
// assertion that recomputes what it is checking proves nothing.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

import { parseCedarsWorkbook } from '../src/lib/importCedarsBom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../backend/fixtures/cedars');

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
  return ok;
}

/** Float compare with a tolerance, for converted units. */
function close(actual, expected, label, tol = 1e-3) {
  checks += 1;
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ~${expected}\n          actual   ${JSON.stringify(actual)}`);
  }
  return ok;
}

function section(title) {
  console.log(`\n${title}`);
}

function load(file) {
  const wb = XLSX.read(readFileSync(resolve(FIXTURES, file)), { type: 'buffer' });
  return parseCedarsWorkbook(wb, { fileName: file });
}

const byName = (parts, name) => parts.find((p) => p.name === name);

// ===========================================================================
// VARIANT B — Trane-style, one sheet per commodity
// ===========================================================================
section('VARIANT B (Trane-style, per-commodity sheets)');
const b = load('SYNTHETIC-variantB-trane-style.xlsx');

eq(b.summary.variant, 'B', 'variant detected as B');
eq(b.summary.sheetsSeen, 15, 'sheet count');
eq(b.summary.unmappedSheets.length, 0, 'every sheet was recognised');

// ---- product record ----
eq(b.product.brand, 'Trane', 'product brand from Key Features');
eq(b.product.name, 'TAM7A0C24V21', 'product model from Key Features');
eq(b.product.category, 'Air Handler', 'product category from Key Features');
eq(b.summary.inferred.brand, false, 'brand was NOT inferred from the filename');
eq(b.summary.inferred.name, false, 'model was NOT inferred from the filename');

// ---- units-row detection (spec §1.1 vs the no-units-row product sheets) ----
const steelSheet = b.summary.perSheet.find((s) => s.sheet === 'Steel');
eq(steelSheet.hadUnitsRow, true, 'Steel units row detected and skipped');

// ---- counts and module rollup ----
eq(b.summary.partLines, 22, 'total parts imported');
eq(b.summary.byModule['Cabinet/Enclosure'], 9, 'Cabinet/Enclosure part count');
eq(b.summary.byModule['Coil Assembly'], 4, 'Coil Assembly part count');
eq(b.summary.byModule['Blower Electrical'], 5, 'Blower Electrical part count');
eq(b.summary.byModule['Packaging'], 4, 'Packaging part count');
eq(Object.keys(b.summary.byModule).length, 4, 'exactly four modules');

// ---- commodity tag survives the module roll-up (spec §2) ----
eq(b.summary.byCommodity.Steel, 3, 'commodity Steel count');
eq(b.summary.byCommodity.Fasteners, 2, 'commodity Fasteners count');
eq(b.summary.byCommodity.Insulation, 2, 'commodity Insulation count');
eq(b.summary.byCommodity.Misc, 2, 'commodity Misc count');
// All four of those roll into ONE module, which is the whole reason commodity
// is stored separately — 3+2+2+2 = 9 = Cabinet/Enclosure above.
eq(b.summary.byCommodity.Labels, 2, 'commodity Labels count');
eq(b.summary.byCommodity.Packaging, 2, 'commodity Packaging count');

// ---- placeholder / labor skipping ----
eq(b.summary.laborRowsSkipped, 3, 'all three Labor rows skipped');
// 7 = Steel r3 + Tubing r12 + Electrical r32 + Fasteners r51/r52/r54 + Fasteners
// r55 (entirely blank). Labor's 3 rows are counted separately, above.
eq(b.summary.skippedTotal, 7, 'placeholder + blank rows skipped');
eq(b.parts.some((p) => p.name.startsWith('Sub-Assembly')), false, 'no Sub-Assembly placeholder survived');

// ---- Steel row 1: full field + conversion check ----
section('  Steel - Sheetmetal 1 (conversions)');
const s1 = byName(b.parts, 'Sheetmetal 1');
eq(s1.commodity, 'Steel', 'commodity');
eq(s1.moduleName, 'Cabinet/Enclosure', 'module');
eq(s1.geometryType, 'sheet_metal', 'geometryType');
eq(s1.quantity, 2, 'quantity');
eq(s1.partNo, 'CEDARS-1', 'partNo carries the source Id');
eq(s1.uom, 'EA', 'uom from the units row');
eq(s1.surfaceFinish, 'Pre-Painted', 'Exterior Finish -> surfaceFinish');
eq(s1.finish, 'Galvanized', 'Interior Finish -> finish');
eq(s1.description, 'Cabinet side panel, left', 'Part Description -> description');
eq(s1.imageUrl, 'https://cedars.example/steel-1.jpg', 'Picture -> imageUrl');
eq(s1.scrapRatePct, 6.5, 'Scrap rate');
eq(s1.weightLbs, 4.25, 'weightLbs kept raw (Total Lbs 8.5 / qty 2)');
close(s1.weightG, 1927.768, 'weightG = 4.25 lb x 453.59237');
close(s1.lengthMm, 800.1, 'lengthMm = 31.5 in x 25.4');
close(s1.widthMm, 501.65, 'widthMm = 19.75 in x 25.4');
close(s1.thicknessMm, 0.762, 'thicknessMm = 0.03 in x 25.4', 1e-4);
close(s1.unitCost, 6.42, 'unitCost = Total Cost 12.84 / qty 2');

// ---- Steel row 2: scientific notation (spec §1.5) ----
const s2 = byName(b.parts, 'Sheetmetal 2');
close(s2.thicknessMm, 0.7931, 'thickness parsed from "3.1225739E-2" then x25.4', 1e-4);

// ---- Steel row 4: extended-vs-stated divergence ----
const s3 = byName(b.parts, 'Sheetmetal 3');
close(s3.unitCost, 4.5, 'unitCost prefers Total Cost 13.50/3 over Cost Per part 4.00');
// Exactly one: Steel r4. The LabelsLiterature rows must NOT count here — that
// sheet has no "Cost Per part" column, so its Cost Material figure is
// material-only and isn't a like-for-like comparison against a total.
eq(b.summary.costDivergedRows, 1, 'the one divergent row is reported, not swallowed');
eq(b.summary.costFromMaterialOnlyRows, 0, 'no row fell back to a material-only cost here');

// ---- Tubing: inches diameter ----
section('  Tubing / Coil (per-column units — spec §5)');
const t1 = byName(b.parts, '3/8 Diameter');
eq(t1.geometryType, 'circular', 'Tubing geometryType');
eq(t1.moduleName, 'Coil Assembly', 'Tubing module');
eq(t1.material, 'Copper', 'Material');
close(t1.diameterOuterMm, 9.525, 'Diameter 0.375 in x 25.4 (column declared "(In)")');
close(t1.wallThicknessMm, 0.8128, 'Wall Thickness -> its own column, not diameterInnerMm', 1e-4);
eq(t1.diameterInnerMm, undefined, 'diameterInnerMm left untouched by wall thickness');
close(t1.lengthMm, 1066.8, 'lengthMm = 42 in x 25.4');

// ---- Evaporator Coil: diameter column declared in mm, must NOT be converted ----
const c1 = byName(b.parts, 'Slab 1');
eq(c1.geometryType, 'circular', 'Evaporator Coil geometryType is circular');
close(c1.diameterOuterMm, 9.52, 'Diameter 9.52 passed through — column declared "(mm)"');
close(c1.lengthMm, 609.6, 'Length still converted (24 in x 25.4) on the same sheet');
eq(c1.fpi, 14, 'FPI');
close(c1.wallThicknessMm, 0.3048, 'Wall Thickness still in inches on the same sheet', 1e-4);

// ---- Wire / Fasteners / Labels ----
section('  Wire / Fasteners / Labels');
const w1 = byName(b.parts, 'Line Voltage Harness');
eq(w1.wireGauge, '18 AWG', 'Wire Gauge');
eq(w1.moduleName, 'Blower Electrical', 'Wire module');

const f1 = byName(b.parts, 'Sheet Metal Screw #8');
eq(f1.isFastener, true, 'isFastener set from commodity');
eq(f1.moduleName, 'Cabinet/Enclosure', 'Fasteners roll into Cabinet/Enclosure');
eq(f1.quantity, 24, 'quantity');
close(f1.weightLbs, 0.004, 'unit weight = Total Lbs 0.096 / 24', 1e-6);
close(f1.unitCost, 0.03, 'unit cost = Total Cost 0.72 / 24', 1e-6);

// LabelsLiterature has NO "Cost Per part" column, so unit cost must come from
// Total Cost — and specifically NOT from Cost Material, which reads 0.15.
const l1 = byName(b.parts, 'Rating Plate');
close(l1.unitCost, 0.35, 'unitCost from Total Cost, not Cost Material (0.15)');
eq(l1.moduleName, 'Packaging', 'Labels roll into Packaging');

// ---- name cleaning edge cases ----
section('  Component Name cleaning (spec §3)');
eq(byName(b.parts, 'Cabinet Liner')?.name, 'Cabinet Liner', '"Insulation - Cabinet Liner" -> "Cabinet Liner"');
eq(byName(b.parts, 'Drain Pan Assembly')?.name, 'Drain Pan Assembly', 'a name with no " - " is left alone');
eq(byName(b.parts, 'Blower Motor 1')?.name, 'Blower Motor 1', '"Electrical Components - Blower Motor 1" -> "Blower Motor 1"');

// ---- rollup fidelity: does the app reproduce the spreadsheet's own totals? ----
section('  Rollup fidelity vs the source file');
const bCost = b.parts.reduce((sum, p) => sum + (p.unitCost ?? 0) * p.quantity, 0);
close(bCost, 235.05, 'sum(unitCost x qty) reproduces the file\'s Total Cost column sum', 0.01);
eq(b.summary.sourceExtendedCostTotal, 235.05, 'file\'s own Total Cost sum, recorded independently');

const bLbs = b.parts.reduce((sum, p) => sum + (p.weightLbs ?? 0) * p.quantity, 0);
close(bLbs, 52.532, 'sum(weightLbs x qty) reproduces the file\'s Total Lbs column sum', 0.01);
const bGrams = b.parts.reduce((sum, p) => sum + (p.weightG ?? 0) * p.quantity, 0);
close(bGrams, 52.532 * 453.59237, 'grams total is consistent with the lbs total', 1);

// ---- striking differences ----
eq(b.summary.strikingDifferencesFound, 3, 'Striking Differences picture/feature pairs parsed');

// ---- every geometryType must be one the backend accepts ----
const VALID_GEOMETRY = new Set(['rectangular', 'circular', 'sheet_metal', 'custom']);
eq(
  b.parts.every((p) => VALID_GEOMETRY.has(p.geometryType)),
  true,
  'every geometryType is valid per partRepository.GEOMETRY_TYPES',
);

// ===========================================================================
// VARIANT A — Goodman-style, one combined CostWeights sheet
// ===========================================================================
section('VARIANT A (Goodman-style, combined CostWeights sheet)');
const a = load('SYNTHETIC-variantA-goodman-style.xlsx');

eq(a.summary.variant, 'A', 'variant detected as A');
eq(a.product.brand, 'Goodman', 'product brand');
eq(a.product.name, 'AMST24BU1300', 'product model');
eq(a.summary.partLines, 8, 'total parts imported (2 placeholders skipped)');
eq(a.summary.unmappedSheets.length, 0, 'no unmapped sheets');

// Commodity comes from the Component Name prefix, not from a sheet name.
section('  commodity inferred from Component Name prefix');
eq(a.summary.byCommodity.Steel, 1, 'prefix "Sheetmetal" -> Steel');
eq(a.summary.byCommodity.Tubing, 1, 'prefix "Tubing" -> Tubing');
eq(a.summary.byCommodity.Electrical, 1, 'prefix "Electrical Components" -> Electrical');
eq(a.summary.byCommodity.Coil, 1, 'prefix "Evaporator Coil" -> Coil');
eq(a.summary.byCommodity.Packaging, 1, 'prefix "Packaging" -> Packaging');
eq(a.summary.byCommodity.Fasteners, 1, 'prefix "Fasteners" -> Fasteners');
eq(a.summary.byCommodity.Wire, 1, 'prefix "Wire" -> Wire');
eq(a.summary.byCommodity.Insulation, 1, 'prefix "Insulation" -> Insulation');

eq(a.summary.byModule['Cabinet/Enclosure'], 3, 'Cabinet/Enclosure = Steel + Fasteners + Insulation');
eq(a.summary.byModule['Coil Assembly'], 2, 'Coil Assembly = Tubing + Coil');
eq(a.summary.byModule['Blower Electrical'], 2, 'Blower Electrical = Electrical + Wire');
eq(a.summary.byModule['Packaging'], 1, 'Packaging');

// The name-cleaning guard: this must NOT collapse to "3".
section('  Variant A name cleaning');
eq(byName(a.parts, 'Sheetmetal - 3')?.name, 'Sheetmetal - 3', '"BOM Weight - Sheetmetal - 3" keeps its trailing number');
eq(byName(a.parts, 'Tubing')?.name, 'Tubing', '"BOM Weight - Tubing" -> "Tubing" (not empty)');
eq(byName(a.parts, 'Electrical Components')?.name, 'Electrical Components', '"BOM Weight - Electrical Components" survives');

// Geometry follows the inferred commodity.
eq(byName(a.parts, 'Sheetmetal - 3').geometryType, 'sheet_metal', 'Steel -> sheet_metal');
eq(byName(a.parts, 'Tubing').geometryType, 'circular', 'Tubing -> circular');
eq(byName(a.parts, 'Evaporator Coil').geometryType, 'circular', 'Coil -> circular');
eq(byName(a.parts, 'Wire').geometryType, 'custom', 'Wire -> custom');

const aFast = byName(a.parts, 'Fasteners');
eq(aFast.quantity, 36, 'fastener quantity');
close(aFast.unitCost, 0.03, 'unit cost = Total Cost 1.08 / 36', 1e-6);
close(aFast.weightLbs, 0.004, 'unit weight = Total Lbs 0.144 / 36', 1e-6);

section('  Variant A rollup fidelity');
const aCost = a.parts.reduce((sum, p) => sum + (p.unitCost ?? 0) * p.quantity, 0);
close(aCost, 177.18, 'sum(unitCost x qty) reproduces the file\'s Total Cost sum', 0.01);
eq(a.summary.sourceExtendedCostTotal, 177.18, 'file\'s own Total Cost sum');

// Variant A's Diameter column is "(In)" — so it MUST be converted, unlike
// Variant B's Evaporator Coil sheet. Same field, opposite handling, driven only
// by the units row.
close(byName(a.parts, 'Evaporator Coil').diameterOuterMm, 7.9248, 'Diameter 0.312 in x 25.4', 1e-3);

// ===========================================================================
section(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
