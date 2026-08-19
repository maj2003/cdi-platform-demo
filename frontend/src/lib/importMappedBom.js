// ---------------------------------------------------------------------------
// src/lib/importMappedBom.js — read a "Daikin Mapped BOM" workbook.
//
// The SECOND supported import format, alongside importCedarsBom.js. Where a
// CEDARS export is one product spread across ten commodity sheets, a Mapped BOM
// workbook is the opposite shape: one sheet per PRODUCT, each already mapped to
// the AHU module structure by hand.
//
//   Main BOM Goodman  -> one product
//   Main BOM Carrier  -> one product
//   Main BOM Trane    -> one product
//   Main Bom Bosch    -> one product      (note the lowercase "Bom")
//
// That structural difference — N products per file instead of one — is the whole
// reason this is a separate parser rather than another variant flag inside the
// CEDARS one. See importWorkbook.js for how a file is routed to one or the other.
//
// The reference for every mapping below is backend/fixtures/mapped/
// REFERENCE-goodman-sheet.csv, which is the Goodman sheet exactly as supplied.
// The .xlsx itself is a restricted customer file that cannot be brought onto
// this machine, so that CSV is what this was written and tested against.
//
// ---------------------------------------------------------------------------
// THE SIX THINGS THAT MAKE THIS FORMAT AWKWARD
//
// 1. The header row is NOT row 1. Row 1 is a title ("Bill of Material
//    Goodman"), row 2 is a product spec line, row 3 is the headers, and row 4
//    is a colour-key legend. All four are located by content, not by index,
//    because a hand-maintained workbook grows and loses rows at the top.
// 2. The sheet is an OUTLINE, not a table. Level-2 rows are module headers,
//    Level-4 rows are parts, and there are `Subtotal <module>` and `GRAND
//    TOTAL` rows interleaved. Feeding a subtotal row in as a part would double
//    count an entire module.
// 3. `Rate / Unit ($)` is NOT unit cost. For Make parts it's a $/kg-style
//    material rate, so Rate x Qty bears no relation to `Cost / Set ($)`
//    (row 9: rate $0.7106, qty 1, cost/set $1.83). Cost / Set is authoritative.
//    See readRow.
// 4. `Product Category` is a COMMODITY ("Sheet metal", "Polymer", "Insulation"),
//    not the product's category. It lands in Part.commodity. Mapping it to
//    Part.productCategory because the names coincide would put "Sheet metal"
//    where every other product says "Air Handler".
// 5. Quantities can be FRACTIONAL (row 52: 0.03 EA of brazing rod). Part.quantity
//    is an integer column, so the fraction is folded into the unit cost instead
//    of being rounded away — see readRow.
// 6. `$0.00` and a blank both appear, and the file's own Remarks column tells
//    you they mean the same thing ("Cost not populated in source"). measure()
//    in bomCells.js collapses both to null, so an uncosted part reads as
//    uncosted rather than free.
// ---------------------------------------------------------------------------

import { key, measure, num, round, text } from './bomCells.js';

/**
 * Headers that identify this format. Detection needs THREE of these, so a
 * workbook that happens to have a "Module" column isn't mistaken for one.
 * "Sub Assy / Part / Consumable" is the strongest signal — no other format in
 * this app has anything like it.
 */
const SIGNATURE_HEADERS = Object.freeze([
  'Sl. No.',
  'Sub Assy / Part / Consumable',
  'Part Description',
  'Module',
  'Cost / Set ($)',
  'Total Weight (g)',
]);
const SIGNATURE_MINIMUM = 3;

/** How far down to look for the header row before giving up. */
const MAX_HEADER_SCAN_ROWS = 12;

/**
 * The eight Level-1 AHU modules this app benchmarks on, spelled the way the
 * seeded products spell them.
 *
 * WHY THESE ARE CANONICALISED RATHER THAN TAKEN VERBATIM. The module name is
 * the JOIN KEY for every cross-product view in this app — the per-module
 * leaderboard, the Best-of-Best composite, the compare page all group by it. The
 * supplied Goodman sheet spells one of them "Air Filtation Assm", missing the
 * 'r'. Imported verbatim, that product's filtration module would silently never
 * match any other product's, and the Best-of-Best module table would show two
 * near-identical rows instead of one comparison. So near-misses are snapped to
 * the canonical spelling — and every snap is REPORTED in
 * `summary.modulesCanonicalised`, never applied silently.
 */
const CANONICAL_MODULES = Object.freeze([
  'Packaging Assm',
  'Cabinet Assm',
  'Coil Assm - Evaporator',
  'Blower Assm',
  'Electrical Assm',
  'Condensate Mgmt Assm',
  'Air Filtration Assm',
  'Electric Heater Assm',
]);

/**
 * Commodity (this format's "Product Category") -> geometry, most specific first.
 * Order matters: "Aluminum coil" must be tested before any broader rule.
 */
const GEOMETRY_BY_COMMODITY = Object.freeze([
  [/sheet.?metal/i, 'sheet_metal'],
  [/coil|tubing/i, 'circular'],
]);

// ---------------------------------------------------------------------------
// TEMPLATE / REFERENCE SHEET DETECTION
//
// A real Mapped BOM workbook carries working sheets alongside the product ones —
// the supplied file has a "Reference BOM - Template" sheet whose headers are
// identical to a product sheet's, so header-based format detection matches it and
// it was imported as a product: brand "Reference BOM - Template", one module
// "Interior", one part "BOTTOM COVER - CRISPER TOP" (a refrigerator part left in
// the template as an example).
//
// WHY NAMED REASONS RATHER THAN A CONFIDENCE SCORE. The output of this is shown to
// the user, who then decides. "No `Product:` line, and none of its modules are AHU
// modules" is something a person can act on; "confidence 0.31" is not. It also
// keeps the rule auditable — every reason below is a fact about the sheet.
//
// WHY IT ONLY UNTICKS, NEVER DROPS. The two failure modes are asymmetric and both
// recoverable: a real sheet wrongly flagged costs one click to include, while a
// template wrongly imported costs one Delete Product. That asymmetry is what makes
// "exclude by default, but say why and let me override" the safe design — and it
// is why this must never silently discard a sheet.
//
// The separation on real data is not marginal:
//                        Goodman/Trane/Bosch   Reference BOM - Template
//   product identity     present               ABSENT
//   part lines           101 / 114 / 124       1
//   modules              7 / 7 / 8             1 ("Interior")
//   canonical modules    all                   NONE
//   brand vs name        differ                IDENTICAL (both the sheet name)
// ---------------------------------------------------------------------------

/** Sheet names that announce themselves as not-a-product. */
const TEMPLATE_NAME_PATTERN =
  /\b(template|reference|example|sample|master|blank|legend|instructions?|guide|notes?)\b/i;

/** A sheet with this many parts or fewer is too thin to be a real teardown. */
const THIN_SHEET_PARTS = 3;

/**
 * Why this sheet looks like a template. Empty array means it looks like a product.
 *
 * STRONG signals flag on their own; WEAK signals need two. Both kinds are returned
 * so the panel can show all of them, not just the one that tripped the rule.
 *
 * @returns {{reasons: string[], isLikelyTemplate: boolean}}
 */
function assessTemplateLikeness({
  sheetName,
  hasProductIdentity,
  partLines,
  moduleNames,
  brand,
  name,
}) {
  const strong = [];
  const weak = [];

  if (!hasProductIdentity) {
    strong.push('no product line — the sheet never states a brand and model');
  }
  if (TEMPLATE_NAME_PATTERN.test(String(sheetName ?? ''))) {
    strong.push(`the sheet name "${sheetName}" reads as a template, not a product`);
  }

  if (partLines <= THIN_SHEET_PARTS) {
    weak.push(`only ${partLines} part ${partLines === 1 ? 'row' : 'rows'}`);
  }
  const canonicalHits = moduleNames.filter((m) => CANONICAL_MODULES.includes(m)).length;
  if (moduleNames.length > 0 && canonicalHits === 0) {
    weak.push(`none of its modules (${moduleNames.join(', ')}) is a standard AHU module`);
  }
  if (brand && name && brand === name) {
    weak.push('brand and model are the same text, so both fell back to the sheet name');
  }

  return {
    reasons: [...strong, ...weak],
    isLikelyTemplate: strong.length >= 1 || weak.length >= 2,
  };
}

/** Fallback when the commodity says nothing — the process sometimes does. */
const GEOMETRY_BY_PROCESS = Object.freeze([
  [/sheet.?metal/i, 'sheet_metal'],
  [/tubing|coil|braz/i, 'circular'],
]);

// ---------------------------------------------------------------------------
// Module name canonicalisation
// ---------------------------------------------------------------------------

/** Levenshtein distance, capped — we only care about "within 2". */
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Strip decoration: the source prefixes module headers with a bullet glyph. */
function stripDecoration(raw) {
  return String(raw ?? '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Snap a module name to its canonical spelling if it's clearly the same module.
 *
 * Deliberately conservative — an exact match, then a punctuation/case-only
 * match, then a typo within two characters THAT ALSO SHARES ITS FIRST WORD.
 * The first-word requirement is what stops "Blower Assm" and "Cabinet Assm"
 * from ever being considered neighbours; without it, edit distance alone on
 * short names is a merge waiting to happen.
 *
 * @returns {{name: string, from: string|null}}  `from` is set only on a change
 */
export function canonicaliseModule(raw) {
  const cleaned = stripDecoration(raw);
  if (!cleaned) return { name: '', from: null };

  if (CANONICAL_MODULES.includes(cleaned)) return { name: cleaned, from: null };

  const loose = key(cleaned);
  const byLoose = CANONICAL_MODULES.find((m) => key(m) === loose);
  if (byLoose) return { name: byLoose, from: cleaned };

  const firstWord = cleaned.toLowerCase().split(/\s+/)[0];
  const near = CANONICAL_MODULES.find(
    (m) =>
      m.toLowerCase().split(/\s+/)[0] === firstWord &&
      editDistance(key(m), loose) <= 2,
  );
  if (near) return { name: near, from: cleaned };

  // Not one of the eight. A workbook may legitimately carry a module this app
  // has never seen; that's data, not an error.
  return { name: cleaned, from: null };
}

// ---------------------------------------------------------------------------
// Sheet reading
// ---------------------------------------------------------------------------

/** A row is blank if every cell is blank. */
function isBlankRow(row) {
  return !(row ?? []).some((c) => text(c) !== null);
}

/**
 * Locate the header row by content.
 *
 * Returns null when the sheet doesn't look like this format at all, which is
 * also how detection is implemented — see isMappedWorkbook.
 */
function findHeaderRow(grid) {
  const wanted = SIGNATURE_HEADERS.map(key);
  const limit = Math.min(grid.length, MAX_HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const keys = new Set((grid[i] ?? []).map(key).filter(Boolean));
    const hits = wanted.filter((w) => keys.has(w)).length;
    if (hits >= SIGNATURE_MINIMUM) return i;
  }
  return null;
}

/** Column accessor. Keeps the FIRST index for a repeated header. */
function columnLookup(headers) {
  const index = new Map();
  headers.forEach((header, i) => {
    const k = key(header);
    if (k && !index.has(k)) index.set(k, i);
  });
  const find = (...candidates) => {
    for (const candidate of candidates) {
      const i = index.get(key(candidate));
      if (i !== undefined) return i;
    }
    return null;
  };
  return {
    has: (...c) => find(...c) !== null,
    cell: (row, ...c) => {
      const i = find(...c);
      return i === null ? null : (row?.[i] ?? null);
    },
  };
}

// ---------------------------------------------------------------------------
// Product record
// ---------------------------------------------------------------------------

/** "Main BOM Goodman" / "Main Bom Bosch" -> "Goodman" / "Bosch". */
function brandFromSheetName(sheetName) {
  const stripped = String(sheetName ?? '')
    .replace(/^\s*main\s*bom\s*/i, '')
    .replace(/\s*bom\s*$/i, '')
    .trim();
  return stripped || null;
}

/**
 * Build the product record from the title and spec rows above the headers.
 *
 * The spec row looks like:
 *   Product: Goodman AMST48CU1300 · 4-Ton multi-position AHU · Unit wt 149 lb …
 *
 * Segment 1 is brand + model; the rest is prose. As with the CEDARS importer
 * everything here is a best guess, so `inferred` flags travel with it and the
 * panel makes all three fields editable before anything is written. Saving a
 * competitor's model number wrong is worse than one more confirmation click.
 */
function readProductHeader(preHeaderRows, sheetName) {
  const flat = preHeaderRows.map((r) => (r ?? []).map((c) => text(c)).filter(Boolean).join(' | '));

  const specLine =
    flat.find((line) => /^\s*product\s*:/i.test(line)) ??
    flat.find((line) => /·/.test(line)) ??
    null;
  const titleLine = flat.find((line) => /bill of material/i.test(line)) ?? null;

  const brandHint =
    brandFromSheetName(sheetName) ??
    (titleLine ? text(titleLine.replace(/bill of material/i, '')) : null);

  // Drop the "[Source: …]" provenance tail — it describes the mapping exercise,
  // not the product.
  const body = (specLine ?? '')
    .replace(/^\s*product\s*:\s*/i, '')
    .replace(/\[\s*source\s*:[^\]]*\]/gi, '')
    .trim();

  const segments = body
    .split('·')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const identity = segments[0] ?? null;

  let brand = brandHint;
  let model = null;
  if (identity) {
    if (brandHint && identity.toLowerCase().startsWith(brandHint.toLowerCase())) {
      model = identity.slice(brandHint.length).trim() || null;
    } else {
      const words = identity.split(/\s+/);
      brand = brandHint ?? words[0];
      model = (brandHint ? identity : words.slice(1).join(' ')).trim() || null;
    }
  }

  const prose = segments.slice(1).join(' · ');
  const category = /\bahu\b|air handl/i.test(body) ? 'Air Handler' : 'Air Handler';

  // Notes render on the product card, so they're capped. The untruncated text
  // is returned in the summary rather than thrown away.
  const NOTE_CAP = 400;
  const noteBody = prose.length > NOTE_CAP ? `${prose.slice(0, NOTE_CAP - 1).trimEnd()}…` : prose;

  return {
    product: {
      name: model ?? sheetName,
      brand: brand ?? 'Unknown',
      category,
      notes: noteBody ? `Imported from Daikin Mapped BOM — ${noteBody}` : null,
    },
    inferred: {
      // TRUE whenever the sheet states no product identity, even though a brand
      // was produced. Without the identity line the "brand" is just the sheet's
      // own name, and that is exactly how a sheet called "Reference BOM -
      // Template" ended up in the repository as a manufacturer: the old test was
      // `!identity && !brandHint`, which was false because the sheet name had
      // filled brandHint in, so nothing was ever flagged as guessed.
      brand: !identity,
      name: !model,
      // Nothing in this format states a category; "Air Handler" is this
      // workbook's subject matter, but it is still an assumption.
      category: true,
    },
    /** No identity line at all — the strongest single template signal. */
    hasProductIdentity: Boolean(identity),
    specLine: specLine ?? null,
    titleLine: titleLine ?? null,
    specSegments: segments,
  };
}

// ---------------------------------------------------------------------------
// Row -> part
// ---------------------------------------------------------------------------

/** Collapse the runs of whitespace this format uses as a name/detail separator. */
function cleanName(raw) {
  const t = text(raw);
  if (!t) return null;
  return t.replace(/\s{2,}/g, ' — ').replace(/\s+/g, ' ').trim();
}

/**
 * One outline row -> a part payload.
 *
 * Every row carrying a Sl. No. is treated as a real part, even with no cost and
 * no weight. That's the opposite of the CEDARS importer's placeholder filter,
 * and deliberately so: a CEDARS export is machine-generated and padded with
 * thousands of empty rows, whereas a number in this file's Sl. No. column means
 * a person put that part in the BOM by hand. Fourteen of the Goodman sheet's 101
 * rows have no populated cost — its own Remarks say so — and dropping them would
 * make the import disagree with the source's own numbering while claiming to be
 * complete. They import uncosted, and the count is reported.
 */
function readRow(row, cols, moduleName) {
  const name = cleanName(cols.cell(row, 'Part Description'));
  if (!name) return { part: null, skipReason: 'no Part Description' };

  const rawQty = num(cols.cell(row, 'Qty', 'Quantity'));

  // ---- cost --------------------------------------------------------------
  // Cost / Set is the extended (per-set) figure and the authoritative one; see
  // awkwardness 3. Rate / Unit is kept only to count how often the two disagree.
  const extendedCost = measure(cols.cell(row, 'Cost / Set ($)', 'Cost / Set'));
  const statedRate = measure(cols.cell(row, 'Rate / Unit ($)', 'Rate / Unit'));

  // ---- weight ------------------------------------------------------------
  // Already grams — the column says so. No conversion, unlike CEDARS.
  const extendedWeightG = measure(cols.cell(row, 'Total Weight (g)'));
  const statedWeightG = measure(cols.cell(row, 'Weight (g)'));

  // ---- quantity ----------------------------------------------------------
  // Part.quantity is an integer column and a fractional quantity (0.03 EA of
  // brazing rod) cannot survive it. Rounding 0.03 to 0 then clamping to 1 would
  // multiply that line's cost 33-fold in every rollup, so the fraction is folded
  // into the unit figures below instead: quantity becomes 1 and unit cost becomes
  // the whole extended cost, which keeps the module total exactly right. Reported
  // as `fractionalQuantityRows`.
  const fractionalQuantity = rawQty !== null && rawQty > 0 && !Number.isInteger(rawQty);
  const quantity = rawQty !== null && rawQty >= 1 ? Math.round(rawQty) : 1;

  // ---- unit figures ------------------------------------------------------
  // Derived from the extended column, so benchmarkService's unitCost x quantity
  // reproduces this file's own Subtotal rows exactly. That reconciliation is the
  // first thing anyone will check against the spreadsheet, and it's asserted in
  // verify-mapped-import.mjs against the subtotals the file states itself.
  const unitCost = extendedCost !== null ? extendedCost / quantity : null;
  // The fallback matters and is counted. Row 52's Total Weight is 0.0 while its
  // per-unit Weight is 1.6 g — the extended column was never populated. Taking
  // the per-unit figure is the better datum, but it means this row's weight is
  // NOT in the file's own subtotal, so the reconciliation below will differ by
  // exactly that much. Reported as `weightFromUnitFallbackRows` so the
  // difference is explained rather than mysterious.
  const weightFromUnitFallback = extendedWeightG === null && statedWeightG !== null;
  const unitWeightG = extendedWeightG !== null ? extendedWeightG / quantity : statedWeightG;

  const commodity = text(cols.cell(row, 'Product Category'));
  const primaryProcess = text(cols.cell(row, 'Primary Process'));
  const rowType = text(cols.cell(row, 'Sub Assy / Part / Consumable'));
  const diameterOuterMm = measure(cols.cell(row, 'Diameter/OØ (mm)', 'Diameter/O (mm)', 'Diameter'));

  let geometryType =
    GEOMETRY_BY_COMMODITY.find(([re]) => re.test(commodity ?? ''))?.[1] ??
    GEOMETRY_BY_PROCESS.find(([re]) => re.test(primaryProcess ?? ''))?.[1] ??
    'custom';
  // A part whose only stated dimension is a diameter is circular whatever its
  // commodity says — the blower wheel is filed under "Blower mechanical" but has
  // a 269.7 mm OD and nothing else. Leaving it `custom` would hide that diameter
  // in the geometry editor, which shows the group the type selects.
  let geometryFromDiameter = false;
  if (geometryType === 'custom' && diameterOuterMm !== null) {
    geometryType = 'circular';
    geometryFromDiameter = true;
  }

  const part = {
    name,
    moduleName,
    quantity,
    geometryType,

    partNo: text(cols.cell(row, 'Part No')),
    // Remarks / Assumptions is provenance the mapping author wrote by hand
    // ("Src: CostWeights r28 · Packaging", "Material assumed galvanized steel").
    // It lands in `description`, which the part editor surfaces as Notes, so it
    // stays readable AND correctable rather than being import-only metadata.
    description: text(cols.cell(row, 'Remarks / Assumptions')),
    makeOrBuy: text(cols.cell(row, 'Make / Buy')),
    uom: text(cols.cell(row, 'UOM')),

    commodity,
    material: text(cols.cell(row, 'Material / Specification', 'Material')),
    primaryProcess,
    secondaryProcess: text(cols.cell(row, 'Secondary Process')),
    surfaceFinish: text(cols.cell(row, 'Surface finish')),

    weightG: round(unitWeightG, 3),

    lengthMm: measure(cols.cell(row, 'Length (mm)')),
    widthMm: measure(cols.cell(row, 'Width/WØ (mm)', 'Width/W (mm)', 'Width')),
    heightMm: measure(cols.cell(row, 'Height (mm)')),
    thicknessMm: measure(cols.cell(row, 'Thickness (mm)')),
    diameterOuterMm,
    unfoldedLengthMm: measure(cols.cell(row, 'Unfolded L (mm)')),
    unfoldedWidthMm: measure(cols.cell(row, 'Unfolded W (mm)')),

    imageUrl: text(cols.cell(row, 'Image')),
    isFastener: /fastener/i.test(rowType ?? '') || /fastener/i.test(commodity ?? ''),

    unitCost: unitCost === null ? null : round(unitCost, 6),
    currency: 'USD',
  };

  return {
    part,
    skipReason: null,
    rowType,
    fractionalQuantity,
    geometryFromDiameter,
    weightFromUnitFallback,
    // Rate x Qty vs Cost / Set. Counted, not corrected — see awkwardness 3.
    rateDiverged:
      extendedCost !== null &&
      statedRate !== null &&
      Math.abs(statedRate * quantity - extendedCost) >
        Math.max(0.02, Math.abs(extendedCost) * 0.02),
    // Total Weight vs Weight x Qty. Row 39's are wildly apart because its Qty
    // was never populated in the source; the extended figure is trusted.
    weightDiverged:
      extendedWeightG !== null &&
      statedWeightG !== null &&
      Math.abs(statedWeightG * quantity - extendedWeightG) >
        Math.max(0.2, Math.abs(extendedWeightG) * 0.02),
    sourceExtendedCost: extendedCost,
    sourceExtendedWeightG: extendedWeightG,
  };
}

// ---------------------------------------------------------------------------
// One sheet -> one product
// ---------------------------------------------------------------------------

/**
 * Parse a single "Main BOM <brand>" sheet.
 *
 * @returns {{product, parts, summary}|null}  null when the sheet isn't this format
 */
export function parseMappedSheet(grid, sheetName, options = {}) {
  const { maxParts = null } = options;

  const headerRowIndex = findHeaderRow(grid);
  if (headerRowIndex === null) return null;

  const headers = (grid[headerRowIndex] ?? []).map((h) => (h === null ? '' : String(h).trim()));
  const cols = columnLookup(headers);
  const bodyRows = grid.slice(headerRowIndex + 1);

  const {
    product,
    inferred,
    hasProductIdentity,
    specLine,
    titleLine,
    specSegments,
  } = readProductHeader(grid.slice(0, headerRowIndex), sheetName);

  const parts = [];
  const skipped = {};
  const noteSkip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  /** Modules declared by a Level-2 header row, in file order. */
  const declaredModules = [];
  /** What the file says each module totals — its own Subtotal rows. */
  const statedSubtotals = {};
  const modulesCanonicalised = {};
  const rowTypes = {};

  let statedGrandTotal = null;
  let currentModule = null;
  let fractionalQuantityRows = 0;
  let geometryFromDiameterRows = 0;
  let weightFromUnitFallbackRows = 0;
  let rateDivergedRows = 0;
  let weightDivergedRows = 0;
  let uncostedRows = 0;
  let unweighedRows = 0;
  let sourceExtendedCostTotal = 0;
  let sourceExtendedWeightGTotal = 0;

  const noteModule = (raw) => {
    const { name, from } = canonicaliseModule(raw);
    if (from) modulesCanonicalised[from] = name;
    return name;
  };

  for (const row of bodyRows) {
    if (isBlankRow(row)) {
      noteSkip('blank row');
      continue;
    }

    const firstCell = text(row?.[0]);
    if (firstCell && /colou?r key/i.test(firstCell)) {
      noteSkip('colour-key legend row');
      continue;
    }

    const description = text(cols.cell(row, 'Part Description'));
    const level = num(cols.cell(row, 'Level'));
    const slNo = num(cols.cell(row, 'Sl. No.', 'Sl No'));
    const subAssy = text(cols.cell(row, 'Sub Assy / Part / Consumable'));

    // ---- GRAND TOTAL -----------------------------------------------------
    if (description && /^grand total/i.test(description)) {
      statedGrandTotal = {
        cost: measure(cols.cell(row, 'Cost / Set ($)', 'Cost / Set')),
        weightG: measure(cols.cell(row, 'Total Weight (g)')),
      };
      noteSkip('grand total row');
      continue;
    }

    // ---- Subtotal <module> -----------------------------------------------
    // Captured rather than discarded: these are the file's own arithmetic, and
    // comparing them against what this parser produces is the only check that
    // doesn't just re-derive its own output. Surfaced in the import panel and
    // asserted in verify-mapped-import.mjs.
    if (description && /^subtotal\b/i.test(description)) {
      const label = noteModule(description.replace(/^subtotal\b/i, ''));
      if (label) {
        statedSubtotals[label] = {
          cost: measure(cols.cell(row, 'Cost / Set ($)', 'Cost / Set')),
          weightG: measure(cols.cell(row, 'Total Weight (g)')),
        };
      }
      noteSkip('module subtotal row');
      continue;
    }

    // ---- Level-2 module header -------------------------------------------
    if (slNo === null && level === 2 && subAssy) {
      currentModule = noteModule(subAssy);
      if (currentModule && !declaredModules.includes(currentModule)) {
        declaredModules.push(currentModule);
      }
      continue;
    }

    // ---- part ------------------------------------------------------------
    // A Sl. No. is what makes a row a part. Rows without one that reach here are
    // outline furniture this parser doesn't recognise, and are reported as such.
    if (slNo === null) {
      noteSkip(description ? 'no Sl. No.' : 'unrecognised outline row');
      continue;
    }

    // The Module column wins where it's populated; the enclosing Level-2 header
    // is the fallback. Both exist in the file and they agree throughout the
    // Goodman sheet, but the column is per-row and therefore the more specific
    // statement of intent.
    const rowModuleRaw = text(cols.cell(row, 'Module'));
    const moduleName = rowModuleRaw ? noteModule(rowModuleRaw) : currentModule;
    if (!moduleName) {
      noteSkip('no module (no Module cell and no enclosing Level-2 header)');
      continue;
    }
    if (!declaredModules.includes(moduleName)) declaredModules.push(moduleName);

    const result = readRow(row, cols, moduleName);
    if (!result.part) {
      noteSkip(result.skipReason);
      continue;
    }

    parts.push(result.part);
    if (result.rowType) rowTypes[result.rowType] = (rowTypes[result.rowType] ?? 0) + 1;
    if (result.fractionalQuantity) fractionalQuantityRows += 1;
    if (result.geometryFromDiameter) geometryFromDiameterRows += 1;
    if (result.weightFromUnitFallback) weightFromUnitFallbackRows += 1;
    if (result.rateDiverged) rateDivergedRows += 1;
    if (result.weightDiverged) weightDivergedRows += 1;
    if (result.part.unitCost === null) uncostedRows += 1;
    if (result.part.weightG === null) unweighedRows += 1;
    if (result.sourceExtendedCost !== null) sourceExtendedCostTotal += result.sourceExtendedCost;
    if (result.sourceExtendedWeightG !== null) {
      sourceExtendedWeightGTotal += result.sourceExtendedWeightG;
    }
  }

  // Part.productCategory mirrors the product's own category. The sheet's
  // "Product Category" column is a commodity and went to Part.commodity — see
  // awkwardness 4.
  for (const part of parts) part.productCategory = product.category;

  // ---- optional demo cap ------------------------------------------------
  let kept = parts;
  let droppedByCap = 0;
  if (maxParts !== null && parts.length > maxParts) {
    const byCost = [...parts].sort(
      (a, b) => (b.unitCost ?? 0) * b.quantity - (a.unitCost ?? 0) * a.quantity,
    );
    kept = byCost.slice(0, maxParts);
    droppedByCap = parts.length - kept.length;
  }

  const byModule = {};
  const byCommodity = {};
  const byGeometryType = {};
  for (const part of kept) {
    byModule[part.moduleName] = (byModule[part.moduleName] ?? 0) + 1;
    byCommodity[part.commodity ?? 'Unassigned'] =
      (byCommodity[part.commodity ?? 'Unassigned'] ?? 0) + 1;
    byGeometryType[part.geometryType] = (byGeometryType[part.geometryType] ?? 0) + 1;
  }

  // A module the outline declares but that carries no parts — Goodman's
  // "Electric Heater Assm", which the file itself subtotals at $0.00. Reported,
  // and NOT created: an empty sub-assembly would show up in every comparison as
  // a module this product has, which is the opposite of what the file says.
  const emptyModules = declaredModules.filter((m) => !byModule[m]);

  // Is this a product sheet at all? Assessed from what the parse actually found,
  // so it can't disagree with the numbers shown next to it in the panel.
  const { reasons: templateReasons, isLikelyTemplate } = assessTemplateLikeness({
    sheetName,
    hasProductIdentity,
    partLines: kept.length,
    moduleNames: Object.keys(byModule),
    brand: product.brand,
    name: product.name,
  });

  // ---- reconciliation against the file's own arithmetic ------------------
  // Computed from the ROUNDED values that will actually be stored, and using the
  // same unitCost x quantity that benchmarkService uses, so this answers the
  // question a stakeholder will really ask: will the app's module totals match
  // the spreadsheet I sent you? Anything else — comparing pre-rounding floats,
  // or comparing the parser's sum of the source column against itself — would
  // pass while the app still showed different numbers.
  const parsedSubtotals = {};
  for (const part of kept) {
    const bucket = (parsedSubtotals[part.moduleName] ??= { cost: 0, weightG: 0 });
    if (part.unitCost !== null) bucket.cost += part.unitCost * part.quantity;
    if (part.weightG !== null) bucket.weightG += part.weightG * part.quantity;
  }
  const reconciliation = [];
  for (const moduleName of Object.keys(statedSubtotals)) {
    const stated = statedSubtotals[moduleName];
    const got = parsedSubtotals[moduleName] ?? { cost: 0, weightG: 0 };
    reconciliation.push({
      module: moduleName,
      statedCost: stated.cost,
      parsedCost: round(got.cost, 2),
      costDelta: round(got.cost - (stated.cost ?? 0), 2),
      statedWeightG: stated.weightG,
      parsedWeightG: round(got.weightG, 1),
      weightDeltaG: round(got.weightG - (stated.weightG ?? 0), 1),
    });
  }
  for (const entry of reconciliation) {
    const p = parsedSubtotals[entry.module];
    if (p) {
      p.cost = round(p.cost, 2);
      p.weightG = round(p.weightG, 1);
    }
  }

  return {
    product,
    parts: kept,
    summary: {
      format: 'mapped',
      sheet: sheetName,
      headerRow: headerRowIndex + 1,
      inferred,
      // Excluded from the import by DEFAULT when true, with `templateReasons`
      // shown. Still parsed and still offered — see the note above
      // assessTemplateLikeness for why this unticks rather than drops.
      isLikelyTemplate,
      templateReasons,
      partLines: kept.length,
      partUnits: kept.reduce((s, p) => s + p.quantity, 0),
      byModule,
      byCommodity,
      byGeometryType,
      rowTypes,
      declaredModules,
      emptyModules,
      modulesCanonicalised,
      statedSubtotals,
      statedGrandTotal,
      parsedSubtotals,
      reconciliation,
      // Worst per-module gap, so the panel can say "reconciles" or "differs" in
      // one number instead of making the reader scan a table.
      worstCostDelta: round(
        reconciliation.reduce((w, r) => Math.max(w, Math.abs(r.costDelta ?? 0)), 0),
        2,
      ),
      worstWeightDeltaG: round(
        reconciliation.reduce((w, r) => Math.max(w, Math.abs(r.weightDeltaG ?? 0)), 0),
        1,
      ),
      skipped,
      skippedTotal: Object.values(skipped).reduce((s, n) => s + n, 0),
      droppedByCap,
      uncostedRows,
      unweighedRows,
      fractionalQuantityRows,
      geometryFromDiameterRows,
      weightFromUnitFallbackRows,
      rateDivergedRows,
      weightDivergedRows,
      // The file's own extended columns, summed before this parser derives
      // anything, so a verification pass can compare the app's rollup against
      // the spreadsheet rather than against another copy of its own arithmetic.
      sourceExtendedCostTotal: round(sourceExtendedCostTotal, 2),
      sourceExtendedWeightGTotal: round(sourceExtendedWeightGTotal, 1),
      specLine,
      titleLine,
      specSegments,
    },
  };
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

/**
 * Grid for one sheet. Kept here rather than shared with the CEDARS reader
 * because that one also detects a units row, which this format doesn't have.
 */
function sheetGrid(XLSX, workbook, sheetName) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });
}

/**
 * Does this workbook contain at least one Mapped BOM sheet?
 *
 * Detection is by HEADER CONTENT, not by sheet name. The supplied workbook names
 * its sheets "Main BOM Goodman" … "Main Bom Bosch" — already inconsistent in
 * case — and someone will rename one. A sheet carrying "Sl. No." plus
 * "Sub Assy / Part / Consumable" plus "Module" is this format whatever it's called.
 */
export function isMappedWorkbook(XLSX, workbook) {
  return (workbook?.SheetNames ?? []).some(
    (name) => findHeaderRow(sheetGrid(XLSX, workbook, name)) !== null,
  );
}

/**
 * Parse a whole Mapped BOM workbook into ONE PRODUCT PER SHEET.
 *
 * @param {typeof import('xlsx')} XLSX  injected so this module stays free of the
 *   xlsx dependency and can be unit-tested on plain grids via parseMappedSheet
 * @param {import('xlsx').WorkBook} workbook
 * @param {{fileName?: string, maxParts?: number|null}} [options]
 * @returns {{format: 'mapped', products: Array<{product, parts, summary}>, summary: object}}
 */
export function parseMappedWorkbook(XLSX, workbook, options = {}) {
  const { fileName = '', maxParts = null } = options;

  const products = [];
  const unmappedSheets = [];

  for (const sheetName of workbook.SheetNames) {
    const parsed = parseMappedSheet(sheetGrid(XLSX, workbook, sheetName), sheetName, { maxParts });
    if (parsed) products.push(parsed);
    else unmappedSheets.push(sheetName);
  }

  if (products.length === 0) {
    throw new Error(
      `No Mapped BOM sheets found. A sheet needs at least ${SIGNATURE_MINIMUM} of these headers: ${SIGNATURE_HEADERS.join(
        ', ',
      )}. Sheets seen: ${workbook.SheetNames.join(', ') || '(none)'}`,
    );
  }

  // Two sheets for the same brand+model would collide on the product's natural
  // key at write time. Flagged here so it's visible before the first POST rather
  // than as a 409 halfway through committing four products.
  const seen = new Map();
  const duplicateProducts = [];
  for (const p of products) {
    const k = `${p.product.brand} ${p.product.name}`.toLowerCase();
    if (seen.has(k)) duplicateProducts.push({ sheet: p.summary.sheet, clashesWith: seen.get(k) });
    else seen.set(k, p.summary.sheet);
  }

  return {
    format: 'mapped',
    products,
    summary: {
      format: 'mapped',
      fileName,
      sheetsSeen: workbook.SheetNames.length,
      productsFound: products.length,
      // Split out so the panel can say "3 product sheets, 1 template" rather than
      // claiming four products and quietly unticking one.
      templateSheets: products.filter((p) => p.summary.isLikelyTemplate).length,
      productSheets: products.filter((p) => !p.summary.isLikelyTemplate).length,
      unmappedSheets,
      duplicateProducts,
      partLines: products.reduce((s, p) => s + p.summary.partLines, 0),
      partUnits: products.reduce((s, p) => s + p.summary.partUnits, 0),
      sourceExtendedCostTotal: round(
        products.reduce((s, p) => s + p.summary.sourceExtendedCostTotal, 0),
        2,
      ),
    },
  };
}

export const MAPPED_INTERNALS = Object.freeze({
  SIGNATURE_HEADERS,
  SIGNATURE_MINIMUM,
  CANONICAL_MODULES,
  canonicaliseModule,
  assessTemplateLikeness,
  TEMPLATE_NAME_PATTERN,
  editDistance,
  stripDecoration,
  cleanName,
  brandFromSheetName,
  findHeaderRow,
});
