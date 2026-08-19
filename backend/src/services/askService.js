// ---------------------------------------------------------------------------
// src/services/askService.js — "Ask the Competitive Intelligence Engine".
//
// A natural-language question in, a structured answer out, built entirely from
// the live benchmark data.
//
// ---------------------------------------------------------------------------
// THIS IS NOT A STUB, AND IT IS NOT AN LLM. BOTH MATTER.
//
// aiService.js next door is a deliberate stub: canned classification behind a
// real-looking signature. This file is the opposite — every figure it returns is
// read from the database through benchmarkService, so the answers are as real as
// the Compare and Best-of-Best pages. What's deterministic is the LANGUAGE
// layer: intent is matched by rules, not inferred by a model.
//
// That tradeoff is the whole design. A rule-based router can only answer the
// question shapes it knows, but it can never hallucinate a number, never invent
// a product, and returns the same answer for the same question every time.
// When a real model lands, it should replace `parse()` — the routing and the
// answer builders below stay exactly as they are, because they're just queries
// over benchmarkService.
//
// ---------------------------------------------------------------------------
// THE RULE THAT MATTERS MOST: REFUSE, DON'T GUESS
//
// If `parse()` can't identify an intent, this returns `understood: false` with
// suggestions. It never falls through to a "closest" answer. A confidently
// wrong answer to a question about competitor cost is far worse than "I don't
// handle that yet" — the user acts on the first and re-phrases the second.
//
// Same principle for entities: a brand that matches two models (Carrier ships
// both FJ5ANXA18L and FJ5ANXC48L here) is NOT silently narrowed to one. Compare
// questions widen to include both; two-sided questions answer for every pairing
// and say so in `notes`.
// ---------------------------------------------------------------------------

import { products } from '../data/index.js';
import { badRequest } from '../lib/http.js';
import {
  buildBestOfBest,
  buildExecutiveView,
  compareProducts,
} from './benchmarkService.js';

/**
 * A short pause before answering.
 *
 * Purely UX pacing: the query itself is a few milliseconds, and an answer that
 * appears in the same frame as the click reads as a pre-canned lookup rather
 * than a considered response. Same reasoning as aiService's simulated inference
 * delay. It buys nothing functionally — delete this line and the two `await
 * pause()` calls if the latency ever matters more than the feel.
 */
const THINKING_MS = 320;
const pause = (ms = THINKING_MS) => new Promise((resolve) => setTimeout(resolve, ms));

/** benchmarkService caps comparison and best-of-best at five products. */
const MAX_PRODUCTS = 5;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The superlatives this can answer, and which figure each reads.
 *
 * `dir: 'min'` means lower wins. Every one of these is answered by ORDERING the
 * per-product figures buildBestOfBest already returned — never by recomputing a
 * total, which is benchmarkService's job alone.
 */
const SUPERLATIVES = [
  { patterns: ['cheapest', 'lowest cost', 'lowest total cost', 'least expensive', 'lowest price'], key: 'totalCost', dir: 'min', noun: 'cheapest', unit: 'currency' },
  { patterns: ['most expensive', 'highest cost', 'highest total cost', 'dearest', 'priciest'], key: 'totalCost', dir: 'max', noun: 'most expensive', unit: 'currency' },
  { patterns: ['lightest', 'lowest weight', 'least heavy'], key: 'totalWeightKg', dir: 'min', noun: 'lightest', unit: 'kg' },
  { patterns: ['heaviest', 'highest weight', 'most heavy'], key: 'totalWeightKg', dir: 'max', noun: 'heaviest', unit: 'kg' },
  { patterns: ['most parts', 'most part lines', 'highest part count', 'largest part count'], key: 'partLines', dir: 'max', noun: 'most part lines', unit: 'count' },
  { patterns: ['fewest parts', 'least parts', 'fewest part lines', 'lowest part count', 'simplest'], key: 'partLines', dir: 'min', noun: 'fewest part lines', unit: 'count' },
  { patterns: ['best cost per kg', 'lowest cost per kg', 'best cost/kg', 'lowest cost/kg'], key: 'costPerKg', dir: 'min', noun: 'lowest cost per kg', unit: 'currencyPerKg' },
  { patterns: ['highest cost per kg', 'worst cost per kg', 'highest cost/kg'], key: 'costPerKg', dir: 'max', noun: 'highest cost per kg', unit: 'currencyPerKg' },
];

/**
 * Module aliases → the sub-assembly name the seed actually uses.
 *
 * Users say "blower", the data says "Blower Assm". Longest alias is matched
 * first so "evaporator coil" doesn't get claimed by a bare "coil" entry.
 */
const MODULE_ALIASES = [
  { aliases: ['packaging'], module: 'Packaging Assm' },
  { aliases: ['cabinet', 'enclosure', 'casing'], module: 'Cabinet Assm' },
  { aliases: ['evaporator coil', 'evaporator', 'coil'], module: 'Coil Assm - Evaporator' },
  { aliases: ['blower', 'fan', 'motor'], module: 'Blower Assm' },
  { aliases: ['electrical', 'controls', 'control board', 'wiring'], module: 'Electrical Assm' },
  { aliases: ['condensate', 'drain', 'drain pan'], module: 'Condensate Mgmt Assm' },
  { aliases: ['air filtration', 'filtration', 'filter'], module: 'Air Filtration Assm' },
  { aliases: ['electric heater', 'heater', 'heat', 'heating'], module: 'Electric Heater Assm' },
];

/** Shown under the prompt box, and returned as suggestions when nothing matches. */
export const EXAMPLE_QUESTIONS = Object.freeze([
  'Which product is the cheapest?',
  'Which product is the lightest?',
  'Compare Goodman and Bosch',
  'Which product has the best blower assembly?',
  'Show me the Best-of-Best summary',
  'Generate an executive summary',
  'Which product has the highest cost?',
  'What is the cost difference between Carrier and Goodman?',
]);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Lowercase, collapse whitespace, drop punctuation that never carries meaning here. */
function normalise(question) {
  return String(question ?? '')
    .toLowerCase()
    .replace(/[?!.,;:'"()]/g, ' ')
    .replace(/[-–—/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every product whose brand or model the text mentions.
 *
 * Matches model numbers first (they're unique and unambiguous), then brands.
 * A brand match can legitimately return several products — see the header note
 * on refusing to silently narrow.
 */
function resolveProducts(text, allProducts) {
  const hits = new Map();

  for (const product of allProducts) {
    const model = normalise(product.name);
    if (model && text.includes(model)) hits.set(product.id, { product, via: 'model' });
  }

  for (const product of allProducts) {
    if (hits.has(product.id)) continue;
    const brand = normalise(product.brand);
    // Word-boundary match so "trane" can't be found inside another token.
    if (brand && new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
      hits.set(product.id, { product, via: 'brand' });
    }
  }

  return [...hits.values()];
}

/** The module an alias in the text refers to, or null. Longest alias wins. */
function resolveModule(text) {
  const candidates = MODULE_ALIASES.flatMap((entry) =>
    entry.aliases.map((alias) => ({ alias, module: entry.module })),
  ).sort((a, b) => b.alias.length - a.alias.length);

  for (const candidate of candidates) {
    if (new RegExp(`\\b${candidate.alias}\\b`).test(text)) return candidate.module;
  }
  return null;
}

/**
 * Identify what's being asked.
 *
 * ORDER IS LOAD-BEARING and each step is ordered against a specific collision:
 *   - `best of best` before any other "best", or "Show me the Best-of-Best
 *     summary" would be read as a module question.
 *   - `executive summary` before the generic BOB/summary handling, so
 *     "Generate an executive summary" isn't swallowed by "summary".
 *   - `difference` before `compare`, because "What is the cost difference
 *     between Carrier and Goodman?" contains no "compare" but is still a
 *     two-entity question and needs a numeric answer, not a table.
 *   - module questions before superlatives, or "the best blower assembly" would
 *     match nothing (there is no bare "best" superlative) and fall through to
 *     unknown.
 *
 * @returns {{intent: string, ...}}
 */
export function parse(question, allProducts = []) {
  const text = normalise(question);
  if (!text) return { intent: 'unknown', reason: 'empty' };

  const named = resolveProducts(text, allProducts);
  const module = resolveModule(text);

  // 1. Best-of-Best — must require the full phrase.
  if (/\bbest of best\b|\bbestofbest\b|\bbob\b|\bbest in class\b/.test(text)) {
    return { intent: 'best_of_best', named };
  }

  // 2. Executive summary.
  if (/\bexecutive\b/.test(text) || /\bexec summary\b/.test(text)) {
    return { intent: 'executive_summary', named };
  }

  // 3. Numeric difference between two things.
  if (/\bdifference\b|\bgap\b|\bhow much (more|less|cheaper|heavier|lighter)\b/.test(text)) {
    const metric = /\bweight|heavier|lighter|\bkg\b/.test(text) ? 'totalWeightKg' : 'totalCost';
    return { intent: 'difference', named, metric };
  }

  // 4. Comparison.
  if (/\bcompare\b|\bvs\b|\bversus\b|\bagainst\b|\bside by side\b/.test(text)) {
    const all = /\ball\b|\bevery\b|\bwhole set\b|\beveryone\b/.test(text);
    return { intent: 'compare', named, all };
  }

  // 5. Module question — "best cabinet", "cheapest coil", "lightest blower".
  if (module) {
    const wantsLightest = /\blightest\b|\bweight\b/.test(text);
    return { intent: 'module', module, prefer: wantsLightest ? 'weight' : 'cost' };
  }

  // 6. Whole-product superlatives.
  for (const rule of SUPERLATIVES) {
    if (rule.patterns.some((p) => text.includes(p))) return { intent: 'superlative', rule, named };
  }

  // 7. "Tell me about Trane" — a named product with no other signal.
  if (named.length > 0) return { intent: 'product_profile', named };

  return { intent: 'unknown', reason: 'no-match' };
}

// ---------------------------------------------------------------------------
// Formatting helpers — presentation only, no arithmetic
// ---------------------------------------------------------------------------

const money = (n, currency = 'USD') =>
  n === null || n === undefined ? '—' : `${currency === 'USD' ? '$' : `${currency} `}${n.toFixed(2)}`;
const kg = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(2)} kg`);
const count = (n) => (n === null || n === undefined ? '—' : String(n));

function formatValue(value, unit, currency) {
  switch (unit) {
    case 'currency':
      return money(value, currency);
    case 'kg':
      return kg(value);
    case 'currencyPerKg':
      return `${money(value, currency)}/kg`;
    default:
      return count(value);
  }
}

/** "Goodman AMST48CU300" — brand plus model, always, so two Carriers never collide. */
const label = (p) => `${p.brand} ${p.productName ?? p.name}`;

// ---------------------------------------------------------------------------
// Answer builders — one per intent
// ---------------------------------------------------------------------------

function answerSuperlative(rule, bob) {
  const ranked = [...bob.products]
    .filter((p) => typeof p[rule.key] === 'number')
    .sort((a, b) => (rule.dir === 'min' ? a[rule.key] - b[rule.key] : b[rule.key] - a[rule.key]));

  if (!ranked.length) {
    return { headline: `No product has a ${rule.noun} figure recorded yet.`, stats: [], table: null };
  }

  const winner = ranked[0];
  const runnerUp = ranked[1];

  return {
    headline: `${label(winner)} is the ${rule.noun} at ${formatValue(winner[rule.key], rule.unit, bob.currency)}.`,
    stats: [
      { label: 'Total cost', value: money(winner.totalCost, bob.currency) },
      { label: 'Total weight', value: kg(winner.totalWeightKg) },
      { label: 'Part lines', value: count(winner.partLines) },
      { label: 'Modules', value: count(winner.moduleCount) },
    ],
    narrative: runnerUp
      ? [
          `Next closest is ${label(runnerUp)} at ${formatValue(runnerUp[rule.key], rule.unit, bob.currency)}.`,
        ]
      : [],
    table: {
      columns: ['Product', rule.noun.replace(/^(the )?/, '')],
      rows: ranked.map((p) => [label(p), formatValue(p[rule.key], rule.unit, bob.currency)]),
    },
    sources: [
      { label: 'Open Best-of-Best', to: '/best-of-best' },
      { label: 'Open teardown', to: `/products/${winner.productId}` },
    ],
  };
}

function answerCompare(comparison, notes) {
  const baseline = comparison.products[0];
  const others = comparison.comparisons;

  const signed = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n}%`);

  return {
    headline: `Comparing ${comparison.products.length} products against ${label(baseline)} as the baseline.`,
    stats: [
      { label: 'Baseline cost', value: money(baseline.totalCost, baseline.currency) },
      { label: 'Baseline weight', value: kg(baseline.totalWeightKg) },
      { label: 'Baseline part lines', value: count(baseline.partLines) },
      { label: 'Products compared', value: count(comparison.products.length) },
    ],
    table: {
      columns: ['Product', 'Total cost', 'Total weight', 'Part lines', 'Cost Δ', 'Weight Δ'],
      rows: [
        [
          label(baseline),
          money(baseline.totalCost, baseline.currency),
          kg(baseline.totalWeightKg),
          count(baseline.partLines),
          'baseline',
          'baseline',
        ],
        ...others.map((c) => {
          const p = comparison.products.find((x) => x.productId === c.productId);
          return [
            label(c),
            money(p?.totalCost, baseline.currency),
            kg(p?.totalWeightKg),
            count(p?.partLines),
            signed(c.deltas.totalCost?.deltaPct),
            signed(c.deltas.totalWeightKg?.deltaPct),
          ];
        }),
      ],
    },
    narrative: others.map(
      (c) =>
        `${label(c)} costs ${signed(c.deltas.totalCost?.deltaPct)} and weighs ` +
        `${signed(c.deltas.totalWeightKg?.deltaPct)} relative to ${baseline.brand}.`,
    ),
    notes,
    sources: [
      {
        label: 'Open in Compare',
        to: `/compare?ids=${comparison.products.map((p) => p.productId).join(',')}`,
      },
    ],
  };
}

function answerDifference(metric, left, right, bob) {
  const unit = metric === 'totalCost' ? 'currency' : 'kg';
  const noun = metric === 'totalCost' ? 'cost' : 'weight';
  const find = (id) => bob.products.find((p) => p.productId === id);

  // Every pairing, because either side may have matched more than one model.
  const rows = [];
  for (const a of left) {
    for (const b of right) {
      const pa = find(a.product.id);
      const pb = find(b.product.id);
      if (!pa || !pb) continue;
      const diff = pa[metric] - pb[metric];
      rows.push({
        a: label(pa),
        b: label(pb),
        aValue: pa[metric],
        bValue: pb[metric],
        diff,
      });
    }
  }

  if (!rows.length) {
    return { headline: `I couldn't find benchmark figures for both products.`, stats: [], table: null };
  }

  const first = rows[0];
  const direction = first.diff === 0 ? 'the same as' : first.diff > 0 ? 'more than' : 'less than';
  const magnitude = formatValue(Math.abs(first.diff), unit, bob.currency);

  return {
    headline:
      rows.length === 1
        ? `${first.a} costs ${magnitude} ${direction} ${first.b}.`.replace(
            'costs',
            metric === 'totalCost' ? 'costs' : 'weighs',
          )
        : `${rows.length} pairings match that question — ${noun} differences below.`,
    stats:
      rows.length === 1
        ? [
            { label: first.a, value: formatValue(first.aValue, unit, bob.currency) },
            { label: first.b, value: formatValue(first.bValue, unit, bob.currency) },
            {
              label: `Difference`,
              value: `${first.diff > 0 ? '+' : first.diff < 0 ? '−' : ''}${magnitude}`,
            },
          ]
        : [],
    table: {
      columns: ['Product', 'Compared with', `${noun} difference`],
      rows: rows.map((r) => [
        `${r.a} (${formatValue(r.aValue, unit, bob.currency)})`,
        `${r.b} (${formatValue(r.bValue, unit, bob.currency)})`,
        `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${formatValue(Math.abs(r.diff), unit, bob.currency)}`,
      ]),
    },
    sources: [
      {
        label: 'Open in Compare',
        to: `/compare?ids=${[...new Set([...left, ...right].map((e) => e.product.id))].join(',')}`,
      },
    ],
  };
}

function answerModule(moduleName, prefer, bob) {
  const leader = bob.moduleLeaders.find((m) => m.module === moduleName);
  if (!leader) {
    return {
      headline: `No product in the set has a ${moduleName}.`,
      stats: [],
      table: null,
    };
  }

  const cheapest = leader.cheapest;
  const lightest = leader.lightest;
  const primary = prefer === 'weight' ? lightest : cheapest;

  const notes = [
    // "Best" is genuinely ambiguous for a module, so say which reading was used
    // rather than picking one silently.
    prefer === 'weight'
      ? 'Read as lowest module weight. The cheapest is also shown.'
      : 'Read as lowest module cost. The lightest is also shown.',
  ];
  if (leader.productCount < leader.productTotal) {
    notes.push(
      `Only ${leader.productCount} of ${leader.productTotal} products carry a ${moduleName}, so this compares those ${leader.productCount}.`,
    );
  }

  return {
    headline:
      prefer === 'weight'
        ? `${label(lightest)} has the lightest ${moduleName} at ${kg(lightest.weightG / 1000)}.`
        : `${label(cheapest)} has the cheapest ${moduleName} at ${money(cheapest.cost, bob.currency)}.`,
    stats: [
      { label: 'Cheapest', value: `${cheapest.brand} · ${money(cheapest.cost, bob.currency)}` },
      { label: 'Lightest', value: `${lightest.brand} · ${kg(lightest.weightG / 1000)}` },
      {
        label: 'Cost spread',
        value: leader.costSpreadPct === null ? '—' : `+${leader.costSpreadPct}%`,
      },
      { label: 'Products with it', value: `${leader.productCount} of ${leader.productTotal}` },
    ],
    table: {
      columns: ['Product', 'Module cost', 'Module weight', 'Part lines'],
      rows: [...leader.entries]
        .sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity))
        .map((e) => [label(e), money(e.cost, bob.currency), kg((e.weightG ?? 0) / 1000), count(e.partLines)]),
    },
    notes,
    sources: [
      { label: 'Open Best-of-Best', to: '/best-of-best' },
      { label: 'Open teardown', to: `/products/${primary.productId}` },
    ],
  };
}

function answerBestOfBest(bob) {
  const c = bob.composite;
  const ranked = [...c.vsProducts].sort((a, b) => a.headroomCostPct - b.headroomCostPct);
  const closest = ranked[0];
  const furthest = ranked[ranked.length - 1];

  return {
    headline: `The best-of-best target is ${money(c.totalCost, bob.currency)} and ${kg(c.totalWeightKg)}, assembled from the cheapest version of each of ${c.moduleCount} modules.`,
    stats: [
      { label: 'Target cost', value: money(c.totalCost, bob.currency) },
      { label: 'Target weight', value: kg(c.totalWeightKg) },
      { label: 'Target cost per kg', value: `${money(c.costPerKg, bob.currency)}/kg` },
      { label: 'Modules', value: count(c.moduleCount) },
    ],
    table: {
      columns: ['Module', 'Cheapest from', 'Module cost', 'Lightest from'],
      rows: c.modules.map((m) => [
        m.module,
        m.costFrom ? `${m.costFrom.brand} ${m.costFrom.productName}` : '—',
        money(m.cost, bob.currency),
        m.weightFrom ? `${m.weightFrom.brand} ${m.weightFrom.productName}` : '—',
      ]),
    },
    narrative: [
      `${closest.brand} ${closest.productName} is closest to the target with ${money(closest.headroomCost, bob.currency)} of headroom (+${closest.headroomCostPct}%).`,
      `${furthest.brand} ${furthest.productName} is furthest away at ${money(furthest.headroomCost, bob.currency)} (+${furthest.headroomCostPct}%).`,
    ],
    // The composite's own caveats travel with it — a target quoted without them
    // reads as a purchasable price.
    notes: [
      ...c.caveats,
      'Each product is measured against a like-for-like target covering only the modules it actually has.',
    ],
    sources: [{ label: 'Open Best-of-Best', to: '/best-of-best' }],
  };
}

/** Set-wide executive narrative, synthesised from the live figures. */
function answerExecutiveSummary(bob) {
  const byCost = [...bob.products].sort((a, b) => a.totalCost - b.totalCost);
  const byWeight = [...bob.products].sort((a, b) => a.totalWeightKg - b.totalWeightKg);
  const cheapest = byCost[0];
  const dearest = byCost[byCost.length - 1];
  const lightest = byWeight[0];
  const c = bob.composite;
  const spreadPct = Number((((dearest.totalCost - cheapest.totalCost) / cheapest.totalCost) * 100).toFixed(1));
  const worst = [...c.vsProducts].sort((a, b) => b.headroomCostPct - a.headroomCostPct)[0];

  return {
    headline: `Across ${bob.products.length} teardowns, BOM cost spans ${money(cheapest.totalCost, bob.currency)} to ${money(dearest.totalCost, bob.currency)} — a ${spreadPct}% spread.`,
    stats: [
      { label: 'Products benchmarked', value: count(bob.products.length) },
      { label: 'Cheapest', value: `${cheapest.brand} · ${money(cheapest.totalCost, bob.currency)}` },
      { label: 'Lightest', value: `${lightest.brand} · ${kg(lightest.totalWeightKg)}` },
      { label: 'Best-of-best target', value: money(c.totalCost, bob.currency) },
    ],
    narrative: [
      `${label(cheapest)} is the lowest-cost unit at ${money(cheapest.totalCost, bob.currency)}; ${label(dearest)} is the highest at ${money(dearest.totalCost, bob.currency)}.`,
      `${label(lightest)} is the lightest at ${kg(lightest.totalWeightKg)}, which is not the same product as the cheapest — cost and mass do not move together across this set.`,
      `Matching the best competitor in every module at once would put a unit at ${money(c.totalCost, bob.currency)} and ${kg(c.totalWeightKg)}.`,
      `The largest gap to that target is ${label(worst)}, carrying ${money(worst.headroomCost, bob.currency)} above best-in-class module for module (+${worst.headroomCostPct}%).`,
    ],
    table: {
      columns: ['Product', 'Total cost', 'Total weight', 'Part lines', 'Cost per kg'],
      rows: byCost.map((p) => [
        label(p),
        money(p.totalCost, bob.currency),
        kg(p.totalWeightKg),
        count(p.partLines),
        `${money(p.costPerKg, bob.currency)}/kg`,
      ]),
    },
    notes: ['Figures are the same stored rollups the persona reports and Best-of-Best view use.'],
    sources: [
      { label: 'Open Best-of-Best', to: '/best-of-best' },
      { label: 'Open Compare', to: '/compare' },
    ],
  };
}

/** Executive view for one named product, from its own persona report. */
function answerProductExecutive(product) {
  const view = buildExecutiveView(product);

  return {
    headline: `${product.brand} ${product.name} — executive summary.`,
    stats: [
      { label: 'Total cost', value: money(view.headline.totalCost, view.currency) },
      { label: 'Total weight', value: kg(view.headline.totalWeightKg) },
      { label: 'Part units', value: count(view.headline.partUnits) },
      {
        label: 'Cost per kg',
        value: view.headline.costPerKg === null ? '—' : `${money(view.headline.costPerKg, view.currency)}/kg`,
      },
    ],
    narrative: view.keyPoints,
    // buildExecutiveView pre-shapes its cost-by-module series as {label, value}
    // on `headlineChart` — reused verbatim as table rows rather than reshaped.
    table: {
      columns: ['Module', 'Cost'],
      rows: view.headlineChart.data.map((row) => [row.label, money(row.value, view.currency)]),
    },
    sources: [
      { label: 'Open full reports', to: `/products/${product.id}/reports` },
      { label: 'Open teardown', to: `/products/${product.id}` },
    ],
  };
}

function answerProductProfile(product, bob) {
  const summary = bob.products.find((p) => p.productId === product.id);
  return {
    headline: `${product.brand} ${product.name} — ${product.category}.`,
    stats: [
      { label: 'Total cost', value: money(summary?.totalCost, bob.currency) },
      { label: 'Total weight', value: kg(summary?.totalWeightKg) },
      { label: 'Part lines', value: count(summary?.partLines) },
      { label: 'Modules', value: count(summary?.moduleCount) },
    ],
    narrative: product.notes ? [product.notes] : [],
    table: null,
    notes: [
      'Ask "compare ' + product.brand + ' and <other>" or "generate an executive summary" for more.',
    ],
    sources: [
      { label: 'Open teardown', to: `/products/${product.id}` },
      { label: 'Open reports', to: `/products/${product.id}/reports` },
    ],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Answer a natural-language question about the benchmark set.
 *
 * @param {string} question
 * @returns {Promise<object>} { question, understood, intent, headline, stats,
 *   table, narrative, notes, sources, suggestions }
 */
export async function ask(question) {
  if (!question || !String(question).trim()) {
    throw badRequest('Ask a question — for example "Which product is the cheapest?"');
  }
  if (String(question).length > 500) {
    throw badRequest('Question is too long (500 characters max)');
  }

  const all = await products.listProducts();
  if (all.length < 2) {
    await pause(80);
    return {
      question,
      understood: false,
      intent: 'no-data',
      headline: 'There are not enough teardowns in the repository to answer questions yet.',
      narrative: ['Import a CEDARS BOM or run the seed script to load the reference set.'],
      suggestions: [...EXAMPLE_QUESTIONS],
      stats: [],
      table: null,
      notes: [],
      sources: [],
    };
  }

  const parsed = parse(question, all);

  if (parsed.intent === 'unknown') {
    await pause(120);
    return {
      question,
      understood: false,
      intent: 'unknown',
      headline: "I couldn't match that to a question I can answer from the benchmark data.",
      narrative: [
        'This is a deterministic prompt layer, not a language model — it answers a fixed set of question shapes about cost, weight, part count, modules, comparisons and the best-of-best target.',
      ],
      suggestions: [...EXAMPLE_QUESTIONS],
      stats: [],
      table: null,
      notes: [],
      sources: [],
    };
  }

  // One best-of-best call covers almost every intent: it carries per-product
  // totals, module leaders and the composite target in a single pass, all built
  // by benchmarkService.
  const ids = all.slice(0, MAX_PRODUCTS).map((p) => p.id);
  const capped = all.length > MAX_PRODUCTS;
  const bob = await buildBestOfBest(ids);

  const baseNotes = capped
    ? [`Only the first ${MAX_PRODUCTS} teardowns are included — comparison is capped at ${MAX_PRODUCTS}.`]
    : [];

  let answer;

  switch (parsed.intent) {
    case 'superlative':
      answer = answerSuperlative(parsed.rule, bob);
      break;

    case 'module':
      answer = answerModule(parsed.module, parsed.prefer, bob);
      break;

    case 'best_of_best':
      answer = answerBestOfBest(bob);
      break;

    case 'executive_summary': {
      // "Executive summary for Trane" gets that product's own report; a bare
      // "generate an executive summary" gets the whole set.
      if (parsed.named.length === 1) {
        const teardown = await products.getTeardown(parsed.named[0].product.id);
        answer = answerProductExecutive(teardown);
      } else {
        answer = answerExecutiveSummary(bob);
      }
      break;
    }

    case 'difference': {
      const [left, right] = splitSides(parsed.named);
      if (!left.length || !right.length) {
        answer = {
          headline: 'A difference needs two products to compare.',
          narrative: ['Name two, for example "cost difference between Carrier and Goodman".'],
          stats: [],
          table: null,
        };
        break;
      }
      answer = answerDifference(parsed.metric, left, right, bob);
      // Say out loud why there is more than one row, rather than leaving the
      // reader to infer it from "2 pairings".
      answer.notes = [
        ...(answer.notes ?? []),
        ...countMultiModelBrands([...left, ...right]).map(
          ([brand, n]) => `${brand} matched ${n} models, so every pairing is shown.`,
        ),
      ];
      break;
    }

    case 'compare': {
      const chosen = parsed.all || parsed.named.length < 2 ? ids : parsed.named.map((n) => n.product.id);
      const unique = [...new Set(chosen)].slice(0, MAX_PRODUCTS);
      if (unique.length < 2) {
        answer = {
          headline: 'A comparison needs at least two products.',
          narrative: ['Try "compare Goodman and Bosch", or "compare all products".'],
          stats: [],
          table: null,
        };
        break;
      }
      const notes = [];
      if (!parsed.all && parsed.named.length < 2) {
        notes.push('Fewer than two products were named, so the whole set is compared.');
      }
      const brandsWithMultiple = countMultiModelBrands(parsed.named);
      for (const [brand, n] of brandsWithMultiple) {
        notes.push(`${brand} matched ${n} models, so both are included.`);
      }
      answer = answerCompare(await compareProducts(unique), notes);
      break;
    }

    case 'product_profile':
      answer = answerProductProfile(parsed.named[0].product, bob);
      break;

    default:
      answer = { headline: 'Unhandled question type.', stats: [], table: null };
  }

  await pause();

  return {
    question,
    understood: true,
    intent: parsed.intent,
    headline: answer.headline,
    stats: answer.stats ?? [],
    table: answer.table ?? null,
    narrative: answer.narrative ?? [],
    notes: [...baseNotes, ...(answer.notes ?? [])],
    sources: answer.sources ?? [],
    suggestions: [],
  };
}

/**
 * Split named products into two sides for a two-entity question.
 *
 * Groups by brand in mention order: everything matching the first brand is the
 * left side, everything else the right. That's what makes "cost difference
 * between Carrier and Goodman" work when Carrier has two models — the left side
 * legitimately holds both.
 */
function splitSides(named) {
  if (named.length < 2) return [named, []];
  const firstBrand = named[0].product.brand;
  const left = named.filter((n) => n.product.brand === firstBrand);
  const right = named.filter((n) => n.product.brand !== firstBrand);
  return right.length ? [left, right] : [[named[0]], named.slice(1)];
}

/** Brands in the match set that resolved to more than one model. */
function countMultiModelBrands(named) {
  const counts = new Map();
  for (const n of named) {
    counts.set(n.product.brand, (counts.get(n.product.brand) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1);
}
