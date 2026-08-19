// ---------------------------------------------------------------------------
// scripts/make-cedars-fixture.mjs
//
// Generates the two synthetic CEDARS workbooks the importer is verified
// against, into backend/fixtures/cedars/.
//
//   node scripts/make-cedars-fixture.mjs        (run from frontend/)
//
// WHY THIS EXISTS: the real Goodman/Trane/Carrier/Bosch exports are restricted
// customer files and cannot be brought onto this machine, so
// CEDARS_BOM_Import_Spec.md is the only description of them available. These
// fixtures reproduce that description as literally as possible — the exact
// per-sheet headers from spec §4, a parenthesised units row, both MISSPELLED
// sheet names ("Electrical Componenets", "Miscellanious"), scientific notation,
// NA/blank/0 sentinels, and placeholder rows — so the importer is exercised
// against the documented shape rather than a convenient one.
//
// Every number below is invented. Nothing here is customer data.
//
// The values are also chosen to be hand-checkable, and several rows exist to
// pin down one specific behaviour:
//   - Steel row 4 makes Total Cost disagree with Cost Per part, to prove the
//     importer prefers the extended figure and REPORTS the divergence.
//   - Evaporator Coil's Diameter column is declared "(mm)" while every other
//     dimension is "(In)", to prove unit handling is per column (spec §5's
//     "some coil/tubing values are already in mm") and not a blanket x25.4.
//   - LabelsLiterature has no "Cost Per part" column at all, so unit cost has
//     to come from Total Cost / Quantity.
//   - Performance and Key Features deliberately have NO units row, to prove the
//     units row is detected rather than assumed.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../backend/fixtures/cedars');

/** Build a sheet from a header row, an optional units row, and data rows. */
function sheet(headers, units, rows) {
  const aoa = units ? [headers, units, ...rows] : [headers, ...rows];
  return XLSX.utils.aoa_to_sheet(aoa);
}

function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name);
  return wb;
}

const NA = 'NA';

// ---------------------------------------------------------------------------
// Shared product-level sheets
// ---------------------------------------------------------------------------

function physicalData(model, depth, width, height, unitWeight, shipWeight) {
  return sheet(
    ['Id', 'Component Name', 'Depth', 'Width', 'Height', 'Unit Weight', 'Shipping Weight', 'Cost Per Load', 'Cost Per Unit', 'Trailer Size', 'Units Per Trailer', 'Model'],
    [null, null, '(In)', '(In)', '(In)', '(Lbs)', '(Lbs)', '($)', '($)', '(Ft)', '(EA)', null],
    [[1, 'Unit', depth, width, height, unitWeight, shipWeight, 2400, 42.1, '53ft', 57, model]],
  );
}

// No units row on purpose — proves detection, not assumption.
function keyFeatures(brand, make, type, model, serial, tonnage, coilType, fpi, blower, seer2) {
  return sheet(
    ['Brand', 'Make', 'Type', 'Model', 'Serial', 'System Tonnage', 'Coil Type Evaporator', 'Fins Per Inch Evaporator', 'Blower Motor', 'SEER2'],
    null,
    [[brand, make, type, model, serial, tonnage, coilType, fpi, blower, seer2]],
  );
}

function performance(btuh, outdoor, ahri, seer2, eer2) {
  return sheet(
    ['Cooling Capacity (BTUh)', 'Outdoor Unit', 'AHRI #', 'SEER2', 'EER2', 'Heating Capacity @47F', 'HSPF2'],
    null,
    [[btuh, outdoor, ahri, seer2, eer2, NA, NA]],
  );
}

function strikingDifferences() {
  return sheet(
    ['Id', 'Component Name', 'Picture 1', 'Feature Set 1', 'Picture 2', 'Feature Set 2'],
    null,
    [
      [1, 'Electrical Box', 'https://cedars.example/sd1a.jpg', 'Factory installed plastic breaker cover', 'https://cedars.example/sd1b.jpg', 'Field-installed metal cover'],
      [2, 'Drain Pan', 'https://cedars.example/sd2a.jpg', 'Single-piece moulded pan', null, null],
    ],
  );
}

// ---------------------------------------------------------------------------
// VARIANT B — Trane-style, one sheet per commodity
// ---------------------------------------------------------------------------

function variantB() {
  const steel = sheet(
    ['Id', 'Component Name', 'Part Description', 'Exterior Finish', 'Interior Finish', 'LBS', 'Thickness', 'Length', 'Width', 'Quantity', 'Picture', 'Top Coat $/Lbs', 'Thickness Steel', 'Cost Material', 'Cost Per part', 'ft-sq Sheet metal', 'Lbs Steel', 'Top Coat Cost', 'Top Coat Lbs', 'Total Cost', 'Total Lbs', 'Scrap rate', 'Total Cost*'],
    [null, null, null, null, null, '(LBs)', '(In)', '(In)', '(In)', '(EA)', null, '($/Lbs)', '(In)', '($)', '($)', '(Ft-Sq)', '(Lbs)', '($)', '(Lbs)', '($)', '(LBs)', '(%)', '($)'],
    [
      // Clean row: Total Cost / qty == Cost Per part, Total Lbs / qty == LBS.
      [1, 'Steel - Sheetmetal 1', 'Cabinet side panel, left', 'Pre-Painted', 'Galvanized', 4.25, 0.03, 31.5, 19.75, 2, 'https://cedars.example/steel-1.jpg', 0.42, 0.0299, 3.18, 6.42, 4.32, 4.2, 0.18, 0.05, 12.84, 8.5, 6.5, 12.9],
      // Scientific notation in Thickness (spec §1.5).
      [2, 'Steel - Sheetmetal 2', 'Cabinet side panel, right', 'Pre-Painted', 'Galvanized', 3.1, '3.1225739E-2', 28.25, 17.5, 1, null, 0.42, 0.031, 2.4, 5.1, 3.43, 3.05, 0.14, 0.04, 5.1, 3.1, 5, 5.2],
      // Placeholder row (spec §1.4) — must be skipped.
      [3, 'Sub-Assembly 40', NA, NA, NA, 0, NA, NA, NA, 0, null, NA, NA, 0, NA, NA, NA, NA, NA, 0, 0, NA, NA],
      // Divergent row: Total Cost 13.50 / 3 = 4.50, but Cost Per part says 4.00.
      [4, 'Steel - Sheetmetal 3', 'Blower deck', 'Galvanized', NA, 2.0, 0.036, 22.0, 14.5, 3, null, 0.42, 0.0355, 1.9, 4.0, 2.21, 1.95, 0.1, 0.03, 13.5, 6.0, 5.5, 13.6],
    ],
  );

  const tubing = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'LBS', 'Diameter', 'Lbs/In Copper', 'Lbs/In Aluminum', 'Length', 'Material', 'Quantity', 'Wall Thickness', 'Total Lbs', 'Cost Per part', 'Total Cost'],
    [null, null, null, '($)', '(LBs)', '(In)', '(Lbs/In)', '(Lbs/In)', '(In)', null, '(EA)', '(In)', '(LBs)', '($)', '($)'],
    [
      [10, 'Tubing - 3/8 Diameter', 'Suction line, coil to service valve', 2.15, 0.62, 0.375, 0.0121, NA, 42.0, 'Copper', 1, 0.032, 0.62, 4.85, 4.85],
      [11, 'Tubing - 1/4 Diameter', 'Liquid line with filter drier', 1.35, 0.31, 0.25, 0.0081, NA, 38.5, 'Copper', 1, 0.028, 0.31, 3.1, 3.1],
      [12, 'Sub-Assembly 41', NA, NA, 0, NA, NA, NA, NA, NA, 0, NA, 0, NA, 0],
    ],
  );

  // Diameter is declared in mm here while every other dimension is inches.
  const coil = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'Length', 'Width', 'Thickness', 'LBS', 'Material', 'Quantity', 'Diameter', 'Lbs/In Aluminum', 'Lbs/In Copper', 'Wall Thickness', 'Thickness Steel', 'Total Lbs', 'Length Hairpin', 'FPI', 'Measured hairpin Length', 'Cost Per part', 'Total Cost', 'Totals Fins', 'Scrap rate', 'Total Cost*', 'LBs*'],
    [null, null, null, '($)', '(In)', '(In)', '(In)', '(LBs)', null, '(EA)', '(mm)', '(Lbs/In)', '(Lbs/In)', '(In)', '(In)', '(LBs)', '(In)', '(Fins/In)', '(In)', '($)', '($)', '(EA)', '(%)', '($)', '(LBs)'],
    [
      [20, 'Evaporator Coil - Slab 1', '3-row slab, aluminium fin / copper hairpin', 18.4, 24.0, 18.0, 1.5, 9.8, 'Aluminum/Copper', 1, 9.52, 0.0042, 0.0121, 0.012, NA, 9.8, 19.5, 14, 19.25, 42.6, 42.6, 1450, 3.2, 43.1, 9.9],
      [21, 'Evaporator Coil - Distributor', 'Brass distributor with 6 feeder tubes', 4.2, 3.5, 2.0, NA, 0.44, 'Brass', 1, 6.35, NA, 0.0121, 0.018, NA, 0.44, NA, NA, NA, 8.9, 8.9, NA, NA, 9.0, 0.45],
    ],
  );

  // MISSPELLED sheet name, exactly as the Trane export has it.
  const electrical = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'LBS', 'Quantity', 'Cost Per part', 'Total Lbs', 'Total Cost'],
    [null, null, null, '($)', '(LBs)', '(EA)', '($)', '(LBs)', '($)'],
    [
      [30, 'Electrical Components - Blower Motor 1', '1/2 HP ECM, 4-speed', NA, 12.4, 1, 68.5, 12.4, 68.5],
      [31, 'Electrical Components - Control Board', 'Integrated furnace control', NA, 0.85, 1, 34.2, 0.85, 34.2],
      [32, 'Sub-Assembly 42', NA, 0, 0, 0, NA, 0, 0],
      [33, 'Electrical Components - Contactor', '24V coil, 30A', 1.2, 0.42, 1, 9.4, 0.42, 9.4],
    ],
  );

  const wire = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'LBS', 'Quantity', 'Length', 'Material', 'Wire Gauge', 'Wall Thickness', 'Total Lbs', 'Cost Per part', 'Total Cost'],
    [null, null, null, '($)', '(LBs)', '(EA)', '(In)', null, '(AWG)', '(In)', '(LBs)', '($)', '($)'],
    [
      [40, 'Wire - Line Voltage Harness', 'L1/L2 to contactor', 1.1, 0.35, 1, 36, 'Copper', '18 AWG', 0.03, 0.35, 3.4, 3.4],
      [41, 'Wire - Thermostat Harness', '5-conductor low voltage', 0.7, 0.18, 1, 48, 'Copper', '22 AWG', 0.024, 0.18, 2.2, 2.2],
    ],
  );

  // Deliberately padding-heavy, as spec §1.4 describes.
  const fasteners = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'LBS', 'Quantity', 'Total Lbs', 'Cost Per part', 'Total Cost'],
    [null, null, null, '($)', '(LBs)', '(EA)', '(LBs)', '($)', '($)'],
    [
      [50, 'Fasteners - Sheet Metal Screw #8', '#8 x 1/2 hex head', 0.02, 0.004, 24, 0.096, 0.03, 0.72],
      [51, 'Sub-Assembly 40', NA, NA, NA, 0, NA, NA, NA],
      [52, 'Sub-Assembly 40', NA, 0, 0, 0, 0, 0, 0],
      [53, 'Fasteners - Hex Nut 1/4', '1/4-20 zinc plated', 0.01, 0.002, 8, 0.016, 0.015, 0.12],
      [54, 'Sub-Assembly 40', NA, NA, NA, NA, NA, NA, NA],
      [55, null, null, null, null, null, null, null, null],
    ],
  );

  const insulation = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'Length', 'Width', 'Thickness', 'LBS', 'Quantity', 'Total Lbs', 'Cost Per part', 'Total Cost', 'Total Sq-Ft Insulation'],
    [null, null, null, '($)', '(In)', '(In)', '(In)', '(LBs)', '(EA)', '(LBs)', '($)', '($)', '(Ft-Sq)'],
    [
      [60, 'Insulation - Cabinet Liner', '1/2in fiberglass, foil faced', 0.85, 30, 20, 0.5, 1.2, 2, 2.4, 2.6, 5.2, 4.16],
      [61, 'Insulation - Foil Tape', 'Aluminium foil tape, 2in', 0.3, 120, 2, 0.004, 0.12, 1, 0.12, 1.1, 1.1, 1.67],
    ],
  );

  const packaging = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'LBS', 'Length', 'Width', 'Thickness', 'Quantity', 'Wall Thickness', 'Total Lbs', 'Cost Per part', 'Total Cost'],
    [null, null, null, '($)', '(LBs)', '(In)', '(In)', '(In)', '(EA)', '(In)', '(LBs)', '($)', '($)'],
    [
      [70, 'Packaging - Carton', 'Double-wall corrugated, printed', 1.4, 2.8, 34, 22, 0.25, 1, 0.25, 2.8, 4.2, 4.2],
      [71, 'Packaging - Foam Corner', 'EPS corner block', 0.22, 0.09, 6, 6, 3, 4, 3, 0.36, 0.28, 1.12],
    ],
  );

  // MISSPELLED sheet name, as some exports have it.
  const misc = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'LBS', 'Quantity', 'Diameter', 'Length', 'Width', 'Wall Thickness', 'Total Lbs', 'Cost Per part', 'Total Cost', 'Refrigerant'],
    [null, null, null, '($)', '(LBs)', '(EA)', '(In)', '(In)', '(In)', '(In)', '(LBs)', '($)', '($)', null],
    [
      // No " - " in the name at all — must survive prefix-stripping untouched.
      [80, 'Drain Pan Assembly', 'Injection-moulded polymer', 3.2, 1.9, 1, NA, 23, 17.5, 0.12, 1.9, 7.8, 7.8, NA],
      [81, 'Miscellanious - Filter Rack', 'Galvanised filter track', 1.1, 0.75, 2, NA, 21, 1.5, 0.05, 1.5, 2.3, 4.6, NA],
    ],
  );

  // NOTE: no "Cost Per part" column — unit cost must come from Total Cost / Qty.
  const labels = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'Length', 'Width', 'Quantity', 'LBS', 'Total Lbs', 'Total Cost'],
    [null, null, null, '($)', '(In)', '(In)', '(EA)', '(LBs)', '(LBs)', '($)'],
    [
      [90, 'Labels - Rating Plate', 'Adhesive, 4x6', 0.15, 6, 4, 1, 0.02, 0.02, 0.35],
      [91, 'Labels - Install Manual', 'Printed booklet, 24pp', 0.6, 11, 8.5, 1, 0.35, 0.35, 1.25],
    ],
  );

  // Times, no rates — the importer must skip these and say how many.
  const labor = sheet(
    ['Id', 'Component Name', 'Part Description', 'Special Notes', 'Time Labor', 'Time Machine', 'Labor Time', 'Total Main Support'],
    [null, null, null, null, '(Min)', '(Min)', '(Min)', '($)'],
    [
      [100, 'Labor - Cabinet Assembly', 'Fold and fasten cabinet', 'Two operators', 14.5, 6.2, 20.7, NA],
      [101, 'Labor - Coil Braze', 'Braze distributor to hairpins', NA, 8.0, 3.5, 11.5, NA],
      [102, 'Sub-Assembly 40', NA, NA, 0, 0, 0, NA],
    ],
  );

  return book([
    ['Steel', steel],
    ['Tubing', tubing],
    ['Evaporator Coil', coil],
    ['Electrical Componenets', electrical],
    ['Wire', wire],
    ['Fasteners', fasteners],
    ['InsulationTape', insulation],
    ['Packaging', packaging],
    ['Miscellanious', misc],
    ['LabelsLiterature', labels],
    ['Labor', labor],
    ['Physical Data', physicalData('TAM7A0C24V21', 21, 24.5, 46, 148, 162)],
    ['Key Features', keyFeatures('Trane', 'Trane Technologies', 'Air Handler', 'TAM7A0C24V21', '24512WKR3F', 2, 'Slab', 14, '1/2 HP ECM', 16.2)],
    ['Performance', performance(23800, '4TWR7024', '209481633', 16.2, 12.4)],
    ['Striking Differences', strikingDifferences()],
  ]);
}

// ---------------------------------------------------------------------------
// VARIANT A — Goodman-style, one combined CostWeights sheet
// ---------------------------------------------------------------------------

function variantA() {
  const costWeights = sheet(
    ['Id', 'Component Name', 'Part Description', 'Cost Material', 'Quantity', 'LBS', 'Diameter', 'Length', 'Width', 'Thickness', 'Lbs/In Aluminum', 'Exterior Finish', 'Interior Finish', 'FPI', 'Measured hairpin Length', 'Top Coat $/Lbs', 'Thickness Steel', 'Totals Fins', 'Total Cost', 'Total Lbs', 'LBs*', 'Scrap rate', 'Total Cost*'],
    [null, null, null, '($)', '(EA)', '(LBs)', '(In)', '(In)', '(In)', '(In)', '(Lbs/In)', null, null, '(Fins/In)', '(In)', '($/Lbs)', '(In)', '(EA)', '($)', '(LBs)', '(LBs)', '(%)', '($)'],
    [
      // Commodity comes from the Component Name prefix, not a sheet name.
      // Name must survive as "Sheetmetal - 3", not collapse to "3".
      [1, 'BOM Weight - Sheetmetal - 3', 'Cabinet top panel', 2.9, 1, 3.85, NA, 29.5, 18.25, 0.032, NA, 'Pre-Painted', 'Galvanized', NA, NA, 0.4, 0.0319, NA, 7.4, 3.85, 3.9, 6.2, 7.5],
      [2, 'BOM Weight - Tubing', 'Refrigerant tubing set', 3.1, 1, 1.42, 0.375, 96, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, 9.8, 1.42, 1.5, NA, 9.9],
      [3, 'BOM Weight - Electrical Components', 'Blower motor + control board', 12.4, 1, 13.2, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, 104.2, 13.2, 13.5, NA, 105],
      [4, 'Sub-Assembly 40', NA, 0, 0, 0, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, 0, 0, NA, NA, NA],
      [5, 'BOM Weight - Evaporator Coil', '2-row slab with hairpins', 16.8, 1, 8.9, 0.312, 22.5, 17.0, 1.25, 0.0042, NA, NA, 12, 18.75, NA, NA, 1180, 38.4, 8.9, 9.1, 3.4, 38.9],
      [6, 'BOM Weight - Packaging', 'Carton + foam set', 1.2, 1, 2.6, NA, 33, 21.5, 0.25, NA, NA, NA, NA, NA, NA, NA, NA, 4.4, 2.6, 2.7, NA, 4.5],
      [7, 'BOM Weight - Fasteners', 'Assorted screws and nuts', 0.02, 36, 0.004, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, 1.08, 0.144, 0.15, NA, 1.1],
      [8, 'Sub-Assembly 41', NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA],
      [9, 'BOM Weight - Wire', 'Line and low voltage harnesses', 1.8, 1, 0.53, NA, 84, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, 5.6, 0.53, 0.55, NA, 5.7],
      [10, 'BOM Weight - Insulation', 'Cabinet liner and foil tape', 1.15, 1, 1.32, NA, 30, 20, 0.5, NA, NA, NA, NA, NA, NA, NA, NA, 6.3, 1.32, 1.35, NA, 6.4],
    ],
  );

  return book([
    ['CostWeights', costWeights],
    ['Physical Data', physicalData('AMST24BU1300', 19.75, 22, 43.5, 132, 145)],
    ['Key Features', keyFeatures('Goodman', 'Daikin Comfort Technologies', 'Air Handler', 'AMST24BU1300', 'GD2405118472', 2, 'Slab', 12, '1/2 HP PSC', 15.2)],
    ['Performance', performance(23600, 'GLXS4BA2410', '208913344', 15.2, 11.8)],
    ['Striking Differences', strikingDifferences()],
  ]);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

for (const [file, wb] of [
  ['SYNTHETIC-variantB-trane-style.xlsx', variantB()],
  ['SYNTHETIC-variantA-goodman-style.xlsx', variantA()],
]) {
  const out = join(OUT_DIR, file);
  writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(`wrote ${out}`);
}
