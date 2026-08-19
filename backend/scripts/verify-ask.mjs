// ---------------------------------------------------------------------------
// scripts/verify-ask.mjs — check the Ask-the-CIE prompt layer.
//
//   npm run verify:ask        (from backend/)
//
// Calls askService directly (live Prisma, live benchmarkService) and asserts:
//   * every one of the 8 example questions is understood and answered
//   * every REQUIRED question type from the brief works, including the phrasing
//     variants a user would actually type
//   * the figures in the answers match the same values verify-seed and
//     verify-bob already pin down — so the prompt layer can't quietly disagree
//     with the pages it summarises
//   * ambiguity is surfaced, not guessed (Carrier has two models)
//   * unparseable questions REFUSE rather than returning a nearest answer.
//     That's the property most worth protecting: a confidently wrong answer
//     about competitor cost is far worse than "I don't handle that".
// ---------------------------------------------------------------------------

import { disconnect } from '../src/data/index.js';
import { ask, parse, EXAMPLE_QUESTIONS } from '../src/services/askService.js';
import { products } from '../src/data/index.js';

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
/** Every answer must satisfy this, whatever the intent. */
function assertWellFormed(a, label) {
  ok(typeof a.headline === 'string' && a.headline.length > 10, `${label}: has a real headline`);
  ok(Array.isArray(a.stats), `${label}: stats is an array`);
  ok(Array.isArray(a.narrative), `${label}: narrative is an array`);
  ok(Array.isArray(a.notes), `${label}: notes is an array`);
  ok(Array.isArray(a.sources), `${label}: sources is an array`);
  ok(
    a.table === null || (Array.isArray(a.table.columns) && Array.isArray(a.table.rows)),
    `${label}: table is null or {columns, rows}`,
  );
  if (a.table) {
    const bad = a.table.rows.filter((r) => r.length !== a.table.columns.length);
    eq(bad.length, 0, `${label}: every table row matches the column count`);
  }
  // Nothing should ever render "undefined" or "NaN" into a stakeholder answer.
  const blob = JSON.stringify(a);
  ok(!/undefined/.test(blob), `${label}: no "undefined" leaked into the answer`);
  ok(!/NaN/.test(blob), `${label}: no NaN leaked into the answer`);
}

// ===========================================================================
console.log('\nASK THE COMPETITIVE INTELLIGENCE ENGINE — live data\n');

const all = await products.listProducts();
// askService ranks over the first MAX_PRODUCTS (5) products, so expectations about
// 'every product' mean that window — not however many rows the database holds.
const RANKED = Math.min(all.length, 5);
ok(all.length >= 2, `repository has enough products to answer questions (${all.length})`);

// ---- the 8 example questions must all work -------------------------------
console.log('EXAMPLE QUESTIONS (all 8 must succeed)');
eq(EXAMPLE_QUESTIONS.length, 8, 'eight examples are offered');
for (const q of EXAMPLE_QUESTIONS) {
  const a = await ask(q);
  ok(a.understood === true, `understood: "${q}"`, `intent=${a.intent}`);
  assertWellFormed(a, `"${q}"`);
  console.log(`    ${a.intent.padEnd(18)} ${a.headline}`);
}

// ---- required type 1: product superlatives -------------------------------
console.log('\nPRODUCT QUESTIONS');
const SUPERLATIVE_CASES = [
  ['Which product is cheapest?', 'Goodman', '$250.18'],
  ['Which product is the lightest?', 'Bosch', '33.97 kg'],
  ['Which product has the most parts?', 'Trane', '25'],
  ['Which product has the fewest parts?', 'Goodman', '16'],
  ['Which product has the highest cost?', 'Trane', '$499.21'],
  ['Which product is the heaviest?', 'Trane', '64.64 kg'],
  ['Which product has the best cost per kg?', 'Goodman', '$5.09'],
];
for (const [q, brand, figure] of SUPERLATIVE_CASES) {
  const a = await ask(q);
  eq(a.intent, 'superlative', `"${q}" routes to superlative`);
  ok(a.headline.includes(brand), `"${q}" names ${brand}`, a.headline);
  ok(a.headline.includes(figure), `"${q}" quotes ${figure}`, a.headline);
  // The full ranking should be present so the answer is auditable.
  ok(a.table?.rows.length === RANKED, `"${q}" lists every product in its ranking`);
  assertWellFormed(a, `"${q}"`);
}

// Superlatives must agree with the figures verify-seed pins down.
const cheapest = await ask('Which product is cheapest?');
ok(
  cheapest.headline.includes('AMST48CU300'),
  'cheapest answer names the model, not just the brand',
  cheapest.headline,
);

// ---- required type 2: comparisons ----------------------------------------
console.log('\nCOMPARISON QUESTIONS');
// ---------------------------------------------------------------------------
// These checks assert BEHAVIOUR, not a row count, and that is deliberate.
//
// A brand token resolves to every model that brand has, by design — askService
// widens rather than guessing which one you meant, and says so in its notes. That
// made "exactly 2 products" a safe assertion only while every seeded brand had
// exactly one model. Importing a Daikin Mapped BOM workbook breaks that: the
// repository now legitimately holds Goodman AMST48CU300 AND AMST48CU1300, Trane
// 5TEMCB02 AND 5TEMCB02AV21DA. So the property worth pinning down is "both named
// brands are represented, and any ambiguity is reported" — which is true whatever
// else has been imported.
// ---------------------------------------------------------------------------

/** Every brand named in the question is represented, and ambiguity is disclosed. */
function assertNamedBrandsPresent(answer, brands, label) {
  for (const brand of brands) {
    const matches = answer.table.rows.filter((r) => r[0].includes(brand));
    ok(matches.length >= 1, `${label}: ${brand} is in the comparison`);
    if (matches.length > 1) {
      ok(
        answer.notes.some((n) => new RegExp(`${brand} matched \\d+ models`).test(n)),
        `${label}: ${brand} matched ${matches.length} models and the notes say so`,
        JSON.stringify(answer.notes),
      );
    }
  }
  // Nothing NOT asked for should appear — the answer must stay scoped to the
  // named brands rather than quietly falling back to the whole repository.
  const unexpected = answer.table.rows.filter((r) => !brands.some((b) => r[0].includes(b)));
  eq(unexpected.length, 0, `${label}: no unrequested products crept in`);
}

const cmp1 = await ask('Compare Goodman and Bosch');
eq(cmp1.intent, 'compare', 'two named brands route to compare');
assertNamedBrandsPresent(cmp1, ['Goodman', 'Bosch'], 'Goodman vs Bosch');
ok(cmp1.sources.some((s) => s.to.startsWith('/compare?ids=')), 'links through to the Compare page');
assertWellFormed(cmp1, 'compare two');

const cmp2 = await ask('Compare all products');
eq(cmp2.intent, 'compare', '"compare all" routes to compare');
eq(cmp2.table.rows.length, RANKED, '"compare all" includes the whole set');
assertWellFormed(cmp2, 'compare all');

// The two-Carrier case: a brand matching two models must WIDEN, not narrow.
const cmp3 = await ask('Compare Carrier and Trane');
eq(cmp3.intent, 'compare', '"Compare Carrier and Trane" routes to compare');
ok(
  cmp3.table.rows.filter((r) => r[0].includes('Carrier')).length >= 2,
  'BOTH Carrier models are included — an ambiguous brand widens rather than picking one',
  cmp3.table.rows.map((r) => r[0]).join(' | '),
);
ok(
  cmp3.notes.some((n) => /Carrier matched \d+ models/.test(n)),
  'the Carrier ambiguity is stated in the notes, not silently resolved',
  JSON.stringify(cmp3.notes),
);
assertNamedBrandsPresent(cmp3, ['Carrier', 'Trane'], 'Carrier vs Trane');
assertWellFormed(cmp3, 'compare ambiguous brand');

const cmp4 = await ask('Goodman vs Trane');
eq(cmp4.intent, 'compare', '"X vs Y" also routes to compare');
assertNamedBrandsPresent(cmp4, ['Goodman', 'Trane'], '"vs" phrasing');

// ---- required type 3: best-of-best --------------------------------------
console.log('\nBEST-OF-BEST QUESTIONS');
const bob1 = await ask('Show the Best-of-Best target');
eq(bob1.intent, 'best_of_best', '"Best-of-Best target" routes to best_of_best');
ok(bob1.headline.includes('$257.19'), 'quotes the live composite cost', bob1.headline);
ok(bob1.headline.includes('34.64 kg'), 'quotes the live composite weight', bob1.headline);
ok(bob1.table.rows.length === 8, 'lists all 8 modules with their source product');
ok(
  bob1.notes.some((n) => /not a purchasable unit/.test(n)),
  'the composite ships with its caveats',
  JSON.stringify(bob1.notes),
);
ok(
  bob1.notes.some((n) => /like-for-like/.test(n)),
  'the like-for-like framing is stated',
);
assertWellFormed(bob1, 'best-of-best');

const MODULE_CASES = [
  ['Which product has the best cabinet?', 'Cabinet Assm', 'FJ5ANXA18L', '$28.68'],
  ['Which product has the best blower?', 'Blower Assm', 'AMST48CU300', '$76.65'],
  ['Which product has the best blower assembly?', 'Blower Assm', 'AMST48CU300', '$76.65'],
  ['Which product has the best coil?', 'Coil Assm - Evaporator', 'FJ5ANXA18L', '$76.02'],
  ['Which product has the cheapest packaging?', 'Packaging Assm', 'FJ5ANXA18L', '$5.32'],
];
for (const [q, module, model, figure] of MODULE_CASES) {
  const a = await ask(q);
  eq(a.intent, 'module', `"${q}" routes to module`);
  ok(a.headline.includes(module), `"${q}" names the module ${module}`, a.headline);
  ok(a.headline.includes(model), `"${q}" names the winning model`, a.headline);
  ok(a.headline.includes(figure), `"${q}" quotes ${figure}`, a.headline);
  ok(
    a.notes.some((n) => /Read as lowest module cost/.test(n)),
    `"${q}" states how "best" was interpreted`,
  );
  assertWellFormed(a, `"${q}"`);
}

// A module only some products carry must say so.
const heater = await ask('Which product has the best electric heater?');
eq(heater.intent, 'module', 'heater question routes to module');
ok(
  heater.notes.some((n) => /Only 3 of 5 products carry/.test(n)),
  'partial module coverage is disclosed',
  JSON.stringify(heater.notes),
);

// "lightest <module>" must flip the reading.
const lightBlower = await ask('Which product has the lightest blower?');
eq(lightBlower.intent, 'module', 'lightest-module routes to module');
ok(
  lightBlower.notes.some((n) => /Read as lowest module weight/.test(n)),
  'weight phrasing flips the interpretation',
);

// ---- required type 4: executive summary ---------------------------------
console.log('\nEXECUTIVE SUMMARY');
const exec = await ask('Generate executive summary');
eq(exec.intent, 'executive_summary', 'routes to executive_summary');
ok(exec.narrative.length >= 3, `returns a multi-sentence narrative (${exec.narrative.length})`);
ok(exec.headline.includes('$250.18') && exec.headline.includes('$499.21'),
  'headline quotes the live cost span', exec.headline);
ok(exec.table.rows.length === RANKED, 'includes every product in its table');
ok(
  exec.narrative.some((s) => /best-of-best|best in class|best competitor/i.test(s)),
  'ties the narrative to the best-of-best target',
);
assertWellFormed(exec, 'executive summary');

// Naming one product should give that product's own executive report. Asked with
// a MODEL rather than a brand: a brand is only unambiguous while it has one model,
// and importing a Mapped BOM workbook gives Trane two. The exact-model-match-wins
// rule is what makes this resolve to one product.
const execOne = await ask('Executive summary for 5TEMCB02');
eq(execOne.intent, 'executive_summary', 'product-scoped executive routes the same way');
ok(execOne.headline.includes('5TEMCB02'), 'scoped to the named product', execOne.headline);
ok(
  !/Across \d+ teardowns/.test(execOne.headline),
  'and is genuinely scoped — not the whole-repository summary wearing a product name',
  execOne.headline,
);
ok(
  execOne.sources.some((s) => s.to.includes('/reports')),
  'links to that product\'s full persona reports',
);

// ---- cost difference ----------------------------------------------------
console.log('\nDIFFERENCE QUESTIONS');
const diff1 = await ask('What is the cost difference between Trane and Goodman?');
eq(diff1.intent, 'difference', 'routes to difference');
// 499.21 - 250.18 = 249.03
ok(diff1.headline.includes('249.03'), 'quotes the exact difference', diff1.headline);
ok(diff1.stats.length === 3, 'shows both sides and the delta');
assertWellFormed(diff1, 'difference');

const diff2 = await ask('What is the cost difference between Carrier and Goodman?');
eq(diff2.intent, 'difference', 'ambiguous-brand difference routes to difference');
eq(diff2.table.rows.length, 2, 'both Carrier pairings are shown rather than one being picked');
ok(
  diff2.notes.some((n) => /Carrier matched 2 models/.test(n)),
  'the ambiguity is disclosed',
  JSON.stringify(diff2.notes),
);

const diff3 = await ask('How much heavier is Trane than Bosch?');
eq(diff3.intent, 'difference', 'weight phrasing routes to difference');
// 64.636 - 33.97 = 30.666 -> 30.67 kg
ok(diff3.headline.includes('30.67'), 'uses the weight metric, not cost', diff3.headline);

// ---- REFUSAL: the property most worth protecting ------------------------
console.log('\nREFUSAL BEHAVIOUR');
const NONSENSE = [
  'What is the airspeed velocity of an unladen swallow?',
  'Book me a flight to Tokyo',
  'asdfghjkl',
  'Who is the CEO of Daikin?',
  'What will steel prices be next year?',
];
for (const q of NONSENSE) {
  const a = await ask(q);
  eq(a.understood, false, `refuses: "${q}"`);
  eq(a.intent, 'unknown', `"${q}" is marked unknown`);
  ok(a.suggestions.length === 8, `"${q}" offers the example questions instead`);
  ok(a.stats.length === 0 && a.table === null, `"${q}" invents no figures`);
  // The refusal must not accidentally name a product and read like an answer.
  ok(
    !/Goodman|Bosch|Carrier|Trane/.test(a.headline),
    `"${q}" doesn't name a product in its refusal`,
    a.headline,
  );
}

// A question mentioning a real product but no answerable metric should profile
// it rather than refuse — but must not fabricate a superlative.
const profile = await ask('Tell me about Bosch');
eq(profile.intent, 'product_profile', 'a bare product mention returns a profile');
ok(profile.headline.includes('BVA36WN1-M15'), 'profile names the model', profile.headline);
ok(profile.stats.length === 4, 'profile shows the four headline figures');

// ---- input validation ---------------------------------------------------
console.log('\nVALIDATION');
for (const bad of ['', '   ', null, undefined]) {
  let threw = null;
  try {
    await ask(bad);
  } catch (err) {
    threw = err;
  }
  eq(threw?.status, 400, `empty question (${JSON.stringify(bad)}) is rejected with 400`);
}
let threw = null;
try {
  await ask('x'.repeat(501));
} catch (err) {
  threw = err;
}
eq(threw?.status, 400, 'over-long question is rejected with 400');

// ---- parse() is pure and stable -----------------------------------------
console.log('\nDETERMINISM');
const a1 = await ask('Which product is the cheapest?');
const a2 = await ask('Which product is the cheapest?');
eq(a1.headline, a2.headline, 'the same question returns the same answer');
eq(
  JSON.stringify(parse('Which product is the cheapest?', all).intent),
  '"superlative"',
  'parse() is callable on its own and returns the intent',
);
// Casing and punctuation must not matter.
for (const variant of ['WHICH PRODUCT IS THE CHEAPEST', 'which product is cheapest', 'cheapest?']) {
  const a = await ask(variant);
  eq(a.intent, 'superlative', `casing/punctuation variant handled: "${variant}"`);
  ok(a.headline.includes('AMST48CU300'), `"${variant}" gives the same winner`);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
await disconnect();
if (failures > 0) process.exitCode = 1;
