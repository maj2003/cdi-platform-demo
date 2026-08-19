// ---------------------------------------------------------------------------
// src/lib/importCedarsBom.js — read a CEDARS Excel export into a teardown.
//
// The mirror image of exportBom.js, and the same shape: a pure builder
// (parseCedarsWorkbook) that takes an already-loaded workbook and returns plain
// data, plus one thin I/O wrapper (importCedarsBom) that reads a File. The
// builder touches no browser API, which is what lets it be verified in Node
// against a fixture without a DOM (see scripts/verify-cedars-import.mjs, and
// scripts/make-cedars-fixture.mjs which generates what it reads).
//
// The authority for every mapping, quirk and unit in this file is
// CEDARS_BOM_Import_Spec.md at the repo root. The real Goodman/Trane/Carrier/
// Bosch exports are restricted customer files that cannot be brought onto this
// machine, so that spec — not the files — is what this was written and tested
// against. Read it before changing anything here.
//
// ---------------------------------------------------------------------------
// THE FOUR THINGS THAT MAKE THESE FILES AWKWARD
//
// 1. Row 1 is a UNITS row ("(LBs)", "(In)", "($)"), not data. Data starts at
//    row 2. It's also load-bearing: spec §5 warns some coil/tubing dimensions
//    are already metric, so the unit is read per column rather than assuming
//    every number is imperial.
// 2. The files are mostly padding — placeholder rows with NA/0 across the
//    board, thousands of them in Labor and Fasteners.
// 3. Sheet names are MISSPELLED in the real exports ("Electrical Componenets",
//    "Miscellanious"). Those are matched deliberately; they are not typos in
//    this file to be tidied away.
// 4. Several columns exist twice, once starred ("Total Cost" and "Total Cost*",
//    "LBS" and "LBs*"). The spec's mapping table covers only the unstarred
//    ones, so header matching preserves the asterisk specifically to keep them
//    apart — normalising it away would let a lookup for "Total Cost" silently
//    return the starred column instead, whose meaning is undocumented.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

// Cell coercion (key/num/measure/text/round) and the unit constants moved to
// bomCells.js when the Mapped BOM workbook format arrived — see that file for
// why there is exactly one definition of "empty" in this app. The rules below
// are unchanged; only their address is.
import {
  INCHES_TO_MM,
  LBS_TO_GRAMS,
  key,
  measure,
  num,
  round,
  text,
} from './bomCells.js';

/**
 * Commodity -> the module it belongs to and the geometry it implies.
 * Straight from spec §2. Several commodities share a module on purpose
 * (Fasteners, Insulation and Misc all sit in Cabinet/Enclosure), which is
 * exactly why `commodity` is stored on the Part as well as the module — the
 * module cannot be reversed back into the commodity.
 *
 * `module: null` means "not a module" — Labor. See LABOR_IS_NOT_IMPORTED below.
 */
const COMMODITIES = Object.freeze({
  Steel: { module: 'Cabinet/Enclosure', geometryType: 'sheet_metal' },
  Tubing: { module: 'Coil Assembly', geometryType: 'circular' },
  Coil: { module: 'Coil Assembly', geometryType: 'circular' },
  Electrical: { module: 'Blower Electrical', geometryType: 'custom' },
  Wire: { module: 'Blower Electrical', geometryType: 'custom' },
  Fasteners: { module: 'Cabinet/Enclosure', geometryType: 'custom' },
  Insulation: { module: 'Cabinet/Enclosure', geometryType: 'custom' },
  Packaging: { module: 'Packaging', geometryType: 'custom' },
  Labels: { module: 'Packaging', geometryType: 'custom' },
  Misc: { module: 'Cabinet/Enclosure', geometryType: 'custom' },
  Labor: { module: null, geometryType: null },
});

/**
 * WHY LABOR IS SKIPPED RATHER THAN IMPORTED AS A COST LINE.
 *
 * Spec §2 allows either. The Labor sheet's columns are Time Labor / Time
 * Machine / Labor Time / Total Main Support — times, with no rate anywhere in
 * the file. Turning a time into a cost needs a $/hour figure these exports
 * don't carry, so "import as a labour cost" would mean inventing the rate. The
 * rows are counted and reported instead, so the number is visible rather than
 * quietly absent. Cost.labourCost stays 0 and honest until a rate exists.
 */
const LABOR_IS_NOT_IMPORTED = true;

/** Normalised sheet name -> commodity. Includes the real files' misspellings. */
const SHEET_COMMODITY = Object.freeze({
  steel: 'Steel',
  sheetmetal: 'Steel',
  tubing: 'Tubing',
  evaporatorcoil: 'Coil',
  electricalcomponents: 'Electrical',
  electricalcomponenets: 'Electrical', // misspelled in the Trane export
  wire: 'Wire',
  fasteners: 'Fasteners',
  insulationtape: 'Insulation', // also matches "Insulation/Tape"
  packaging: 'Packaging',
  labelsliterature: 'Labels', // also matches "Labels/Literature"
  miscellaneous: 'Misc',
  miscellanious: 'Misc', // misspelled in some exports
  labor: 'Labor',
});

/**
 * Component-Name keywords -> commodity, for Variant A (Goodman `CostWeights`),
 * where there is no per-commodity sheet and the prefix is the only signal:
 * "BOM Weight - Sheetmetal - 3" is Steel, "BOM Weight - Tubing" is Tubing.
 *
 * ORDER IS SIGNIFICANT — first match wins, so the more specific phrase has to
 * come first. "evaporator coil" precedes "coil", and "sheetmetal" precedes
 * "steel", so a row labelled "Steel - Sheetmetal 1" doesn't depend on which of
 * its two equally-valid keywords is tested first.
 */
const NAME_COMMODITY_PATTERNS = Object.freeze([
  ['sheetmetal', 'Steel'],
  ['sheet metal', 'Steel'],
  ['steel', 'Steel'],
  ['evaporator coil', 'Coil'],
  ['tubing', 'Tubing'],
  ['hairpin', 'Coil'],
  ['coil', 'Coil'],
  ['electrical', 'Electrical'],
  ['wire', 'Wire'],
  ['fastener', 'Fasteners'],
  ['insulation', 'Insulation'],
  ['tape', 'Insulation'],
  ['packaging', 'Packaging'],
  ['literature', 'Labels'],
  ['label', 'Labels'],
  ['labor', 'Labor'],
]);

/** Segments stripped from the front of a Component Name — see cleanPartName. */
const NAME_PREFIX_NOISE = Object.freeze([
  'bom weight',
  'bom cost',
  'steel',
  'sheetmetal',
  'sheet metal',
  'tubing',
  'evaporator coil',
  'coil',
  'electrical components',
  'electrical componenets',
  'electrical',
  'wire',
  'fasteners',
  'insulation',
  'insulationtape',
  'insulation/tape',
  'packaging',
  'labels',
  'labelsliterature',
  'labels/literature',
  'miscellaneous',
  'miscellanious',
]);

/** Sheets consumed for the PRODUCT record rather than for parts. */
const PRODUCT_SHEETS = Object.freeze({
  physicaldata: 'physicalData',
  keyfeatures: 'keyFeatures',
  performance: 'performance',
  strikingdifferences: 'strikingDifferences',
});

// ---------------------------------------------------------------------------
// Unit conversion — CEDARS-specific, because it depends on this format's
// per-column units row. The Mapped BOM workbook states mm and grams in its
// headers and needs none of this.
// ---------------------------------------------------------------------------

/**
 * Convert a length to mm using the sheet's own units row.
 *
 * Spec §5 says the source is inches but warns that some coil/tubing values are
 * already metric, so the units row decides and inches is only the fallback.
 */
function toMm(value, unitHint) {
  if (value === null) return null;
  const u = String(unitHint ?? '').toLowerCase();
  if (u.includes('mm')) return value;
  if (u.includes('cm')) return value * 10;
  if (u.includes('ft') || u.includes('feet')) return value * 12 * INCHES_TO_MM;
  return value * INCHES_TO_MM;
}

/** Convert a weight to grams using the units row; lbs is the documented default. */
function toGrams(value, unitHint) {
  if (value === null) return null;
  const u = String(unitHint ?? '').toLowerCase();
  if (u.includes('lb')) return value * LBS_TO_GRAMS;
  if (u.includes('kg')) return value * 1000;
  if (/\bg\b|gram/.test(u)) return value;
  return value * LBS_TO_GRAMS;
}

// ---------------------------------------------------------------------------
// Sheet reading
// ---------------------------------------------------------------------------

/**
 * A sheet as { headers, units, rows } with the units row identified.
 *
 * Spec §1.1 states row 1 is always a units row, but this DETECTS it rather than
 * assuming: a sheet whose second row is real data would otherwise lose its
 * first part silently, and losing a part without saying so is the worst
 * available failure. Detection is "most non-empty cells look like (this)".
 */
function readSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });

  if (!grid.length) return { headers: [], units: [], rows: [], hadUnitsRow: false };

  const headers = (grid[0] ?? []).map((h) => (h === null ? '' : String(h).trim()));

  const candidate = grid[1] ?? [];
  const filled = candidate.filter((c) => text(c) !== null);
  const parenthesised = filled.filter((c) => /^\(.*\)$/.test(String(c).trim()));
  const hadUnitsRow = filled.length > 0 && parenthesised.length >= Math.ceil(filled.length / 2);

  return {
    headers,
    units: hadUnitsRow ? candidate.map((u) => text(u)) : [],
    rows: grid.slice(hadUnitsRow ? 2 : 1),
    hadUnitsRow,
  };
}

/**
 * A column accessor for one sheet.
 *
 * Keeps the FIRST index for any normalised header, so a duplicated column name
 * resolves to the leftmost occurrence rather than whichever happened to be last.
 */
function columnLookup({ headers, units }) {
  const index = new Map();
  headers.forEach((header, i) => {
    const k = key(header);
    if (k && !index.has(k)) index.set(k, i);
  });

  /** First candidate header that exists, by priority order. @returns {number|null} */
  const find = (...candidates) => {
    for (const candidate of candidates) {
      const i = index.get(key(candidate));
      if (i !== undefined) return i;
    }
    return null;
  };

  return {
    has: (...candidates) => find(...candidates) !== null,
    /** Raw cell value for the first matching column. */
    cell: (row, ...candidates) => {
      const i = find(...candidates);
      return i === null ? null : (row[i] ?? null);
    },
    /** The units-row entry for the first matching column, e.g. "(LBs)". */
    unit: (...candidates) => {
      const i = find(...candidates);
      return i === null ? null : (units[i] ?? null);
    },
    headers,
  };
}

// ---------------------------------------------------------------------------
// Name handling
// ---------------------------------------------------------------------------

/** Commodity implied by a Component Name — Variant A's only signal. */
function commodityFromName(name) {
  const haystack = String(name ?? '').toLowerCase();
  for (const [needle, commodity] of NAME_COMMODITY_PATTERNS) {
    if (haystack.includes(needle)) return commodity;
  }
  return 'Misc';
}

/**
 * Strip the commodity/boilerplate prefix off a Component Name (spec §3).
 *
 *   "Steel - Sheetmetal 1"            -> "Sheetmetal 1"
 *   "Electrical Components - Blower Motor 1" -> "Blower Motor 1"
 *   "BOM Weight - Sheetmetal - 22"    -> "Sheetmetal - 22"
 *   "BOM Weight - Tubing"             -> "Tubing"
 *
 * The last two are why this isn't a plain prefix-strip. Removing every noise
 * segment from "BOM Weight - Sheetmetal - 22" would leave the part named "22",
 * and stripping "Tubing" off "BOM Weight - Tubing" would leave it named
 * nothing. So: drop leading noise segments, but never leave the name empty or
 * purely numeric.
 */
function cleanPartName(raw) {
  const original = text(raw);
  if (!original) return null;

  let segments = original
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length <= 1) return original;

  const isNoise = (s) => NAME_PREFIX_NOISE.includes(s.toLowerCase());
  const isNumeric = (s) => /^[\d.\s]+$/.test(s);

  while (segments.length > 1 && isNoise(segments[0])) {
    const remainder = segments.slice(1);
    // Refuse the strip if what's left says nothing on its own.
    if (remainder.every(isNumeric)) break;
    segments = remainder;
  }

  return segments.join(' - ') || original;
}

// ---------------------------------------------------------------------------
// Row -> part
// ---------------------------------------------------------------------------

/**
 * Turn one spreadsheet row into a part payload, or null if it's padding.
 *
 * @returns {{part: object|null, skipReason: string|null}}
 */
function readRow(row, cols, commodity, opts) {
  const rawName = cols.cell(row, 'Component Name');
  const name = cleanPartName(rawName);

  // ---- quantity ----------------------------------------------------------
  // num() not measure(): quantity 0 is meaningful as a skip signal below,
  // whereas a 0 dimension is just absence. Defaults to 1 for the write.
  const rawQty = num(cols.cell(row, 'Quantity', 'Qty'));

  // ---- cost --------------------------------------------------------------
  // Two stated sources, and they are NOT interchangeable. "Cost Per part" is a
  // true per-part cost. "Cost Material" is the material component only, and
  // several sheets (LabelsLiterature, and Variant A's CostWeights) have no
  // "Cost Per part" column at all — so Cost Material is the fallback for the
  // VALUE, but only the real per-part column is used for the divergence check
  // below. Comparing a total against a material-only figure would flag every
  // such row as "divergent" when nothing is actually wrong.
  const extendedCost = measure(cols.cell(row, 'Total Cost'));
  const statedPerPartCost = measure(cols.cell(row, 'Cost Per part'));
  const statedUnitCost = statedPerPartCost ?? measure(cols.cell(row, 'Cost Material'));

  // ---- weight ------------------------------------------------------------
  const extendedLbs = measure(cols.cell(row, 'Total Lbs'));
  const statedLbs = measure(cols.cell(row, 'LBS'));

  // ---- is this a real part, or padding? ----------------------------------
  // Spec §1.4: skip when Cost Material, LBS and Quantity are all empty/0/NA.
  // Widened to the extended columns too — a row carrying only Total Cost is
  // still a real part, and the narrow reading would throw it away.
  const hasCost = extendedCost !== null || statedUnitCost !== null;
  const hasWeight = extendedLbs !== null || statedLbs !== null;
  const hasQty = rawQty !== null && rawQty !== 0;

  if (!name) return { part: null, skipReason: 'no Component Name' };
  if (!hasCost && !hasWeight && !hasQty) {
    return { part: null, skipReason: 'placeholder row (no cost, weight or quantity)' };
  }
  // Spec §7's demo filter: quantity alone doesn't make a row worth importing.
  if (opts.requireCostOrWeight && !hasCost && !hasWeight) {
    return { part: null, skipReason: 'no cost or weight data' };
  }

  const quantity = rawQty && rawQty > 0 ? Math.max(1, Math.round(rawQty)) : 1;

  // ---- unit cost and unit weight ----------------------------------------
  // DERIVED FROM THE EXTENDED FIGURE WHERE THERE IS ONE, and this is deliberate.
  // benchmarkService computes extendedCost as unitCost x quantity, so seeding
  // the unit figure from Total Cost / quantity makes the app's rollups
  // reproduce the source file's own totals exactly. Taking the stated per-part
  // column instead would leave every module total slightly adrift from the
  // spreadsheet the numbers came from — the one comparison anyone will actually
  // run against this import. Where they disagree the divergence is counted and
  // reported rather than swallowed.
  const unitCost = extendedCost !== null ? extendedCost / quantity : statedUnitCost;
  const unitLbs = extendedLbs !== null ? extendedLbs / quantity : statedLbs;

  const costDiverged =
    extendedCost !== null &&
    statedPerPartCost !== null &&
    Math.abs(unitCost - statedPerPartCost) > Math.max(0.01, Math.abs(statedPerPartCost) * 0.01);

  // Worth reporting separately: this row's unit cost rests on Cost Material
  // (material only) because the sheet carries no per-part cost column, so it may
  // understate the true part cost. Not an error — just a weaker basis, and the
  // kind of thing that should be visible rather than inferred later.
  const costFromMaterialOnly =
    extendedCost === null && statedPerPartCost === null && statedUnitCost !== null;

  const weightUnit = extendedLbs !== null ? cols.unit('Total Lbs') : cols.unit('LBS');

  const geometry = COMMODITIES[commodity]?.geometryType ?? 'custom';

  const part = {
    name,
    commodity,
    moduleName: COMMODITIES[commodity]?.module ?? null,
    geometryType: geometry,
    quantity,

    description: text(cols.cell(row, 'Part Description')),
    // The CEDARS row Id is the only stable identifier in the file, so it lands
    // in partNo to keep a row traceable back to the source. Not a manufacturer
    // part number — the exports don't carry one.
    partNo: text(cols.cell(row, 'Id')) ? `CEDARS-${text(cols.cell(row, 'Id'))}` : null,
    uom: (cols.unit('Quantity') ?? '').replace(/[()]/g, '').trim() || null,

    material: text(cols.cell(row, 'Material')),
    // Exterior/Interior map to the two finish columns Part already has, rather
    // than one of them becoming a note.
    surfaceFinish: text(cols.cell(row, 'Exterior Finish')),
    finish: text(cols.cell(row, 'Interior Finish')),

    weightLbs: round(unitLbs, 6),
    weightG: round(toGrams(unitLbs, weightUnit), 3),

    lengthMm: round(toMm(measure(cols.cell(row, 'Length')), cols.unit('Length')), 3),
    widthMm: round(toMm(measure(cols.cell(row, 'Width')), cols.unit('Width')), 3),
    thicknessMm: round(
      toMm(
        measure(cols.cell(row, 'Thickness', 'Thickness Steel')),
        cols.unit('Thickness', 'Thickness Steel'),
      ),
      4,
    ),
    diameterOuterMm: round(toMm(measure(cols.cell(row, 'Diameter')), cols.unit('Diameter')), 3),
    wallThicknessMm: round(
      toMm(measure(cols.cell(row, 'Wall Thickness')), cols.unit('Wall Thickness')),
      4,
    ),

    fpi: (() => {
      const n = measure(cols.cell(row, 'FPI'));
      return n === null ? null : Math.round(n);
    })(),
    wireGauge: text(cols.cell(row, 'Wire Gauge')),
    scrapRatePct: measure(cols.cell(row, 'Scrap rate')),
    imageUrl: text(cols.cell(row, 'Picture')),

    isFastener: commodity === 'Fasteners',

    unitCost: unitCost === null ? null : round(unitCost, 6),
    currency: 'USD',
  };

  return {
    part,
    skipReason: null,
    costDiverged,
    costFromMaterialOnly,
    sourceExtendedCost: extendedCost,
  };
}

// ---------------------------------------------------------------------------
// Product-level sheets
// ---------------------------------------------------------------------------

/** One-row sheet as a { normalisedHeader: value } object. */
function readSingleRow(workbook, sheetName) {
  const { headers, rows } = readSheet(workbook, sheetName);
  const row = rows.find((r) => (r ?? []).some((c) => text(c) !== null));
  if (!row) return {};

  const out = {};
  headers.forEach((header, i) => {
    const k = key(header);
    if (k) out[k] = row[i] ?? null;
  });
  return out;
}

/**
 * Build the product record from Physical Data / Key Features / Performance.
 *
 * Everything here is a best guess from whichever sheets happen to exist, so the
 * result is returned with `inferred` flags and the UI makes the fields editable
 * before anything is written. Guessing a competitor's model name wrong and
 * saving it silently would be worse than asking.
 */
function readProduct(workbook, sheetNames, fileName) {
  const kf = sheetNames.keyFeatures ? readSingleRow(workbook, sheetNames.keyFeatures) : {};
  const pd = sheetNames.physicalData ? readSingleRow(workbook, sheetNames.physicalData) : {};
  const perf = sheetNames.performance ? readSingleRow(workbook, sheetNames.performance) : {};

  const stem = String(fileName ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  const brand = text(kf.brand) ?? text(kf.make) ?? text(stem.split(/\s+/)[0]) ?? 'Unknown';
  const name = text(kf.model) ?? text(pd.model) ?? text(stem) ?? 'Imported BOM';
  const category = text(kf.type) ?? 'Air Handler';

  // Notes stay a short human sentence, not a data dump — it renders on the
  // product card. The richer sheets are reported in the parse result instead.
  const noteBits = [
    text(kf.systemtonnage) && `${text(kf.systemtonnage)} ton`,
    text(kf.seer2) && `SEER2 ${text(kf.seer2)}`,
    text(perf.seer2) && !text(kf.seer2) && `SEER2 ${text(perf.seer2)}`,
    text(kf.blowermotor) && `${text(kf.blowermotor)} blower`,
    text(kf.coiltypeevaporator) && `${text(kf.coiltypeevaporator)} evaporator`,
    text(pd.unitweight) && `unit weight ${text(pd.unitweight)}`,
    text(perf.coolingcapacitybtuh) && `${text(perf.coolingcapacitybtuh)} BTUh cooling`,
    text(kf.serial) && `serial ${text(kf.serial)}`,
  ].filter(Boolean);

  return {
    product: {
      name,
      brand,
      category,
      notes: noteBits.length ? `Imported from CEDARS BOM — ${noteBits.join(', ')}.` : null,
    },
    inferred: {
      brand: !text(kf.brand) && !text(kf.make),
      name: !text(kf.model) && !text(pd.model),
      category: !text(kf.type),
    },
    physicalData: pd,
    keyFeatures: kf,
    performance: perf,
  };
}

/**
 * Striking Differences: the Picture-N / Feature Set-N pairs.
 *
 * PARSED BUT NOT STORED. Spec §4 marks this as the source for the
 * apple-to-apple design comparison, but there's no column to put it in and no
 * screen that reads it, so returning it and saying so beats writing it
 * somewhere it would rot. It's here so the next person doesn't have to
 * re-derive the shape.
 */
function readStrikingDifferences(workbook, sheetName) {
  if (!sheetName) return [];
  const { headers, rows } = readSheet(workbook, sheetName);
  const cols = columnLookup({ headers, units: [] });

  const pairs = [];
  headers.forEach((header, i) => {
    const m = /^picture\s*(\d+)$/i.exec(String(header).trim());
    if (m) pairs.push({ n: Number(m[1]), pictureIndex: i });
  });
  pairs.forEach((p) => {
    const i = headers.findIndex((h) => key(h) === key(`Feature Set ${p.n}`));
    p.featureIndex = i === -1 ? null : i;
  });

  const out = [];
  for (const row of rows) {
    if (!(row ?? []).some((c) => text(c) !== null)) continue;
    const component = text(cols.cell(row, 'Component Name'));
    for (const p of pairs) {
      const picture = text(row[p.pictureIndex]);
      const feature = p.featureIndex === null ? null : text(row[p.featureIndex]);
      if (picture || feature) {
        out.push({ component, slot: p.n, picture, feature });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

/**
 * Parse a loaded CEDARS workbook into a ready-to-POST teardown.
 *
 * @param {import('xlsx').WorkBook} workbook
 * @param {object} [options]
 * @param {string} [options.fileName]  used only to guess brand/model when the
 *   Key Features / Physical Data sheets are absent
 * @param {boolean} [options.requireCostOrWeight=true]  spec §7 — drop rows that
 *   carry a quantity but no cost and no weight
 * @param {number|null} [options.maxParts=null]  spec §7's demo cap. Keeps the
 *   highest extended-cost rows. NEVER silent: whatever it drops is reported in
 *   `summary.droppedByCap`.
 * @returns {{product: object, parts: Array<object>, summary: object}}
 */
export function parseCedarsWorkbook(workbook, options = {}) {
  const { fileName = '', requireCostOrWeight = true, maxParts = null } = options;
  const opts = { requireCostOrWeight };

  // ---- classify the sheets ----------------------------------------------
  const commoditySheets = [];
  const productSheetNames = {};
  const unmappedSheets = [];
  let costWeightsSheet = null;

  for (const sheetName of workbook.SheetNames) {
    const k = key(sheetName);
    if (k === 'costweights') {
      costWeightsSheet = sheetName;
    } else if (PRODUCT_SHEETS[k]) {
      productSheetNames[PRODUCT_SHEETS[k]] = sheetName;
    } else if (SHEET_COMMODITY[k]) {
      commoditySheets.push({ sheetName, commodity: SHEET_COMMODITY[k] });
    } else {
      unmappedSheets.push(sheetName);
    }
  }

  // ---- variant detection (spec §0) --------------------------------------
  const variant = costWeightsSheet ? 'A' : 'B';

  if (variant === 'B' && commoditySheets.length === 0) {
    throw new Error(
      `This doesn't look like a CEDARS export: no "CostWeights" sheet and no recognised commodity sheets. Found: ${
        workbook.SheetNames.join(', ') || '(no sheets)'
      }`,
    );
  }

  // ---- read the part rows ----------------------------------------------
  const parts = [];
  const skipped = {};
  const perSheet = [];
  let laborRowsSkipped = 0;
  let costDivergedRows = 0;
  let costFromMaterialOnlyRows = 0;
  let sourceExtendedCostTotal = 0;

  const noteSkip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  /** Walk one sheet's rows. `fixedCommodity` is null for Variant A. */
  const walk = (sheetName, fixedCommodity) => {
    const sheetData = readSheet(workbook, sheetName);
    const cols = columnLookup(sheetData);
    let kept = 0;
    let dropped = 0;

    for (const row of sheetData.rows) {
      if (!(row ?? []).some((c) => text(c) !== null)) {
        dropped += 1;
        noteSkip('blank row');
        continue;
      }

      const commodity =
        fixedCommodity ?? commodityFromName(cols.cell(row, 'Component Name'));

      if (commodity === 'Labor' && LABOR_IS_NOT_IMPORTED) {
        laborRowsSkipped += 1;
        dropped += 1;
        continue;
      }

      const { part, skipReason, costDiverged, costFromMaterialOnly, sourceExtendedCost } =
        readRow(row, cols, commodity, opts);
      if (!part) {
        dropped += 1;
        noteSkip(skipReason);
        continue;
      }

      parts.push(part);
      kept += 1;
      if (costDiverged) costDivergedRows += 1;
      if (costFromMaterialOnly) costFromMaterialOnlyRows += 1;
      if (sourceExtendedCost !== null) sourceExtendedCostTotal += sourceExtendedCost;
    }

    perSheet.push({
      sheet: sheetName,
      commodity: fixedCommodity ?? 'mixed (from Component Name)',
      hadUnitsRow: sheetData.hadUnitsRow,
      kept,
      dropped,
    });
  };

  if (variant === 'A') {
    walk(costWeightsSheet, null);
    // A Goodman file can still carry commodity sheets alongside CostWeights.
    // Skipping them avoids importing the same part twice, but say so.
    for (const { sheetName } of commoditySheets) unmappedSheets.push(`${sheetName} (ignored: Variant A uses CostWeights)`);
  } else {
    for (const { sheetName, commodity } of commoditySheets) walk(sheetName, commodity);
  }

  // ---- product record --------------------------------------------------
  const { product, inferred, physicalData, keyFeatures, performance } = readProduct(
    workbook,
    productSheetNames,
    fileName,
  );
  const strikingDifferences = readStrikingDifferences(
    workbook,
    productSheetNames.strikingDifferences,
  );

  // Part.productCategory mirrors the product's own category — the source files
  // carry no separate per-part category.
  for (const part of parts) part.productCategory = product.category;

  // ---- spec §7 demo cap ------------------------------------------------
  let kept = parts;
  let droppedByCap = 0;
  if (maxParts !== null && parts.length > maxParts) {
    const byCost = [...parts].sort(
      (a, b) => (b.unitCost ?? 0) * b.quantity - (a.unitCost ?? 0) * a.quantity,
    );
    kept = byCost.slice(0, maxParts);
    droppedByCap = parts.length - kept.length;
  }

  const moduleTally = {};
  const commodityTally = {};
  for (const part of kept) {
    moduleTally[part.moduleName] = (moduleTally[part.moduleName] ?? 0) + 1;
    commodityTally[part.commodity] = (commodityTally[part.commodity] ?? 0) + 1;
  }

  return {
    product,
    parts: kept,
    summary: {
      variant,
      fileName,
      sheetsSeen: workbook.SheetNames.length,
      perSheet,
      unmappedSheets,
      productSheets: Object.values(productSheetNames),
      inferred,
      partLines: kept.length,
      partUnits: kept.reduce((s, p) => s + p.quantity, 0),
      byModule: moduleTally,
      byCommodity: commodityTally,
      skipped,
      skippedTotal: Object.values(skipped).reduce((s, n) => s + n, 0),
      laborRowsSkipped,
      droppedByCap,
      costDivergedRows,
      costFromMaterialOnlyRows,
      // The file's own Total Cost sum, before this import derives anything.
      // Kept so a verification pass can compare the app's rollup against the
      // spreadsheet rather than against another copy of its own arithmetic.
      sourceExtendedCostTotal: round(sourceExtendedCostTotal, 2),
      strikingDifferencesFound: strikingDifferences.length,
      physicalData,
      keyFeatures,
      performance,
      strikingDifferences,
    },
  };
}

/**
 * Read a File/Blob and parse it. The one function that does I/O.
 *
 * @param {File|Blob} file
 * @param {object} [options] forwarded to parseCedarsWorkbook
 */
export async function importCedarsBom(file, options = {}) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return parseCedarsWorkbook(workbook, { fileName: file.name, ...options });
}

/**
 * Is this a CEDARS export at all?
 *
 * Split out of parseCedarsWorkbook's variant detection when a second format
 * arrived, so importWorkbook.js can ASK before parsing. Detecting inside the
 * parse meant the only way to find out was to catch an exception, and a wrong
 * guess then surfaced as "this isn't a CEDARS export" for a file that was never
 * claimed to be one.
 */
export function looksLikeCedarsWorkbook(workbook) {
  return (workbook?.SheetNames ?? []).some((name) => {
    const k = key(name);
    return k === 'costweights' || Boolean(SHEET_COMMODITY[k]);
  });
}

export const CEDARS_INTERNALS = Object.freeze({
  COMMODITIES,
  SHEET_COMMODITY,
  LBS_TO_GRAMS,
  INCHES_TO_MM,
  cleanPartName,
  commodityFromName,
  num,
  measure,
  toMm,
  toGrams,
});
