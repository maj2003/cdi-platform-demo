// ---------------------------------------------------------------------------
// src/services/photoLabelService.js
//
// HTTP-shaped rules around the photo-label family: validate, 404, translate the
// repository's plain Errors into status codes, and clear cached reports when a
// part's lead label changes (the Engineering BOM View and the BOM export both
// quote it).
//
// RULE: imports from ../data/index.js only — never a repository file directly.
// ---------------------------------------------------------------------------

import { photoLabels, reports } from '../data/index.js';
import { badRequest, notFound, parseId, HttpError } from '../lib/http.js';

/**
 * A sensible default label prefix for a product, from its model number.
 *
 * "Carrier FJ5ANXC48L" -> "FJ". The reference teardown labels its photos "FJ0010"
 * onward for the FJ5ANX family, so the letters come from the MODEL rather than the
 * brand: brand initials would give every Carrier teardown the same prefix, and the
 * entire purpose of a prefix is telling two teardowns' stickers apart on a bench.
 *
 * Falls back to the brand's initials, then to "P". A prefix that is merely
 * unhelpful is fine; one that throws would block the workflow over a naming nicety.
 */
export function defaultPrefixFor(product) {
  const model = String(product?.name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const letters = /^([A-Z]{1,3})/.exec(model);
  if (letters) return letters[1];

  const brand = String(product?.brand ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return brand.slice(0, 2) || 'P';
}

/** Resolve a part and its product in one query, or 404. */
async function resolve(partIdParam) {
  const partId = parseId(partIdParam, 'partId');
  const found = await photoLabels.getPartWithProduct(partId);
  if (!found) throw notFound(`No part with id ${partId}`);
  return { partId, ...found };
}

/**
 * The prefix a new label on this part should continue.
 *
 * This part's own series wins, so a part already labelled "FJ0010" keeps getting
 * FJ labels even if the product's model would suggest something else — the
 * stickers already on the bench are more authoritative than the model number.
 */
async function prefixFor(partId, product, requested) {
  const explicit = requested?.toString().trim().toUpperCase();
  if (explicit) return explicit;

  const existing = await photoLabels.listForPart(partId);
  const fromSeries = existing.length ? photoLabels.splitLabel(existing[0].label)?.prefix : null;
  return fromSeries || defaultPrefixFor(product);
}

/** Every label on a part, the valid views, and what "Generate next" would produce. */
export async function listForPart(partIdParam) {
  const { partId, product, productId } = await resolve(partIdParam);
  const labels = await photoLabels.listForPart(partId);
  return {
    labels,
    views: photoLabels.PHOTO_VIEWS,
    // Offered so the UI can SHOW the prefix before the button is pressed, rather
    // than surprising the engineer with a series they didn't choose.
    suggestedPrefix: await prefixFor(partId, product, null),
    productId,
  };
}

/** Allocate the next label in this part's series. Collision-safe (see repository). */
export async function allocate(partIdParam, body = {}) {
  const { partId, product, productId } = await resolve(partIdParam);
  const prefix = await prefixFor(partId, product, body.prefix);

  let created;
  try {
    created = await photoLabels.allocateForPart({
      partId,
      prefix,
      width: body.width ? Number(body.width) : undefined,
      view: body.view,
    });
  } catch (err) {
    throw badRequest(err.message);
  }

  await reports.clearForProduct(productId);
  return created;
}

/** Attach a label the engineer typed. 409 when it is already on this part. */
export async function add(partIdParam, body = {}) {
  const { partId, productId } = await resolve(partIdParam);

  let created;
  try {
    created = await photoLabels.addToPart({ partId, label: body.label, view: body.view });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new HttpError(
        409,
        `This part already carries the label "${body.label}". Labels are unique per part — ` +
          'the same sticker may appear on a DIFFERENT part (two parts photographed together), ' +
          'but not twice on this one.',
      );
    }
    throw badRequest(err.message);
  }

  await reports.clearForProduct(productId);
  return created;
}

/** Change a label's text or its view. */
export async function update(labelIdParam, body = {}) {
  const labelId = parseId(labelIdParam, 'labelId');

  let updated;
  try {
    updated = await photoLabels.updateLabel(labelId, body);
  } catch (err) {
    if (err.code === 'P2025') throw notFound(`No photo label with id ${labelId}`);
    if (err.code === 'P2002') {
      throw new HttpError(409, `That part already carries the label "${body.label}".`);
    }
    throw badRequest(err.message);
  }

  const found = await photoLabels.getPartWithProduct(updated.partId);
  if (found) await reports.clearForProduct(found.productId);
  return updated;
}

/**
 * Remove a label from a part.
 *
 * The stored IMAGE is browser-local (frontend/src/lib/puiStore.js) and is NOT
 * removed here — the server has no access to it, and the caller purges it after a
 * successful response. Said plainly because "delete the label" reasonably sounds
 * like it should take the photo with it.
 */
export async function remove(labelIdParam) {
  const labelId = parseId(labelIdParam, 'labelId');
  const removed = await photoLabels.removeLabel(labelId);
  if (!removed) throw notFound(`No photo label with id ${labelId}`);

  const found = await photoLabels.getPartWithProduct(removed.partId);
  if (found) await reports.clearForProduct(found.productId);

  return { deleted: labelId, partId: removed.partId, label: removed.label };
}

/** Which parts carry this label — the "photographed together" lookup. */
export async function partsSharing(label) {
  const rows = await photoLabels.findPartsByLabel(label);
  return rows.map((row) => ({
    labelId: row.id,
    label: row.label,
    view: row.view,
    partId: row.partId,
    partName: row.part?.name ?? null,
  }));
}
