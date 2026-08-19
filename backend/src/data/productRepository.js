// ---------------------------------------------------------------------------
// src/data/productRepository.js
//
// THE CONTRACT FOR EVERY FILE IN THIS FOLDER:
//   1. These are the only modules that import `prisma`.
//   2. Every function takes and returns plain JS objects — no Prisma-specific
//      shapes (no `where`, no `include`, no Decimal) crosses this boundary.
//   3. "Not found" returns null. Bad input throws. Callers never see a Prisma
//      error class.
//
// Follow those three and swapping SQLite -> Azure SQL -> Snowflake means
// rewriting this folder and nothing else.
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';
import { normalisePart } from './partRepository.js';
import { normaliseCost } from './costRepository.js';

/**
 * The nested shape the benchmarking service needs: the entire teardown tree in
 * one round trip.
 *
 * Defined once as a constant rather than inline, because if the tree shape
 * drifts between two call sites you get bugs that only appear on one screen.
 * Prisma compiles this into a small number of queries and stitches the result.
 */
const TEARDOWN_INCLUDE = {
  subAssemblies: {
    orderBy: { name: 'asc' },
    include: {
      parts: {
        orderBy: { name: 'asc' },
        include: {
          costs: true,
          measurements: { orderBy: { capturedAt: 'desc' } },
        },
      },
    },
  },
};

/**
 * List products for the picker / index page.
 *
 * Deliberately shallow — it returns counts, not the tree. Loading three full
 * teardowns to render a list of three names is the classic way a demo starts
 * feeling sluggish.
 *
 * Ordered by id (= creation order), not name — id order is also seed order,
 * and the seed deliberately builds budget -> mid -> premium so the first
 * product is the intended baseline. Sorting alphabetically would put whatever
 * brand starts earliest in the alphabet first instead, which has no relation
 * to which teardown the comparison views should anchor on.
 *
 * @returns {Promise<Array<object>>} products, each with `subAssemblyCount`
 */
export async function listProducts() {
  const rows = await prisma.product.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { subAssemblies: true } } },
  });

  // `_count` is Prisma-flavoured, so flatten it before it escapes this folder.
  return rows.map(({ _count, ...product }) => ({
    ...product,
    subAssemblyCount: _count.subAssemblies,
  }));
}

/**
 * Fetch one product without its children.
 * @returns {Promise<object|null>} null when the id does not exist
 */
export async function getProductById(id) {
  return prisma.product.findUnique({ where: { id: Number(id) } });
}

/**
 * Fetch one product with sub-assemblies, parts, costs and measurements.
 * This is the input to every persona report.
 *
 * @returns {Promise<object|null>} null when the id does not exist
 */
export async function getTeardown(id) {
  return prisma.product.findUnique({
    where: { id: Number(id) },
    include: TEARDOWN_INCLUDE,
  });
}

/**
 * Fetch several teardowns at once, for product-vs-product comparison.
 *
 * One query with `in` rather than N calls to getTeardown — the N+1 pattern is
 * survivable on local SQLite and very much not survivable against Azure SQL,
 * and you want the habit already in place before the swap.
 */
export async function getTeardowns(ids) {
  return prisma.product.findMany({
    where: { id: { in: ids.map(Number) } },
    include: TEARDOWN_INCLUDE,
    orderBy: { name: 'asc' },
  });
}

/**
 * Where a product came from. SQLite has no enums, so this is validated here — the
 * same place Part.geometryType is checked, and for the same reason.
 */
export const PRODUCT_SOURCES = Object.freeze({
  SEED: 'seed',
  IMPORT: 'import',
  MANUAL: 'manual',
});
const VALID_SOURCES = Object.values(PRODUCT_SOURCES);

/**
 * Validate a provenance value.
 *
 * Defaults to "manual" rather than throwing when absent, because that is what an
 * unlabelled write actually is — a product created through the app's own form. A
 * value that is present but WRONG does throw: quietly coercing "imported" to
 * "manual" would mislabel real competitor data as hand-entered, which is precisely
 * the confusion this column exists to remove.
 */
function normaliseSource(value) {
  if (value === null || value === undefined || value === '') return PRODUCT_SOURCES.MANUAL;
  if (!VALID_SOURCES.includes(value)) {
    throw new Error(`Product.source must be one of ${VALID_SOURCES.join(', ')} — got: ${value}`);
  }
  return value;
}

/**
 * Create a product.
 * @param {{name: string, brand: string, category: string, notes?: string, source?: string}} data
 */
export async function createProduct({ name, brand, category, notes = null, source }) {
  if (!name || !brand || !category) {
    throw new Error('createProduct requires name, brand and category');
  }
  return prisma.product.create({
    data: { name, brand, category, notes, source: normaliseSource(source) },
  });
}

/**
 * Create-or-update by the natural key (brand + name).
 *
 * This is what makes `npm run seed` safe to re-run: the second run updates the
 * same three products instead of raising a unique-constraint error or quietly
 * creating duplicates. Requires the @@unique([brand, name]) in the schema.
 */
export async function upsertProduct({ name, brand, category, notes = null, source }) {
  const resolved = normaliseSource(source);
  return prisma.product.upsert({
    where: { brand_name: { brand, name } }, // Prisma's compound-key naming
    // `source` is updated as well as created: re-seeding over a product that was
    // previously imported by hand must restore its "seeded demo data" label, or the
    // badge would go on claiming the figures came from a real teardown when the
    // seed has just replaced them with fabricated ones.
    update: { category, notes, source: resolved },
    create: { name, brand, category, notes, source: resolved },
  });
}

/**
 * Create a whole teardown — product, sub-assemblies, parts and cost rows — in
 * ONE call. This is the write side of the CEDARS BOM import.
 *
 * Implemented as a single Prisma nested create rather than an explicit
 * $transaction of many creates (the pattern partRepository.createMany uses).
 * A nested create is already atomic, and atomicity is the whole point here: a
 * half-imported teardown is worse than a failed one, because it still renders
 * as a complete product and every cost rollup it feeds is quietly short.
 *
 * Part and cost payloads go through the SAME normalisers the single-record write
 * paths use, imported from their own repositories — so the Part column
 * allow-list lives in exactly one place and an import can't drift from a
 * hand-entered edit.
 *
 * @param {object} args
 * @param {{name: string, brand: string, category: string, notes?: string}} args.product
 * @param {Array<{name: string, description?: string, parts: Array<object>}>} args.modules
 *   Each part may carry a `cost` sub-object ({ materialCost, processCost,
 *   labourCost, currency }); parts without one get no cost row at all, which is
 *   deliberately different from a zero-cost row — see the comment in the body.
 * @returns {Promise<object>} the created product with its full tree
 */
export async function createTeardown({ product, modules }) {
  if (!product?.name || !product?.brand || !product?.category) {
    throw new Error('createTeardown requires product name, brand and category');
  }

  return prisma.product.create({
    data: {
      name: product.name,
      brand: product.brand,
      category: product.category,
      notes: product.notes ?? null,
      source: normaliseSource(product.source),
      subAssemblies: {
        create: modules.map((mod) => ({
          name: mod.name,
          description: mod.description ?? null,
          parts: {
            create: mod.parts.map((part) => ({
              ...normalisePart(part),
              // A part with no cost information gets NO cost row, rather than a
              // row of zeros. benchmarkService only rolls up parts that have a
              // cost record, so a zero row would drag the "costed coverage"
              // signal down and assert "this part is free" — which is a
              // different, and false, claim from "we don't know this part's
              // cost". The CEDARS files have plenty of the latter.
              ...(part.cost ? { costs: { create: normaliseCost(part.cost) } } : {}),
            })),
          },
        })),
      },
    },
    include: TEARDOWN_INCLUDE,
  });
}

/**
 * Partial update. Only the keys present in `patch` are written.
 * @returns {Promise<object|null>} null when the id does not exist
 */
export async function updateProduct(id, patch) {
  const allowed = ['name', 'brand', 'category', 'notes'];
  const data = Object.fromEntries(
    Object.entries(patch).filter(([k]) => allowed.includes(k)),
  );
  if (Object.keys(data).length === 0) return getProductById(id);

  // Whitelisting keys rather than spreading `patch` straight in: it stops a
  // stray field in a request body from reaching the database, and it means an
  // API caller can never overwrite `id` or `createdAt`.
  try {
    return await prisma.product.update({ where: { id: Number(id) }, data });
  } catch (err) {
    if (err.code === 'P2025') return null; // Prisma's "record not found"
    throw err;
  }
}

/**
 * Delete a product and, via the schema's onDelete: Cascade, its entire
 * teardown tree and reports.
 *
 * @returns {Promise<boolean>} false when the id did not exist
 */
export async function deleteProduct(id) {
  try {
    await prisma.product.delete({ where: { id: Number(id) } });
    return true;
  } catch (err) {
    if (err.code === 'P2025') return false;
    throw err;
  }
}