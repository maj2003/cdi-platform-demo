// ---------------------------------------------------------------------------
// src/services/captureService.js
//
// The write path for the teardown rig: turn incoming L/W/H/weight readings
// into Measurement rows (provenance), roll the latest reading of each type
// into the Part's agreed-value columns (the "resolved view"), and drop any
// cached reports for the affected product so a stale snapshot never outlives
// the teardown it was computed from.
//
// RULE: same as productService — this file imports from ../data/index.js and
// never from a repository file or db/client.js directly.
// ---------------------------------------------------------------------------

import { parts, subAssemblies, measurements, reports, MEASUREMENT_TYPES } from '../data/index.js';
import { badRequest, notFound, parseId } from '../lib/http.js';

/**
 * Stand-in for the Entra ID identity that will replace it on the work laptop.
 * Isolated to this one constant so the swap is a single-line change.
 */
export const CAPTURED_BY = 'Demo user';

/**
 * Measurement.type -> the Part column it resolves to.
 *
 * Every type MUST appear here. A type with no column would validate, store a
 * Measurement row, and then never surface on the part — a reading that vanished,
 * which is worse than one rejected outright. verify-capture asserts the two sets
 * match so adding a type without a column fails loudly.
 */
const PART_FIELD_BY_TYPE = {
  [MEASUREMENT_TYPES.LENGTH]: 'lengthMm',
  [MEASUREMENT_TYPES.WIDTH]: 'widthMm',
  [MEASUREMENT_TYPES.HEIGHT]: 'heightMm',
  [MEASUREMENT_TYPES.WEIGHT]: 'weightG',
  [MEASUREMENT_TYPES.THICKNESS]: 'thicknessMm',
  [MEASUREMENT_TYPES.DIAMETER]: 'diameterOuterMm',
  [MEASUREMENT_TYPES.UNFOLDED_LENGTH]: 'unfoldedLengthMm',
  [MEASUREMENT_TYPES.UNFOLDED_WIDTH]: 'unfoldedWidthMm',
};

/** Reference data for the capture form: valid types and the default identity. */
export function getCaptureTypes() {
  return { types: MEASUREMENT_TYPES, defaultCapturedBy: CAPTURED_BY };
}

/**
 * Shape a raw request body into rows measurementRepository can validate.
 * Per-row `capturedBy` wins over a batch-level one, which wins over the
 * default identity — the rig may one day stamp its own operator per reading.
 */
function toMeasurementRows(list, body, partIdOverride) {
  if (!Array.isArray(list) || list.length === 0) {
    throw badRequest('body.measurements must be a non-empty array');
  }
  return list.map((m) => ({
    partId: partIdOverride ?? m.partId,
    type: m.type,
    value: m.value,
    unit: m.unit,
    capturedBy: m.capturedBy || body.capturedBy || CAPTURED_BY,
    capturedAt: m.capturedAt,
    imageUrl: m.imageUrl ?? null,
  }));
}

/**
 * measurementRepository.validate() throws a plain Error on bad input (it has
 * no notion of HTTP). A malformed reading is the client's mistake, so this
 * re-labels it as a 400 instead of letting it fall through to the generic
 * 500 handler.
 */
async function createMeasurements(rows) {
  try {
    return await measurements.createMany(rows);
  } catch (err) {
    throw badRequest(err.message);
  }
}

/**
 * After writing measurements for one part, roll the latest reading of each
 * type into Part's agreed-value columns and report which product needs its
 * cached reports dropped.
 */
async function resolvePartField(partId, createdRows) {
  const patch = {};
  for (const row of createdRows) {
    const field = PART_FIELD_BY_TYPE[row.type];
    if (field) patch[field] = row.value;
  }

  if (Object.keys(patch).length > 0) {
    await parts.update(partId, patch);
  }

  const part = await parts.getById(partId);
  const sub = await subAssemblies.getById(part.subAssemblyId);
  return { part, productId: sub.productId };
}

/**
 * POST /api/capture/part/:partId — one or more readings for a single part,
 * the shape the HID capture form uses as it steps through L → W → H → Weight.
 *
 * @param {string|number} partIdParam
 * @param {{measurements: Array, capturedBy?: string}} body
 * @throws {HttpError} 404 if the part does not exist, 400 on a malformed reading
 */
export async function captureForPart(partIdParam, body) {
  const partId = parseId(partIdParam, 'partId');

  const existing = await parts.getById(partId);
  if (!existing) throw notFound(`No part with id ${partId}`);

  const rows = toMeasurementRows(body?.measurements, body ?? {}, partId);
  const created = await createMeasurements(rows);

  const { part, productId } = await resolvePartField(partId, created);
  await reports.clearForProduct(productId);

  return { part, measurements: created };
}

/**
 * POST /api/capture — the flexible ingestion endpoint: a flat batch of
 * readings that may span several parts (and, in principle, several
 * products), matching CONTEXT.md's "Data Capture Layer" description.
 *
 * @param {{measurements: Array<{partId, type, value, unit, capturedBy?}>, capturedBy?: string}} body
 * @throws {HttpError} 400 on a malformed reading (including a missing partId)
 */
export async function captureBatch(body) {
  const rows = toMeasurementRows(body?.measurements, body ?? {}, undefined);
  const created = await createMeasurements(rows);

  // Group by part so each touched part is resolved exactly once, not once per
  // measurement row.
  const rowsByPart = new Map();
  for (const row of created) {
    if (!rowsByPart.has(row.partId)) rowsByPart.set(row.partId, []);
    rowsByPart.get(row.partId).push(row);
  }

  const updatedParts = [];
  const touchedProductIds = new Set();
  for (const [partId, partRows] of rowsByPart) {
    const { part, productId } = await resolvePartField(partId, partRows);
    updatedParts.push(part);
    touchedProductIds.add(productId);
  }

  await Promise.all([...touchedProductIds].map((id) => reports.clearForProduct(id)));

  return { measurements: created, parts: updatedParts };
}
