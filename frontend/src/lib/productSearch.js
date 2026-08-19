// ---------------------------------------------------------------------------
// src/lib/productSearch.js — repository search, as pure functions.
//
// Kept out of the page for one reason: it's the only part of the search feature
// with real logic, and as a pure module it can be exercised exhaustively from
// Node in milliseconds instead of through a browser. See
// scripts/verify-product-search.mjs.
//
// ---------------------------------------------------------------------------
// WHAT IT SEARCHES, AND WHAT IT DOESN'T
//
// Four fields, all from the product list payload that already loads: brand,
// model (`name`), category, and description (`notes`). It deliberately does NOT
// search part names, materials or module contents — those live on the teardown
// tree, which would mean one extra request per product on a list page. If
// part-level search is ever wanted it belongs on the backend as a query, not as
// N fetches from here.
//
// MULTI-TERM IS AND, NOT OR. "carrier 48" matches the FJ5ANXC48L and nothing
// else; an OR would return every Carrier plus anything containing "48", which
// gets less useful as the repository grows — and growing is the whole reason
// this exists.
// ---------------------------------------------------------------------------

/** Lowercase and collapse whitespace. Nothing is stripped — see the note below. */
function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The text one product is searchable by.
 *
 * `notes` is included whole, disclaimer prefix and all. That prefix is identical
 * on every seeded product, so it can only ever match all of them or none —
 * harmless, and stripping it would mean this module needed to know about the
 * seed's wording.
 */
function haystack(product) {
  return normalise(
    [product?.brand, product?.name, product?.category, product?.notes].filter(Boolean).join(' '),
  );
}

/**
 * Does a product match a free-text query?
 *
 * An empty or whitespace-only query matches everything — "no filter" rather than
 * "no results", which is what an empty search box should mean.
 *
 * @param {object} product from GET /api/products
 * @param {string} query
 */
export function matchesQuery(product, query) {
  const terms = normalise(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const text = haystack(product);
  return terms.every((term) => text.includes(term));
}

/**
 * Filter by free text and an optional brand facet.
 *
 * `brand` is matched exactly (it comes from the facet list, which is derived
 * from the data) rather than by substring — a facet is a precise choice, and a
 * substring match there would make "Carrier" also select a hypothetical
 * "Carrier Commercial".
 *
 * ---------------------------------------------------------------------------
 * MODEL MATCHES WIN OUTRIGHT, and this is not a nicety — without it, model
 * search is broken on the real data.
 *
 * The FJ5ANXA18L's own description says it sits "one tier below the FJ5ANXC48L
 * in the same FJ5ANX family". So a plain description search for "FJ5ANXC48L"
 * returns TWO products: the unit itself, and the sibling that merely mentions
 * it. Typing a full model number is an unambiguous request for that unit, so if
 * the query appears in any product's model, only those products are returned and
 * the description sweep is skipped entirely.
 *
 * A partial family code still behaves as you'd want: "FJ5ANX" is in both Carrier
 * models, so both come back.
 * ---------------------------------------------------------------------------
 *
 * @param {Array<object>} products
 * @param {{query?: string, brand?: string|null}} filters
 * @returns {Array<object>} in the order given — id order, which is seed order
 */
export function filterProducts(products, { query = '', brand = null } = {}) {
  const byBrand = (products ?? []).filter((product) => !brand || product.brand === brand);

  const term = normalise(query);
  if (term) {
    const modelHits = byBrand.filter((product) => normalise(product.name).includes(term));
    if (modelHits.length) return modelHits;
  }

  return byBrand.filter((product) => matchesQuery(product, query));
}

/**
 * The brand facets to offer, with a count each.
 *
 * Derived from the data rather than configured, so a newly imported brand shows
 * up without a code change. Sorted by descending count then name so the biggest
 * groups lead — which is what makes a facet list useful at a hundred products.
 *
 * @returns {Array<{brand: string, count: number}>}
 */
export function brandFacets(products) {
  const counts = new Map();
  for (const product of products ?? []) {
    counts.set(product.brand, (counts.get(product.brand) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}
