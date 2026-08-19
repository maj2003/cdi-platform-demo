// ---------------------------------------------------------------------------
// src/lib/bomCells.js — spreadsheet cell coercion, shared by every BOM parser.
//
// Extracted from importCedarsBom.js when a SECOND workbook format arrived
// (importMappedBom.js). These five functions decide what "empty" means, and
// two parsers each carrying their own copy is exactly how one of them ends up
// treating "NA" as the string "NA" six months from now. There is one definition
// of blank-ness in this app and it lives here.
//
// Nothing in this file knows about any particular format — no column names, no
// sheet names, no units. Format-specific rules stay in the parser that owns
// them.
// ---------------------------------------------------------------------------

/** Exact definitions, not the rounded 453.592 — the extra digits are free. */
export const LBS_TO_GRAMS = 453.59237;
export const INCHES_TO_MM = 25.4;

/**
 * Normalise a header for matching: lowercase, drop everything but a-z0-9 and `*`.
 *
 * The asterisk survives on purpose. CEDARS exports carry several columns twice,
 * once starred ("Total Cost" and "Total Cost*"), and only the unstarred one is
 * documented — normalising the star away would let a lookup for "Total Cost"
 * silently return the column whose meaning nobody knows.
 */
export function key(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9*]/g, '');
}

/** The blank-ish sentinels these files use interchangeably. */
const NULLISH = /^(na|n\/a|nan|null|none|-|–|—|\.)$/i;

/**
 * A cell as a finite number, or null.
 *
 * Handles scientific notation (`Number` parses "3.1225739E-2" natively),
 * currency symbols, thousands separators — which matters more than it looks,
 * because a value like "3,633.3" reaches here as a STRING from any CSV round
 * trip and would otherwise parse as NaN — and accounting negatives written
 * as "(1.23)".
 */
export function num(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;

  const s = String(raw).trim();
  if (!s || NULLISH.test(s)) return null;

  const cleaned = s
    .replace(/[$,\s]/g, '')
    .replace(/%$/, '')
    .replace(/^\((.*)\)$/, '-$1');

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Like num(), but 0 collapses to null.
 *
 * In both formats blank, NA and 0 all mean "no value", and for a measurement
 * they have to: a 0 mm length or a $0.00 cost is absence recorded as a number.
 * The Mapped BOM workbook is explicit about it — rows carrying $0.00 say
 * "Cost not populated in source" in their own Remarks column. Storing that as 0
 * would drag every average and every "costed coverage" figure downward with
 * fabricated data. Quantity is the one field that does NOT use this.
 */
export function measure(raw) {
  const n = num(raw);
  return n === 0 ? null : n;
}

/** A cell as trimmed text, or null. */
export function text(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || NULLISH.test(s)) return null;
  return s;
}

/** Round to `places` without dragging float noise into the database. */
export function round(value, places = 4) {
  if (value === null || value === undefined) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
