// ---------------------------------------------------------------------------
// scripts/verify-product-search.mjs — exercise the repository search logic.
//
//   npm run verify:search        (backend must be running on :4000)
//
// lib/productSearch.js is pure, so it can be hammered from Node in milliseconds
// against the LIVE product list — no browser, no DOM. That's the point of having
// the matching logic in its own module rather than inline in the page.
//
// Covers every field the brief requires (brand, model number, description,
// category), the multi-term AND rule, the model-match-wins rule that stops a
// cross-referencing description from polluting a model search, brand facets, and
// the no-results case.
// ---------------------------------------------------------------------------

import { brandFacets, filterProducts, matchesQuery } from '../src/lib/productSearch.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api';

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  if (!Object.is(actual, expected)) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}
function ok(condition, label, extra = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label}${extra ? `\n          ${extra}` : ''}`);
  }
}

const res = await fetch(`${API}/products`);
if (!res.ok) {
  console.log(`\nFAIL — cannot reach ${API}/products. Start the backend.`);
  process.exit(1);
}
const allLiveProducts = (await res.json()).data;

// ---------------------------------------------------------------------------
// The assertions below are written against the SEEDED FIVE and their exact model
// numbers, so the list handed to filterProducts is narrowed to those.
//
// This is not the suite ducking reality — filterProducts is a PURE FUNCTION of
// (products, filters), so testing it against a known five is testing the function,
// which is the point. What made this necessary is that a Daikin Mapped BOM import
// adds products whose brands and model numbers deliberately COLLIDE with the
// seeded ones: "AMST48CU1300" alongside "AMST48CU300", "BVA-36WN1-M15" alongside
// "BVA36WN1-M15". A query for "Goodman" then correctly returns two products, and
// an assertion naming one exact model would fail while nothing at all is wrong.
// Extras are listed rather than silently ignored.
// ---------------------------------------------------------------------------
const SEEDED = ['AMST48CU300', 'BVA36WN1-M15', 'FJ5ANXC48L', '5TEMCB02', 'FJ5ANXA18L'];
const products = allLiveProducts.filter((p) => SEEDED.includes(p.name));
const extras = allLiveProducts.filter((p) => !SEEDED.includes(p.name));

console.log(`\nREPOSITORY SEARCH — ${products.length} seeded products\n`);
if (products.length !== SEEDED.length) {
  console.log(
    `  WARNING: expected the ${SEEDED.length} seeded products, found ${products.length}. ` +
      'Run `npm run seed` in backend/.',
  );
}
if (extras.length) {
  console.log(
    `  note: ignoring ${extras.length} non-seeded product(s) — ${extras
      .map((p) => `${p.brand} ${p.name}`)
      .join(', ')}\n`,
  );
}

/** Model names matched by a query, in order. */
const names = (query, brand = null) =>
  filterProducts(products, { query, brand }).map((p) => p.name);

// ---- no filter ------------------------------------------------------------
console.log('NO FILTER');
eq(names('').length, products.length, 'an empty query matches everything');
eq(names('   ').length, products.length, 'a whitespace-only query matches everything');
ok(products.every((p) => matchesQuery(p, '')), 'matchesQuery is permissive on an empty query');

// ---- brand ----------------------------------------------------------------
console.log('\nBRAND');
eq(names('Goodman').join(), 'AMST48CU300', 'search by brand: Goodman -> 1 product');
eq(names('Carrier').length, 2, 'search by brand: Carrier -> BOTH Carrier products');
eq(names('carrier').length, 2, 'brand search is case-insensitive (lowercase)');
eq(names('CARRIER').length, 2, 'brand search is case-insensitive (uppercase)');
eq(names('  Carrier  ').length, 2, 'surrounding whitespace is ignored');
eq(names('Bosch').join(), 'BVA36WN1-M15', 'search by brand: Bosch');
eq(names('Trane').join(), '5TEMCB02', 'search by brand: Trane');

// ---- model number ---------------------------------------------------------
console.log('\nMODEL NUMBER');
eq(names('AMST48CU300').join(), 'AMST48CU300', 'exact model number -> exactly that product');
eq(names('amst48').join(), 'AMST48CU300', 'partial model number, lowercase');
eq(names('5TEMCB02').join(), '5TEMCB02', 'Trane model number');
eq(names('BVA36').join(), 'BVA36WN1-M15', 'Bosch model prefix');

// THE REGRESSION THIS RULE EXISTS FOR: the A18L's description names the C48L
// ("one tier below the FJ5ANXC48L in the same FJ5ANX family"), so a plain
// description sweep returns two products for an exact model number.
eq(
  names('FJ5ANXC48L').join(),
  'FJ5ANXC48L',
  'an exact model number is NOT polluted by a sibling description that mentions it',
);
eq(
  names('FJ5ANXA18L').join(),
  'FJ5ANXA18L',
  'the sibling model number also resolves to exactly one product',
);
// A family code legitimately matches both.
eq(names('FJ5ANX').length, 2, 'a partial family code matches both Carrier models');

// ---- category -------------------------------------------------------------
console.log('\nCATEGORY');
eq(names('Air Handling Unit').length, products.length, 'search by category matches every product');
eq(names('residential').length, products.length, 'category search is case-insensitive');
eq(names('handling').length, products.length, 'partial category term');

// ---- description / notes --------------------------------------------------
console.log('\nDESCRIPTION');
eq(names('microchannel').join(), 'BVA36WN1-M15', 'description-only term: microchannel -> Bosch');
eq(names('PSC blower').join(), 'AMST48CU300', 'description-only phrase: PSC blower -> Goodman');
eq(names('stainless').join(), '5TEMCB02', 'description-only term: stainless -> Trane');
eq(names('double-wall').join(), '5TEMCB02', 'hyphenated description term');
ok(names('electric heat').length >= 2, 'a shared description term matches several products',
  names('electric heat').join());

// ---- multi-term AND -------------------------------------------------------
console.log('\nMULTI-TERM (AND, not OR)');
eq(names('carrier 18').join(), 'FJ5ANXA18L', 'two terms narrow rather than widen');
eq(names('trane stainless').join(), '5TEMCB02', 'brand + description term');
eq(names('bosch microchannel').join(), 'BVA36WN1-M15', 'brand + description term');
eq(names('goodman stainless').length, 0, 'terms that never co-occur match nothing (AND, not OR)');

// ---- no results -----------------------------------------------------------
console.log('\nNO RESULTS');
for (const q of ['zzzzz', 'Mitsubishi', 'XYZ123', 'refrigerator']) {
  eq(names(q).length, 0, `no match for "${q}"`);
}

// ---- brand facets ---------------------------------------------------------
console.log('\nBRAND FACETS');
const facets = brandFacets(products);
eq(facets.length, 4, 'four distinct brands');
eq(facets[0].brand, 'Carrier', 'the brand with most models sorts first');
eq(facets[0].count, 2, 'Carrier has two models');
eq(
  facets.reduce((sum, f) => sum + f.count, 0),
  products.length,
  'facet counts sum to the repository size',
);
// Ties sort alphabetically after the count.
const singles = facets.slice(1).map((f) => f.brand);
eq(singles.join(), 'Bosch,Goodman,Trane', 'single-model brands sort alphabetically');

// ---- facet + query combined ----------------------------------------------
console.log('\nFACET + QUERY');
eq(names('', 'Carrier').length, 2, 'facet alone filters to that brand');
eq(names('18', 'Carrier').join(), 'FJ5ANXA18L', 'facet AND query both apply');
eq(names('microchannel', 'Carrier').length, 0, 'facet excludes a product the query would match');
eq(names('', 'Goodman').join(), 'AMST48CU300', 'facet alone: Goodman');
ok(
  filterProducts(products, { brand: 'Nonexistent' }).length === 0,
  'an unknown brand facet matches nothing',
);

// ---- ordering -------------------------------------------------------------
console.log('\nORDERING');
const all = filterProducts(products, {});
eq(
  all.map((p) => p.id).join(),
  products.map((p) => p.id).join(),
  'filtering preserves repository (id) order — the baseline convention',
);

// ---- input robustness -----------------------------------------------------
console.log('\nROBUSTNESS');
eq(filterProducts(null, { query: 'x' }).length, 0, 'a null product list returns empty, not a throw');
eq(filterProducts(undefined, {}).length, 0, 'an undefined product list returns empty');
eq(brandFacets(null).length, 0, 'brandFacets tolerates null');
ok(matchesQuery({}, 'anything') === false, 'a product with no fields matches nothing');
ok(matchesQuery({}, '') === true, 'a product with no fields still matches an empty query');

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
