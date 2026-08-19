// ---------------------------------------------------------------------------
// src/data/partRepository.js
//
// Parts are where the benchmarking numbers live, so this file carries the most
// input hygiene: numeric coercion in one place, so no service ever has to
// wonder whether `weightG` arrived as a number or the string "412".
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';

/**
 * Coerce a value to a number, treating '' / null / undefined as "not provided".
 *
 * WHY THIS EXISTS: HTML form fields and JSON from Yuvaraj's capture rig both
 * hand you strings, and an empty input arrives as ''. `Number('')` is 0, which
 * would silently record a zero-gram part and quietly skew every rollup. This
 * maps blank to null and rejects genuine garbage loudly.
 */
function toNumberOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Part.${field} must be numeric, got: ${value}`);
  return n;
}

/** Same as toNumberOrNull, but for the count-like fields (turns, bends, punches). */
function toIntOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`Part.${field} must be an integer, got: ${value}`);
  return n;
}

/**
 * The allowed values for Part.geometryType.
 *
 * Same reasoning as MEASUREMENT_TYPES in measurementRepository.js: Prisma
 * cannot express an enum on SQLite, so the constraint lives here instead of
 * the DB, and gets deleted (not migrated) the day this column becomes a real
 * enum on Azure SQL.
 */
export const GEOMETRY_TYPES = Object.freeze({
  RECTANGULAR: 'rectangular',
  CIRCULAR: 'circular',
  SHEET_METAL: 'sheet_metal',
  CUSTOM: 'custom',
});

const VALID_GEOMETRY_TYPES = Object.values(GEOMETRY_TYPES);

function normaliseGeometryType(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!VALID_GEOMETRY_TYPES.includes(value)) {
    throw new Error(
      `Part.geometryType must be one of ${VALID_GEOMETRY_TYPES.join(', ')} — got: ${value}`,
    );
  }
  return value;
}

/**
 * Normalise an inbound part payload into exactly the columns the table has.
 *
 * Exported as `normalisePart` at the bottom of this file so productRepository's
 * BOM-import nested write can reuse it. That export exists specifically to keep
 * this function the SINGLE allow-list for Part columns — a second, hand-written
 * field list over in the import path is exactly how a new column ends up silently
 * dropped on one code path and not the other (see PROGRESS.md).
 */
function normalise(input) {
  return {
    name: input.name,
    material: input.material ?? null,
    finish: input.finish ?? null,
    weightG: toNumberOrNull(input.weightG, 'weightG'),
    lengthMm: toNumberOrNull(input.lengthMm, 'lengthMm'),
    widthMm: toNumberOrNull(input.widthMm, 'widthMm'),
    heightMm: toNumberOrNull(input.heightMm, 'heightMm'),
    thicknessMm: toNumberOrNull(input.thicknessMm, 'thicknessMm'),
    // Sheet-metal finish per face — external first, as reviewed.
    externalFinish: input.externalFinish ?? null,
    externalPaintThicknessMm: toNumberOrNull(
      input.externalPaintThicknessMm,
      'externalPaintThicknessMm',
    ),
    internalFinish: input.internalFinish ?? null,
    internalPaintThicknessMm: toNumberOrNull(
      input.internalPaintThicknessMm,
      'internalPaintThicknessMm',
    ),
    quantity: input.quantity === undefined ? 1 : Number(input.quantity),

    // BOM template metadata — see schema.prisma's Part model for what each
    // of these represents.
    makeOrBuy: input.makeOrBuy ?? null,
    moduleName: input.moduleName ?? null,
    productCategory: input.productCategory ?? null,
    partNo: input.partNo ?? null,
    uom: input.uom ?? null,
    primaryProcess: input.primaryProcess ?? null,
    secondaryProcess: input.secondaryProcess ?? null,
    surfaceFinish: input.surfaceFinish ?? null,
    assemblyLevel: input.assemblyLevel ?? null,
    geometryType: normaliseGeometryType(input.geometryType),

    // Circular geometry.
    diameterOuterMm: toNumberOrNull(input.diameterOuterMm, 'diameterOuterMm'),
    diameterInnerMm: toNumberOrNull(input.diameterInnerMm, 'diameterInnerMm'),
    turns: toIntOrNull(input.turns, 'turns'),

    // Sheet-metal geometry.
    unfoldedLengthMm: toNumberOrNull(input.unfoldedLengthMm, 'unfoldedLengthMm'),
    unfoldedWidthMm: toNumberOrNull(input.unfoldedWidthMm, 'unfoldedWidthMm'),
    bends: toIntOrNull(input.bends, 'bends'),
    punches: toIntOrNull(input.punches, 'punches'),

    // Benchmarking metadata.
    functionName: input.functionName ?? null,
    comparisonName: input.comparisonName ?? null,
    isFastener: input.isFastener ?? null,
    similarFlag: input.similarFlag ?? null,

    // CEDARS import fields — see CEDARS_BOM_Import_Spec.md.
    commodity: input.commodity ?? null,
    description: input.description ?? null,
    wallThicknessMm: toNumberOrNull(input.wallThicknessMm, 'wallThicknessMm'),
    fpi: toIntOrNull(input.fpi, 'fpi'),
    wireGauge: input.wireGauge ?? null,
    scrapRatePct: toNumberOrNull(input.scrapRatePct, 'scrapRatePct'),
    imageUrl: input.imageUrl ?? null,
    // weightLbs MIRRORS weightG. Derived here when the caller supplies grams and
    // not pounds, which is every capture-station write: the workstation sends
    // weightG (its imperial mode converts pounds to grams before saving, so the
    // database only ever holds metric), and before this the mirror column simply
    // kept whatever it had — so a weight recaptured at the bench left weightG and
    // weightLbs disagreeing. Nothing reads weightLbs today, which is exactly why
    // it could drift unnoticed; a mirror column that is silently wrong is worse
    // than no column, because the next reader trusts it.
    //
    // An explicitly supplied weightLbs still wins, so the CEDARS importer keeps
    // the pounds figure printed in the source file rather than a value round-tripped
    // through grams.
    weightLbs: deriveWeightLbs(input),

    // Picture UI — the teardown photo label ("C1", "FJ1", "CAB-001").
    // Normalised to trimmed uppercase so "c1", "C1 " and "C1" are the same
    // label. The ID is the key photos are grouped by, so a stray space or a
    // lowercase entry silently pointing at an empty photo set is exactly the
    // failure worth designing out — and it has to be done here, in the one
    // place every write path goes through, rather than in the form.
    photoId: normalisePhotoId(input.photoId),
  };
}

/** Exact, and matching frontend/src/lib/units.js so the two cannot disagree. */
const GRAMS_PER_POUND = 453.59237;

/**
 * The pounds mirror of weightG.
 *
 * Four decimals, matching what the seed writes, so a seeded part re-saved through
 * this path produces the same number rather than a value that differs in the fifth
 * decimal and looks like drift.
 */
function deriveWeightLbs(input) {
  const explicit = toNumberOrNull(input.weightLbs, 'weightLbs');
  if (explicit !== null) return explicit;
  const grams = toNumberOrNull(input.weightG, 'weightG');
  if (grams === null) return null;
  return Number((grams / GRAMS_PER_POUND).toFixed(4));
}

/** '' / null / undefined -> null; anything else trimmed and upper-cased. */
function normalisePhotoId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * @returns {Promise<object|null>} part with its costs and measurements, or null
 */
export async function getById(id) {
  return prisma.part.findUnique({
    where: { id: Number(id) },
    include: {
      costs: true,
      measurements: { orderBy: { capturedAt: 'desc' } },
    },
  });
}

export async function listBySubAssembly(subAssemblyId) {
  return prisma.part.findMany({
    where: { subAssemblyId: Number(subAssemblyId) },
    orderBy: { name: 'asc' },
    include: { costs: true },
  });
}

/**
 * Every part in a product, flattened across sub-assemblies.
 *
 * Traverses the relation (`subAssembly.productId`) rather than denormalising a
 * productId onto Part. One source of truth for the hierarchy; Prisma turns this
 * into a join.
 */
export async function listByProduct(productId) {
  return prisma.part.findMany({
    where: { subAssembly: { productId: Number(productId) } },
    orderBy: [{ subAssemblyId: 'asc' }, { name: 'asc' }],
    include: { costs: true, subAssembly: { select: { id: true, name: true } } },
  });
}

export async function create(input) {
  if (!input.subAssemblyId || !input.name) {
    throw new Error('createPart requires subAssemblyId and name');
  }
  return prisma.part.create({
    data: { subAssemblyId: Number(input.subAssemblyId), ...normalise(input) },
  });
}

/**
 * Insert many parts as one atomic unit.
 *
 * Uses an interactive transaction of individual `create` calls rather than
 * `createMany`. Two reasons:
 *   1. `createMany` does not return the created rows on SQLite, and the seed
 *      needs the new part ids to attach costs and measurements.
 *   2. Atomicity: if part 7 of 10 is malformed, the whole batch rolls back and
 *      you don't end up with a half-ingested teardown that looks complete.
 */
export async function createMany(subAssemblyId, parts) {
  const sid = Number(subAssemblyId);
  const rows = parts.map((p) => ({ subAssemblyId: sid, ...normalise(p) }));

  return prisma.$transaction(rows.map((data) => prisma.part.create({ data })));
}

export async function update(id, patch) {
  // Re-normalise, then drop keys the caller didn't mention — so a patch of
  // { weightG: 500 } doesn't blank out material and dimensions.
  const normalised = normalise({ ...patch, name: patch.name ?? undefined });
  const data = Object.fromEntries(
    Object.entries(normalised).filter(([k]) => k in patch),
  );
  // weightLbs is the ONE derived column, so it is the one exception to
  // "only what the caller mentioned". A patch of { weightG } must carry the
  // recomputed mirror with it or the two columns drift apart — which is how a
  // seeded part ended up with 13.46 g and 0.8378 lb on the same row.
  if ('weightG' in patch && !('weightLbs' in patch)) {
    data.weightLbs = normalised.weightLbs;
  }
  if (Object.keys(data).length === 0) return getById(id);

  try {
    return await prisma.part.update({ where: { id: Number(id) }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

/** @returns {Promise<boolean>} false when the id did not exist */
export async function remove(id) {
  try {
    await prisma.part.delete({ where: { id: Number(id) } });
    return true;
  } catch (err) {
    if (err.code === 'P2025') return false;
    throw err;
  }
}

// Re-exported under a clearer name for productRepository's BOM import. See the
// comment on normalise() for why the import path reuses this rather than
// building its own field list.
export { normalise as normalisePart };