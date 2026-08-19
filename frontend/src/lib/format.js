// ---------------------------------------------------------------------------
// src/lib/format.js — display formatting.
//
// Centralised so a number looks identical everywhere it appears. A card showing
// "$84.55" beside a table showing "84.6" is the kind of inconsistency people
// read as a bug in the data rather than in the formatting.
// ---------------------------------------------------------------------------

/**
 * Money, with the currency the backend actually reported.
 *
 * Intl.NumberFormat rather than `'$' + n.toFixed(2)`: it handles the thousands
 * separator, and it means switching to EUR later is a data change, not a code
 * change. Returns an em-dash for null so "not computed yet" and "zero" stay
 * visually distinct — they mean very different things on a cost card.
 */
export function formatCurrency(value, currency = 'USD') {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Weight in kilograms, two decimals. */
export function formatWeight(kg) {
  if (kg === null || kg === undefined) return '—';
  return `${kg.toFixed(2)} kg`;
}

/**
 * Build a product labeller that adds the model number only when it's needed.
 *
 * WHY THIS EXISTS: the benchmark set can hold two models from one brand —
 * Carrier ships both FJ5ANXA18L and FJ5ANXC48L — and every comparison view used
 * to label products by brand alone. That silently produced two rows, two chart
 * series and two legend entries all reading "Carrier", with no way to tell which
 * unit was which. Labelling everything "Brand Model" unconditionally would fix
 * it but make every chart legend longer for the four brands that are unique, so
 * the model is appended only where the brand is ambiguous.
 *
 * Accepts either shape the API returns: `{brand, name}` from /products, or
 * `{brand, productName}` from the report payloads.
 *
 * @param {Array<{brand: string, name?: string, productName?: string}>} products
 * @returns {(entry: object|null) => string}
 */
export function makeProductLabeller(products) {
  const counts = {};
  for (const p of products ?? []) counts[p.brand] = (counts[p.brand] ?? 0) + 1;

  return (entry) => {
    if (!entry) return '—';
    const model = entry.productName ?? entry.name ?? '';
    return counts[entry.brand] > 1 && model ? `${entry.brand} ${model}` : entry.brand;
  };
}

/** Plain integer with thousands separators. */
export function formatCount(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

/** Grams, one decimal — matches the precision the backend stores. */
export function formatGrams(g) {
  if (g === null || g === undefined) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(g)} g`;
}

/** Millimetres, one decimal, no unit suffix (used inside "L × W × H mm"). */
export function formatMm(mm) {
  if (mm === null || mm === undefined) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(mm);
}

/**
 * A capture timestamp, short form.
 *
 * The backend sends ISO 8601 in UTC; `new Date()` renders it in the viewer's
 * local zone, which is what you want for "when was this measured".
 */
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}