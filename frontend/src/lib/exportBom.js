// ---------------------------------------------------------------------------
// src/lib/exportBom.js — client-side .xlsx export of a product's BOM.
//
// Pure builder (buildBomWorkbook) + one I/O wrapper (exportBomToExcel), the
// same split benchmarkService.js uses server-side: the builder takes plain
// data and returns a workbook with no knowledge of where the data came from
// or that a download is about to happen. The download call is the only line
// that touches the browser, which is what makes the builder trivial to test.
//
// Column set mirrors the real teardown BOM template (Level, Make/Buy, Part
// No, Part Description, Module, Product Category, UOM, processes, material,
// finish, every geometry-type dimension, weight, cost, and the benchmarking
// fields) rather than the MVP's original ad-hoc column list.
//
// WHY NOTHING HERE IS RECOMPUTED:
// Unit cost, extended cost, total weight and every total below are read
// straight off the cost-engineer / design-engineer report payloads —
// benchmarkService.js is the one place a "total" is defined for this app. A
// second, silently-diverging implementation of the same arithmetic here is
// exactly the class of bug the two-fetch pattern elsewhere in this codebase
// exists to avoid (see ProductDetailPage.jsx's header comment). Per-part
// weight (unit) and every BOM-metadata/geometry field are the exception
// worth naming: those are raw stored Part columns straight off the teardown
// response, not a computed figure — displaying a stored number isn't the
// same as deriving a new one. "Total Weight" per row is the one figure that
// looks like a raw column but isn't: it's quantity-extended, so it's pulled
// from the design-engineer report's byPart.extendedWeightG rather than
// multiplied out here, same reasoning as extended cost.
//
// Uses the xlsx (SheetJS) package installed from SheetJS's own CDN rather
// than the npm registry listing — the last version npm has (0.18.5) carries
// two unpatched high-severity advisories (prototype pollution, ReDoS) that
// SheetJS fixed in later releases but never republished to npm. See
// package.json's "xlsx" entry.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

const HEADER = [
  'Level',
  'Make/Buy',
  'Part No',
  'Part Description',
  'Module',
  'Product Category',
  'UOM',
  'Primary Process',
  'Secondary Process',
  'Material',
  'Surface Finish',
  'Length (mm)',
  'Width (mm)',
  'Height (mm)',
  'Thickness (mm)',
  'Outer Diameter (mm)',
  'Inner Diameter (mm)',
  'Turns',
  'Unfolded Length (mm)',
  'Unfolded Width (mm)',
  'Bends',
  'Punches',
  'Weight (g)',
  'Total Weight (g)',
  'Unit Cost',
  'Extended Cost',
  'Function Name',
  'Comparison Name',
  'Is Fastener',
  'Similar',
];

/** '' for null/undefined, 'Yes'/'No' for an actual boolean — matches the existing Costed-column convention. */
function yesNo(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

/**
 * Build the workbook for one product's teardown.
 *
 * @param {object} teardown        payload of api.products.teardown(id)
 * @param {object} costReportPayload    payload of api.reports.get(id, PERSONAS.COST_ENGINEER)
 * @param {object} [designReportPayload] payload of api.reports.get(id, PERSONAS.DESIGN_ENGINEER);
 *   optional — feeds the "Total Weight" column (per-part byPart.extendedWeightG)
 *   and the totals row's grand total; its absence blanks that one column
 *   rather than blocking the export.
 * @returns {import('xlsx').WorkBook}
 */
export function buildBomWorkbook(teardown, costReportPayload, designReportPayload = null) {
  const costByPartId = new Map(costReportPayload.byPart.map((row) => [row.partId, row]));
  const designByPartId = new Map((designReportPayload?.byPart ?? []).map((row) => [row.partId, row]));

  const rows = [];
  for (const sub of teardown.subAssemblies) {
    for (const part of sub.parts) {
      const costing = costByPartId.get(part.id);
      const design = designByPartId.get(part.id);
      rows.push([
        sub.name,
        part.makeOrBuy ?? '',
        part.partNo ?? '',
        part.name,
        part.moduleName ?? '',
        part.productCategory ?? '',
        part.uom ?? '',
        part.primaryProcess ?? '',
        part.secondaryProcess ?? '',
        part.material ?? '',
        part.surfaceFinish ?? '',
        part.lengthMm ?? '',
        part.widthMm ?? '',
        part.heightMm ?? '',
        part.thicknessMm ?? '',
        part.diameterOuterMm ?? '',
        part.diameterInnerMm ?? '',
        part.turns ?? '',
        part.unfoldedLengthMm ?? '',
        part.unfoldedWidthMm ?? '',
        part.bends ?? '',
        part.punches ?? '',
        part.weightG ?? '',
        design?.extendedWeightG ?? '',
        costing?.unitCost ?? '',
        costing?.extendedCost ?? '',
        part.functionName ?? '',
        part.comparisonName ?? '',
        yesNo(part.isFastener),
        yesNo(part.similarFlag),
      ]);
    }
  }

  const totalsRow = [
    '',
    '',
    '',
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    designReportPayload?.totals?.totalWeightG ?? '',
    '',
    costReportPayload.totals.totalCost,
    '',
    '',
    '',
    '',
  ];

  const info = [
    ['Product', teardown.name],
    ['Brand', teardown.brand],
    ['Category', teardown.category],
    ['Currency', costReportPayload.currency],
    ['Generated', new Date().toLocaleString()],
    [],
  ];

  const sheetData = [...info, HEADER, ...rows, totalsRow];
  const sheet = XLSX.utils.aoa_to_sheet(sheetData);

  // Column widths, roughly matching header label length — aoa_to_sheet has no
  // auto-fit, and a sheet where every column shows "####" until the reader
  // manually resizes it is a poor first impression for a one-click export.
  sheet['!cols'] = HEADER.map((label) => ({ wch: Math.max(label.length + 2, 10) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'BOM');
  return workbook;
}

/** A filesystem-safe filename from a product's brand + name. */
function filenameFor(teardown) {
  const slug = `${teardown.brand}-${teardown.name}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug}-BOM.xlsx`;
}

/**
 * Build the workbook and trigger a browser download — the one I/O line.
 * XLSX.writeFile handles the Blob + object-URL + click dance internally when
 * it detects it isn't running under Node.
 */
export function exportBomToExcel(teardown, costReportPayload, designReportPayload = null) {
  const workbook = buildBomWorkbook(teardown, costReportPayload, designReportPayload);
  XLSX.writeFile(workbook, filenameFor(teardown));
}
