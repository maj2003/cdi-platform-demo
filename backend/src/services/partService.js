// ---------------------------------------------------------------------------
// src/services/partService.js
//
// The write path for editing a part's own record — today, specifically its
// geometryType and dimension fields (see the Geometry editor on Product
// Detail). Deliberately separate from productService.js: this is part-level
// business logic, not product-level, and keeping it out of productService
// stops that file from becoming the dumping ground for anything that happens
// to touch a Part.
// ---------------------------------------------------------------------------

import { parts, subAssemblies, reports } from '../data/index.js';
import { badRequest, notFound, parseId } from '../lib/http.js';

/** Ceiling on parts per module — a runaway-client guard, not a domain rule. */
const MAX_PARTS_PER_MODULE = 500;

/**
 * Create a part inside a module. The write path behind the BOM Authoring
 * Workbench's "Add Part".
 *
 * Takes the same field names `partRepository.normalise()` accepts, so the
 * authoring form, the CEDARS importer and the seed all write through one
 * allow-list and one set of coercion rules — a numeric field arriving as the
 * string "412" from a form input is handled in exactly the place it already was.
 *
 * NOTE ON COST: this deliberately does NOT create a Cost row. A part with no
 * cost record reads as "not costed yet" throughout the reports (and is counted
 * in the cost view's `uncostedPartLines`), which is true and visible. Writing a
 * row of zeros instead would assert "this part is free" — a different and false
 * claim. There is no in-app cost editor yet; see PROGRESS.md's TODO.
 *
 * @param {object} body  subAssemblyId + name required, any other Part column optional
 * @returns {Promise<object>} the created part
 * @throws {HttpError} 400 on bad input, 404 for an unknown module
 */
export async function createPart(body) {
  const subAssemblyId = parseId(body?.subAssemblyId, 'subAssemblyId');

  const name = body?.name?.toString().trim();
  if (!name) throw badRequest('A part needs a name.');
  if (name.length > 200) throw badRequest('Part name is too long (200 characters max).');

  const module = await subAssemblies.getById(subAssemblyId);
  if (!module) throw notFound(`No module with id ${subAssemblyId}`);
  if (module.parts.length >= MAX_PARTS_PER_MODULE) {
    throw badRequest(`A module is limited to ${MAX_PARTS_PER_MODULE} parts.`);
  }

  let created;
  try {
    created = await parts.create({ ...body, subAssemblyId, name });
  } catch (err) {
    // normalise() throws plain Errors on bad input (non-numeric weight, invalid
    // geometryType, non-integer quantity). That's the client's mistake, so
    // relabel it 400 rather than letting it fall through as a 500 — the same
    // translation updatePart does below.
    throw badRequest(err.message);
  }

  await reports.clearForProduct(module.productId);
  return created;
}

/**
 * Delete a part. Cascades to its costs and measurements per the schema.
 *
 * Unlike deleting a module this is allowed unconditionally: a part is the unit a
 * person actually decides about, and its captures belong to it rather than being
 * a surprise third party. The UI still confirms.
 *
 * @throws {HttpError} 404 when the id doesn't exist
 */
export async function deletePart(id) {
  const partId = parseId(id, 'partId');

  const part = await parts.getById(partId);
  if (!part) throw notFound(`No part with id ${partId}`);

  // Resolved BEFORE the delete — afterwards there's no row to walk up from.
  const module = await subAssemblies.getById(part.subAssemblyId);

  await parts.remove(partId);
  if (module) await reports.clearForProduct(module.productId);

  return { deleted: partId };
}

/**
 * Partially update a part.
 *
 * @param {string|number} id
 * @param {object} patch  any subset of Part's own columns (see partRepository.js's
 *   normalise() for the full list) — only the keys present in patch are touched.
 * @throws {HttpError} 400 on invalid input (bad geometryType, non-numeric
 *   dimension, non-integer turns/bends/punches), 404 if the part doesn't exist
 */
export async function updatePart(id, patch) {
  const partId = parseId(id, 'partId');

  let updated;
  try {
    updated = await parts.update(partId, patch);
  } catch (err) {
    // partRepository's normalise() throws plain Errors on bad input (same as
    // measurementRepository.validate()) — relabel as the client's mistake
    // rather than letting it fall through to the generic 500 handler.
    throw badRequest(err.message);
  }
  if (!updated) throw notFound(`No part with id ${partId}`);

  // Dimension edits can change what the design-engineer report shows
  // (envelope, part weight) — same "editing the teardown invalidates cached
  // reports" rule captureService.js follows after a measurement write.
  const sub = await subAssemblies.getById(updated.subAssemblyId);
  if (sub) await reports.clearForProduct(sub.productId);

  return updated;
}
