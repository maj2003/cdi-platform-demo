// ---------------------------------------------------------------------------
// src/lib/importWorkbook.js — pick the right BOM parser for a file.
//
// Two formats are supported, and they are structurally different:
//
//   CEDARS export          ten commodity sheets  ->  ONE product
//   Daikin Mapped BOM      one sheet per product ->  N products
//
// This module hides that difference. Both parsers are normalised to the same
// result — `{ format, products: [{product, parts, summary}], summary }` — with a
// CEDARS file simply producing a one-element array. That's what lets
// ImportBomPanel have one review-and-commit path instead of two, and it's why the
// backend needed no change at all: the existing POST /api/products/import takes
// one product, and a four-product workbook is four calls to it.
//
// ---------------------------------------------------------------------------
// WHY DETECTION IS ASKED, NOT INFERRED FROM A FAILED PARSE
//
// The obvious implementation is "try CEDARS, and if it throws, try Mapped". It
// produces bad errors. A Mapped workbook run through the CEDARS parser fails
// with "no CostWeights sheet and no recognised commodity sheets" — a true
// statement about a file nobody claimed was a CEDARS export, and the exact
// message that made this work necessary. So each parser exposes a cheap
// predicate, this module asks both, and a file matching neither gets one error
// that names both formats and what each needs.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

import { looksLikeCedarsWorkbook, parseCedarsWorkbook } from './importCedarsBom.js';
import { isMappedWorkbook, parseMappedWorkbook } from './importMappedBom.js';

/**
 * @param {import('xlsx').WorkBook} workbook
 * @returns {'mapped'|'cedars'|'unknown'}
 */
export function detectWorkbookFormat(workbook) {
  // Mapped is tested first because its signature is the more specific of the
  // two: three exact column headers in the same row, versus CEDARS's sheet
  // NAMES. A CEDARS export has no "Sub Assy / Part / Consumable" column, so the
  // order can't cause a misread — but if a future format ever overlapped, the
  // stricter test should still win.
  if (isMappedWorkbook(XLSX, workbook)) return 'mapped';
  if (looksLikeCedarsWorkbook(workbook)) return 'cedars';
  return 'unknown';
}

/** Human-readable labels, used in the panel and in error messages. */
export const FORMAT_LABELS = Object.freeze({
  cedars: 'CEDARS export',
  mapped: 'Daikin Mapped BOM',
});

/**
 * Parse a loaded workbook of either supported format.
 *
 * @param {import('xlsx').WorkBook} workbook
 * @param {{fileName?: string, requireCostOrWeight?: boolean, maxParts?: number|null}} [options]
 * @returns {{format: string, products: Array<{product, parts, summary}>, summary: object}}
 */
export function parseBomWorkbook(workbook, options = {}) {
  const format = detectWorkbookFormat(workbook);

  if (format === 'mapped') {
    return parseMappedWorkbook(XLSX, workbook, options);
  }

  if (format === 'cedars') {
    const one = parseCedarsWorkbook(workbook, options);
    // Normalised to the multi-product shape. Nothing about the CEDARS parse
    // changes; it is wrapped, not rewritten.
    return {
      format: 'cedars',
      products: [{ product: one.product, parts: one.parts, summary: one.summary }],
      summary: {
        format: 'cedars',
        fileName: options.fileName ?? '',
        sheetsSeen: one.summary.sheetsSeen,
        productsFound: 1,
        unmappedSheets: one.summary.unmappedSheets,
        duplicateProducts: [],
        partLines: one.summary.partLines,
        partUnits: one.summary.partUnits,
        sourceExtendedCostTotal: one.summary.sourceExtendedCostTotal,
      },
    };
  }

  throw new Error(
    `This workbook isn't a format the importer recognises. It supports two:\n` +
      `• CEDARS export — needs a "CostWeights" sheet, or per-commodity sheets (Steel, Tubing, Evaporator Coil, …).\n` +
      `• Daikin Mapped BOM — needs a sheet with "Sl. No.", "Sub Assy / Part / Consumable" and "Module" column headers.\n` +
      `Sheets found: ${workbook.SheetNames.join(', ') || '(none)'}`,
  );
}

/**
 * Read a File/Blob and parse it. The one function here that does I/O.
 *
 * @param {File|Blob} file
 * @param {object} [options] forwarded to parseBomWorkbook
 */
export async function importBomFile(file, options = {}) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return parseBomWorkbook(workbook, { fileName: file.name, ...options });
}
