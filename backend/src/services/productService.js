// ---------------------------------------------------------------------------
// src/services/productService.js
//
// The layer between routes and data. Right now it is deliberately thin — most
// methods validate, delegate, and translate "null" into a 404. That thinness is
// the point, not an oversight:
//
//   - Routes stay about HTTP (params in, JSON out, status codes).
//   - Data stays about persistence.
//   - Everything that is a *decision* — what counts as valid, what a 404 means,
//     what shape the client gets — lives here, in one place, testable without
//     booting Express or touching a database.
//
// benchmarkService will be the fat one. This file is the seam that lets it be.
//
// RULE: this file imports from ../data/index.js and never from a repository
// file or db/client.js directly.
// ---------------------------------------------------------------------------

import { PRODUCT_SOURCES, products, parts, costs, measurements } from '../data/index.js';
import { HttpError, badRequest, notFound, parseId } from '../lib/http.js';

/**
 * All products, shallow, for the index page and the comparison picker.
 */
export async function listProducts() {
  return products.listProducts();
}

/**
 * One product without its tree.
 * @throws {HttpError} 404 when the id does not exist
 */
export async function getProduct(id) {
  const productId = parseId(id, 'productId');
  const product = await products.getProductById(productId);
  if (!product) throw notFound(`No product with id ${productId}`);
  return product;
}

/**
 * The full teardown tree: sub-assemblies -> parts -> costs + measurements.
 *
 * Adds a small `counts` block. This is presentation convenience, not analysis —
 * the UI wants "17 parts" in a header without walking the tree in the browser.
 * Actual benchmarking (totals, deltas, per-material rollups) belongs in
 * benchmarkService, not here.
 */
export async function getTeardown(id) {
  const productId = parseId(id, 'productId');
  const teardown = await products.getTeardown(productId);
  if (!teardown) throw notFound(`No product with id ${productId}`);

  const allParts = teardown.subAssemblies.flatMap((s) => s.parts);

  return {
    ...teardown,
    counts: {
      subAssemblies: teardown.subAssemblies.length,
      partLines: allParts.length,
      // Distinct part *lines* vs total physical *units* (quantity summed) are
      // different numbers and the design persona cares about both. Naming them
      // separately here stops the two being conflated downstream.
      partUnits: allParts.reduce((sum, p) => sum + (p.quantity ?? 1), 0),
      measurements: allParts.reduce((sum, p) => sum + p.measurements.length, 0),
    },
  };
}

/**
 * Several teardowns for side-by-side comparison.
 *
 * @param {string|string[]} rawIds  "1,2,3" from a query string, or an array
 * @throws {HttpError} 400 on malformed input, 404 if any id is missing
 */
export async function compareTeardowns(rawIds) {
  const list = Array.isArray(rawIds) ? rawIds : String(rawIds ?? '').split(',');
  const ids = list
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((v) => parseId(v, 'productId'));

  if (ids.length < 2) {
    throw badRequest('compare requires at least two product ids, e.g. ?ids=1,2');
  }
  if (ids.length > 5) {
    // Not a technical limit — a readability one. Nothing charts well past ~5
    // series, and it caps the query cost.
    throw badRequest('compare supports at most five products at once');
  }

  const found = await products.getTeardowns(ids);

  // Fail loudly on a missing id rather than silently returning two of the three
  // products asked for. A comparison quietly missing a column is worse than an
  // error, because it still looks like a valid answer.
  if (found.length !== ids.length) {
    const foundIds = new Set(found.map((p) => p.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    throw notFound(`No product with id ${missing.join(', ')}`);
  }

  return found;
}

/**
 * Every part in a product, flattened across sub-assemblies.
 * Verifies the product exists first so a bad id reads as 404, not empty array.
 */
export async function getParts(id) {
  const productId = parseId(id, 'productId');
  await getProduct(productId);
  return parts.listByProduct(productId);
}

/** Flat cost rows — the raw input benchmarkService will roll up. */
export async function getCosts(id) {
  const productId = parseId(id, 'productId');
  await getProduct(productId);
  return costs.listByProduct(productId);
}

/** Capture history, newest first. */
export async function getMeasurements(id) {
  const productId = parseId(id, 'productId');
  await getProduct(productId);
  return measurements.listByProduct(productId);
}

/**
 * Create a product.
 *
 * Validation lives here rather than in the route so the same rules apply if the
 * seed, a CLI, or a future ingestion job calls it.
 */
export async function createProduct(body) {
  const required = ['name', 'brand', 'category'];
  const missing = required.filter((f) => !body?.[f]?.toString().trim());
  if (missing.length) {
    throw badRequest(`Missing required field(s): ${missing.join(', ')}`);
  }

  try {
    return await products.createProduct({
      name: body.name.trim(),
      brand: body.brand.trim(),
      category: body.category.trim(),
      notes: body.notes?.trim() || null,
      // Created through the app's own form. Stated here rather than relying on the
      // column default, so all three provenances are visible at their three call
      // sites (seed / import / here) instead of one of them being an absence.
      source: PRODUCT_SOURCES.MANUAL,
    });
  } catch (err) {
    // P2002 = unique constraint. Ours is @@unique([brand, name]), so this means
    // the teardown already exists — a 409, not a 500.
    if (err.code === 'P2002') {
      throw new HttpError(
        409,
        `A product named "${body.name}" already exists for brand "${body.brand}"`,
      );
    }
    throw err;
  }
}

/** Partial update. @throws 404 when the id does not exist */
export async function updateProduct(id, patch) {
  const productId = parseId(id, 'productId');
  if (!patch || Object.keys(patch).length === 0) {
    throw badRequest('Update body cannot be empty');
  }

  const updated = await products.updateProduct(productId, patch);
  if (!updated) throw notFound(`No product with id ${productId}`);
  return updated;
}

/**
 * Delete a product and its whole teardown tree (schema cascade).
 * @throws {HttpError} 404 when the id does not exist
 */
export async function deleteProduct(id) {
  const productId = parseId(id, 'productId');
  const ok = await products.deleteProduct(productId);
  if (!ok) throw notFound(`No product with id ${productId}`);
  return { deleted: productId };
}