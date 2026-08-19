// ---------------------------------------------------------------------------
// scripts/make-mapped-fixture.mjs
//
// Generates the "Daikin Mapped BOMs" workbook the importer is verified against,
// into backend/fixtures/mapped/.
//
//   node scripts/make-mapped-fixture.mjs        (run from frontend/)
//
// WHY THIS EXISTS: the real "Daikin Mapped BOMs.xlsx" is a restricted customer
// file that cannot be brought onto this machine. What WAS supplied is the
// Goodman sheet as CSV, and that file — backend/fixtures/mapped/
// REFERENCE-goodman-sheet.csv — is checked in and used here VERBATIM. Sheet 1 of
// the fixture is therefore the real supplied data, not an imitation of it: every
// part number, cost, weight and remark, the four-row preamble, the bullet-glyph
// module headers, the Subtotal rows, the "Air Filtation Assm" misspelling and
// the fractional 0.03 quantity all come straight from the CSV.
//
// Sheets 2-4 are INVENTED, and are the part of this fixture that is not customer
// data. They exist because the whole point of this format is one product per
// sheet, and a one-sheet fixture would never exercise that. Each is deliberately
// shaped to pin down one behaviour the Goodman sheet can't:
//
//   Main BOM Carrier   Module column entirely BLANK, so the module has to come
//                      from the enclosing Level-2 header row. Also stores real
//                      numeric cells, where the CSV round-trip gives sheet 1
//                      strings like "3,633.3" — both paths get tested.
//   Main BOM Trane     An Electric Heater Assm that HAS parts (Goodman's is
//                      declared and empty), a fractional quantity, an uncosted
//                      row, and a module header decorated with a different glyph
//                      and a trailing space.
//   Main Bom Bosch     Lowercase "Bom" in the sheet name, exactly as the real
//                      workbook has it, and a spec line with NO "Product:"
//                      prefix so the fallback detection path is exercised.
//   Notes              Not a BOM sheet at all — proves unrecognised sheets are
//                      reported rather than crashing the parse.
//
// Every number in sheets 2-4 is invented and chosen to be hand-checkable: the
// module subtotals and grand total are stated in the sheet and are exactly the
// sum of the rows above them, so verify-mapped-import.mjs can reconcile the
// parser against the file's own arithmetic rather than against itself.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as XLSX from 'xlsx';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../backend/fixtures/mapped');
const REFERENCE_CSV = join(OUT_DIR, 'REFERENCE-goodman-sheet.csv');

/** The 31 columns, in the supplied order. Column 10 is genuinely unnamed. */
const HEADERS = [
  'Sl. No.', 'Level', 'Make / Buy', 'Sub Assy / Part / Consumable', 'Part No',
  'Part Description', 'Image', 'Qty', 'UOM', '',
  'Module', 'Sub-Module', 'Product Category', 'Primary Process',
  'Material / Specification', 'Secondary Process', 'Surface finish',
  'Weight (g)', 'Total Weight (g)', 'Length (mm)', 'Width/WØ (mm)', 'Height (mm)',
  'Diameter/OØ (mm)', 'Thickness (mm)', 'Unfolded L (mm)', 'Unfolded W (mm)',
  'Rate / Unit ($)', 'Cost / Set ($)', 'Remarks / Assumptions',
  'Buy Part $/Unit', 'Fasteners',
];

const C = {
  slNo: 0, level: 1, makeBuy: 2, subAssy: 3, partNo: 4, desc: 5, image: 6,
  qty: 7, uom: 8, module: 10, subModule: 11, prodCat: 12, primProc: 13,
  material: 14, secProc: 15, surfFinish: 16, weight: 17, totalWeight: 18,
  length: 19, width: 20, height: 21, diameter: 22, thickness: 23,
  unfoldedL: 24, unfoldedW: 25, rate: 26, costSet: 27, remarks: 28,
  buyPart: 29, fasteners: 30,
};

const blankRow = () => Array.from({ length: HEADERS.length }, () => null);

function row(cells) {
  const r = blankRow();
  for (const [field, value] of Object.entries(cells)) r[C[field]] = value;
  return r;
}

/** A Level-2 module header row. `glyph` mimics the source's bullet decoration. */
const moduleHeader = (name, glyph = '?') => row({ level: 2, subAssy: `${glyph} ${name}` });

/** A `Subtotal <module>` row. */
const subtotalRow = (name, weightG, cost) =>
  row({ desc: `Subtotal  ${name}`, totalWeight: weightG, costSet: cost });

const grandTotalRow = (weightG, cost) =>
  row({ desc: 'GRAND TOTAL (mapped parts, populated costs)', totalWeight: weightG, costSet: cost });

/** The four rows above the headers, matching the supplied sheet's preamble. */
function preamble(brand, specLine) {
  const title = blankRow();
  title[0] = `Bill of Material    ${brand}`;
  const spec = blankRow();
  spec[0] = specLine;
  const legend = blankRow();
  legend[0] = 'Colour key (Cell Value):';
  legend[C.partNo] = 'Assumed / derived  verify';
  legend[C.qty] = 'No fill = taken directly from product BOM';
  return { title, spec, legend };
}

function mappedSheet(brand, specLine, bodyRows) {
  const { title, spec, legend } = preamble(brand, specLine);
  return XLSX.utils.aoa_to_sheet([title, spec, HEADERS, legend, ...bodyRows]);
}

// ---------------------------------------------------------------------------
// Sheet 1 — the supplied Goodman data, verbatim from the reference CSV
// ---------------------------------------------------------------------------

function goodmanSheetFromCsv() {
  const csv = readFileSync(REFERENCE_CSV, 'utf8');
  const wb = XLSX.read(csv, { type: 'string', raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error(`Could not read ${REFERENCE_CSV}`);
  return sheet;
}

// ---------------------------------------------------------------------------
// Sheet 2 — Carrier. Module column blank; numeric cells; correct spelling.
// ---------------------------------------------------------------------------

const CARRIER_ROWS = [
  moduleHeader('Cabinet Assm'),
  row({
    slNo: 1, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 'C-1001',
    desc: '1  PANEL, FRONT ACCESS', qty: 1, uom: 'EA',
    prodCat: 'Sheet metal', primProc: 'Sheet-metal fabrication',
    material: 'Pre-painted galvanized steel', surfFinish: 'Powder paint',
    weight: 1500, totalWeight: 1500, length: 700, width: 550, thickness: 0.8,
    unfoldedL: 760, unfoldedW: 600, rate: 0.7, costSet: 2.1,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  row({
    slNo: 2, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 'C-1002',
    desc: '2  WRAPPER, CABINET', qty: 1, uom: 'EA',
    prodCat: 'Sheet metal', primProc: 'Sheet-metal fabrication',
    material: 'Pre-painted galvanized steel',
    weight: 11000, totalWeight: 11000, length: 1550, width: 1480, thickness: 0.6,
    rate: 0.65, costSet: 16.4,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  subtotalRow('Cabinet Assm', 12500, 18.5),

  moduleHeader('Coil Assm - Evaporator'),
  row({
    slNo: 3, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 'C-2001',
    desc: '3/8 Hairpin  Aluminum', qty: 80, uom: 'EA',
    prodCat: 'Aluminum coil', primProc: 'Coil fabrication & brazing',
    material: 'Aluminum', weight: 60, totalWeight: 4800, length: 430,
    diameter: 9.5, rate: 3.1, costSet: 44.0,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  row({
    slNo: 4, level: 4, makeBuy: 'Buy', subAssy: 'Part', partNo: 'C-2002',
    desc: 'TXV  VALVE, TXV-FX-4T-ADJ', qty: 1, uom: 'EA',
    prodCat: 'Refrigerant control', primProc: 'Purchased',
    weight: 400, totalWeight: 400, rate: 13.2, costSet: 13.2, buyPart: 13.2,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  subtotalRow('Coil Assm - Evaporator', 5200, 57.2),

  // Spelled CORRECTLY here, where the Goodman sheet misspells it. Proves
  // canonicalisation is a no-op on a name that's already right.
  moduleHeader('Air Filtration Assm'),
  row({
    slNo: 5, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 'C-3001',
    desc: 'FILTER BRACKET', qty: 2, uom: 'EA',
    prodCat: 'Sheet metal', primProc: 'Sheet-metal fabrication',
    material: 'Pre-painted galvanized steel',
    weight: 600, totalWeight: 1200, thickness: 1.5, rate: 0.68, costSet: 1.6,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  subtotalRow('Air Filtration Assm', 1200, 1.6),

  grandTotalRow(18900, 77.3),
].map((r) => {
  // The distinguishing feature of this sheet: the Module column is never filled,
  // so every part must inherit its module from the Level-2 header above it.
  r[C.module] = null;
  return r;
});

// ---------------------------------------------------------------------------
// Sheet 3 — Trane. Populated heater module, fractional qty, uncosted row.
// ---------------------------------------------------------------------------

const TRANE_ROWS = [
  moduleHeader('Blower Assm'),
  row({
    slNo: 1, level: 4, makeBuy: 'Buy', subAssy: 'Part', partNo: 'T-1001',
    desc: 'Blower Motor  ECM, 1/2 HP, VARIABLE SPEED', qty: 1, uom: 'EA',
    module: 'Blower Assm', prodCat: 'Electrical', primProc: 'Purchased',
    weight: 6000, totalWeight: 6000, rate: 65.0, costSet: 65.0, buyPart: 65.0,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  row({
    // Uncosted on purpose: $0.00 with a Remark saying so, exactly as the
    // Goodman sheet does it. Must import as UNCOSTED, not as free.
    slNo: 2, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 'T-1002',
    desc: '28  BLOWER HOUSING SCROLL', qty: 1, uom: 'EA',
    module: 'Blower Assm', prodCat: 'Sheet metal',
    primProc: 'Sheet-metal fabrication', material: 'Pre-painted galvanized steel',
    weight: 2000, totalWeight: 2000, thickness: 0.6, costSet: 0.0,
    remarks: 'Invented fixture row. Cost not populated in source.',
  }),
  subtotalRow('Blower Assm', 8000, 65.0),

  moduleHeader('Electric Heater Assm'),
  row({
    slNo: 3, level: 4, makeBuy: 'Buy', subAssy: 'Part', partNo: 'T-2001',
    desc: 'Heater Element  5 kW, NICHROME', qty: 1, uom: 'EA',
    module: 'Electric Heater Assm', prodCat: 'Electrical', primProc: 'Purchased',
    material: 'Nichrome ribbon', weight: 1800, totalWeight: 1800,
    rate: 41.0, costSet: 41.0, buyPart: 41.0,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  row({
    // Fractional quantity, as the Goodman sheet's brazing rod has. Total Weight
    // 0.0 forces the unit-weight fallback too.
    slNo: 4, level: 4, makeBuy: 'Buy', subAssy: 'Consumable', partNo: 'T-2002',
    desc: 'Aluminum Braze Rod  BRAZING ROD ALUMINUM', qty: 0.05, uom: 'EA',
    module: 'Electric Heater Assm', prodCat: 'Refrigerant tubing',
    primProc: 'Purchased', material: 'Aluminum',
    weight: 1.5, totalWeight: 0.0, rate: 36.0, costSet: 1.8, buyPart: 36.0,
    remarks: 'Invented fixture row. Not customer data.',
  }),
  subtotalRow('Electric Heater Assm', 1800, 42.8),

  // A different bullet glyph AND a trailing space, to prove decoration
  // stripping isn't tuned to the one character the CSV happens to contain.
  moduleHeader('Condensate Mgmt Assm ', '▸'),
  row({
    slNo: 5, level: 4, makeBuy: 'Buy', subAssy: 'Part', partNo: 'T-3001',
    desc: 'Drainpan Part  DRAIN PAN, HORIZONTAL >PVC<', qty: 1, uom: 'EA',
    module: 'Condensate Mgmt Assm', prodCat: 'Polymer', primProc: 'Extrusion',
    material: 'PVC', weight: 1700, totalWeight: 1700, rate: 2.24, costSet: 8.4,
    buyPart: 2.24, remarks: 'Invented fixture row. Not customer data.',
  }),
  subtotalRow('Condensate Mgmt Assm', 1700, 8.4),

  grandTotalRow(11500, 116.2),
];

// ---------------------------------------------------------------------------
// Sheet 4 — Bosch. Lowercase "Bom" in the name; no "Product:" prefix.
// ---------------------------------------------------------------------------

const BOSCH_ROWS = [
  moduleHeader('Packaging Assm'),
  row({
    slNo: 1, level: 4, makeBuy: 'Buy', subAssy: 'Part', partNo: 'B-1001',
    desc: 'Pallet Base  Skid, Export', qty: 1, uom: 'EA',
    module: 'Packaging Assm', prodCat: 'Packaging', primProc: 'Purchased',
    material: 'Wood', weight: 3400, totalWeight: 3400, rate: 4.8, costSet: 4.8,
    buyPart: 4.8, remarks: 'Invented fixture row. Not customer data.',
  }),
  row({
    slNo: 2, level: 4, makeBuy: 'Buy', subAssy: 'Literature', partNo: 'B-1002',
    desc: 'Caution Label 1  all labels', qty: 1, uom: 'EA',
    module: 'Packaging Assm', prodCat: 'Literature', primProc: 'Purchased',
    material: 'Adhesive label', rate: 2.2, costSet: 2.2, buyPart: 2.2,
    remarks: 'Invented fixture row. No weight in source.',
  }),
  subtotalRow('Packaging Assm', 3400, 7.0),

  moduleHeader('Cabinet Assm'),
  row({
    slNo: 3, level: 4, makeBuy: 'Buy', subAssy: 'Fastener', partNo: 'B-2001',
    desc: 'Bolt 1  All other fasteners', qty: 1, uom: 'EA',
    module: 'Cabinet Assm', prodCat: 'Fastener', primProc: 'Purchased',
    material: 'Steel', rate: 2.4, costSet: 2.4, buyPart: 2.4,
    fasteners: 'All other fasteners',
    remarks: 'Invented fixture row. Not customer data.',
  }),
  row({
    slNo: 4, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 'B-2002',
    desc: '18  WRAPPER, AIR HANDLER', qty: 1, uom: 'EA',
    module: 'Cabinet Assm', prodCat: 'Sheet metal',
    primProc: 'Sheet-metal fabrication', material: 'Galvanized steel',
    weight: 9800, totalWeight: 9800, length: 1450, width: 1400, thickness: 0.55,
    rate: 0.62, costSet: 14.9, remarks: 'Invented fixture row. Not customer data.',
  }),
  subtotalRow('Cabinet Assm', 9800, 17.3),

  grandTotalRow(13200, 24.3),
];

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb, goodmanSheetFromCsv(), 'Main BOM Goodman');

XLSX.utils.book_append_sheet(
  wb,
  mappedSheet(
    'Carrier',
    'Product: Carrier FJ5ANXC48L-MAP · 4-Ton multi-position AHU · Unit wt 145 lb (65.8 kg) ' +
      '· All-aluminum A-coil, factory TXV · Filter 16×20 · SEER2 15.5.   ' +
      '[Source: invented fixture sheet, not customer data]',
    CARRIER_ROWS,
  ),
  'Main BOM Carrier',
);

XLSX.utils.book_append_sheet(
  wb,
  mappedSheet(
    'Trane',
    'Product: Trane 5TEMCB02-MAP · 2-Ton multi-position AHU · Unit wt 132 lb (59.9 kg) ' +
      '· Electric heater fitted · SEER2 14.8.   [Source: invented fixture sheet, not customer data]',
    TRANE_ROWS,
  ),
  'Main BOM Trane',
);

XLSX.utils.book_append_sheet(
  wb,
  mappedSheet(
    'Bosch',
    // No "Product:" prefix — the parser has to fall back to "the line with the
    // dot separators" to find the identity segment.
    'Bosch BVA36WN1-MAP · 3-Ton multi-position AHU · Unit wt 118 lb (53.5 kg) · SEER2 15.0.',
    BOSCH_ROWS,
  ),
  // Lowercase "Bom", exactly as the real workbook spells this one sheet.
  'Main Bom Bosch',
);

// ---------------------------------------------------------------------------
// Sheet 5 — a template worksheet, reproducing the one in the real workbook.
//
// This is the sheet that caused the problem: its column headers are IDENTICAL to a
// product sheet's, so format detection matches it and it was imported as a product
// called "Reference BOM - Template" with a single refrigerator part left in it as
// an example. Its distinguishing features, all reproduced here: no "Product:" line
// at all, a template-ish sheet name, one part row, and a module ("Interior") that
// is not one of the eight AHU modules.
// ---------------------------------------------------------------------------
const TEMPLATE_ROWS = [
  moduleHeader('Interior'),
  row({
    slNo: 1, level: 4, makeBuy: 'Make', subAssy: 'Part', partNo: 0,
    desc: 'BOTTOM COVER - CRISPER TOP', qty: 1, uom: 'EA',
    module: 'Interior', prodCat: 'Polymer', primProc: 'Injection Molding',
    material: 'HIPS', weight: 250, totalWeight: 250,
    remarks: 'Example row left in the template. Not a real part of any product.',
  }),
  subtotalRow('Interior', 250, 0),
];

XLSX.utils.book_append_sheet(
  wb,
  // NO product spec line — that absence is the strongest template signal, so the
  // preamble's second row is left blank rather than carrying a description.
  mappedSheet('Reference BOM - Template', '', TEMPLATE_ROWS),
  'Reference BOM - Template',
);

XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ['Notes'],
    ['This sheet is not a BOM and must be reported as unrecognised, not parsed.'],
  ]),
  'Notes',
);

const out = join(OUT_DIR, 'SYNTHETIC-Daikin-Mapped-BOMs.xlsx');
writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log(`wrote ${out}`);
console.log(`  sheets: ${wb.SheetNames.join(', ')}`);
