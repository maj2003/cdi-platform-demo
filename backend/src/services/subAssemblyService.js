// ---------------------------------------------------------------------------
// src/services/subAssemblyService.js
//
// Module-level authoring: create and delete the Level-1 modules a teardown is
// organised into. The write path behind the BOM Authoring Workbench's
// "Add Module".
//
// Deliberately its own file rather than more surface on productService, for the
// same reason partService exists: this is sub-assembly business logic, and
// productService stays about products.
//
// NAMING: the API and UI both say "module" because that's the word the teardown
// process uses (Packaging Assm, Cabinet Assm, …). The table is still
// SubAssembly. One concept, two names — the translation happens here and
// nowhere else, so no route or component has to know both.
// ---------------------------------------------------------------------------

import { products, subAssemblies, reports } from '../data/index.js';
import { badRequest, HttpError, notFound, parseId } from '../lib/http.js';

/** Ceiling on modules per product — a guard against a runaway client, not a domain rule. */
const MAX_MODULES = 40;

/**
 * Create a module on a product.
 *
 * @param {object} body
 * @param {number|string} body.productId
 * @param {string} body.name
 * @param {string} [body.description]
 * @returns {Promise<object>} the created module, with partCount
 * @throws {HttpError} 400 on bad input, 404 for an unknown product,
 *   409 when the product already has a module of that name
 */
export async function createModule(body) {
  const productId = parseId(body?.productId, 'productId');

  const name = body?.name?.toString().trim();
  if (!name) throw badRequest('A module needs a name — for example "Cabinet Assm".');
  if (name.length > 120) throw badRequest('Module name is too long (120 characters max).');

  const product = await products.getProductById(productId);
  if (!product) throw notFound(`No product with id ${productId}`);

  const existing = await subAssemblies.listByProduct(productId);
  if (existing.length >= MAX_MODULES) {
    throw badRequest(`A product is limited to ${MAX_MODULES} modules.`);
  }

  // Rejected rather than silently allowed. There is no DB unique constraint —
  // two sub-assemblies CAN share a name, which is intentional for imported data
  // (see subAssemblyRepository.findOrCreate). But a human clicking "Add Module"
  // twice with the same name has almost certainly double-submitted, and two
  // identically-named modules would split every rollup in the reports in a way
  // that looks like a data bug rather than a duplicate.
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, `This product already has a module named "${name}".`);
  }

  const created = await subAssemblies.create({
    productId,
    name,
    description: body?.description?.toString().trim() || null,
  });

  // Adding a module changes the shape every per-module rollup reports, so the
  // cached persona reports are now stale — same rule captureService and
  // partService follow after a write.
  await reports.clearForProduct(productId);

  return { ...created, partCount: 0 };
}

/**
 * Delete a module.
 *
 * REFUSES A NON-EMPTY MODULE, on purpose. The schema cascades
 * SubAssembly -> Part -> Cost/Measurement, so deleting a populated module would
 * silently take an arbitrary amount of captured work with it on one click. The
 * caller is told how many parts are in the way and can delete them
 * deliberately. The UI only offers the control on an empty module.
 *
 * @throws {HttpError} 404 when the id doesn't exist, 409 when it still has parts
 */
export async function deleteModule(id) {
  const moduleId = parseId(id, 'moduleId');

  const module = await subAssemblies.getById(moduleId);
  if (!module) throw notFound(`No module with id ${moduleId}`);

  if (module.parts.length > 0) {
    throw new HttpError(
      409,
      `"${module.name}" still has ${module.parts.length} ${
        module.parts.length === 1 ? 'part' : 'parts'
      }. Delete them first — removing a module would delete its parts, costs and captures too.`,
    );
  }

  const productId = module.productId;
  await subAssemblies.remove(moduleId);
  await reports.clearForProduct(productId);

  return { deleted: moduleId };
}
