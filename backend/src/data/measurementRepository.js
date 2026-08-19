// ---------------------------------------------------------------------------
// src/data/measurementRepository.js
//
// The append-only capture log. This is the write target for the flexible
// ingestion endpoint, so it is the one repository that has to be defensive
// about input it did not generate.
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';

/**
 * The allowed values for Measurement.type.
 *
 * These live here, in code, because Prisma cannot express an enum on SQLite.
 * Keeping them in the repository (not scattered across routes) means that when
 * the column becomes a real enum on Azure SQL, this constant is deleted and
 * nothing else has to move. Routes and the frontend import it from ../data.
 */
export const MEASUREMENT_TYPES = Object.freeze({
  LENGTH: 'dimension_length',
  WIDTH: 'dimension_width',
  HEIGHT: 'dimension_height',
  WEIGHT: 'weight',

  // ---------------------------------------------------------------------
  // Added with the BOM Capture workstation.
  //
  // Before these existed, only length/width/height/weight could be CAPTURED —
  // every other dimension was typed straight onto the Part with no record of
  // where the number came from. That made an instrument reading
  // indistinguishable from an estimate, on exactly the fields where the
  // distinction matters most: a 0.59 mm thickness read off a micrometer and a
  // 0.6 mm guess look the same in the database.
  //
  // THICKNESS and DIAMETER are direct reads. UNFOLDED_LENGTH and UNFOLDED_WIDTH
  // are flat-pattern dimensions measured on the blank before forming, which is
  // a separate physical observation from the folded envelope — not something
  // derivable from it without a bend-deduction table this app does not have.
  // ---------------------------------------------------------------------
  THICKNESS: 'dimension_thickness',
  DIAMETER: 'dimension_diameter',
  UNFOLDED_LENGTH: 'unfolded_length',
  UNFOLDED_WIDTH: 'unfolded_width',
});

const VALID_TYPES = Object.values(MEASUREMENT_TYPES);

/** The unit each type is expected to arrive in. */
const EXPECTED_UNIT = {
  [MEASUREMENT_TYPES.LENGTH]: 'mm',
  [MEASUREMENT_TYPES.WIDTH]: 'mm',
  [MEASUREMENT_TYPES.HEIGHT]: 'mm',
  [MEASUREMENT_TYPES.WEIGHT]: 'g',
  [MEASUREMENT_TYPES.THICKNESS]: 'mm',
  [MEASUREMENT_TYPES.DIAMETER]: 'mm',
  [MEASUREMENT_TYPES.UNFOLDED_LENGTH]: 'mm',
  [MEASUREMENT_TYPES.UNFOLDED_WIDTH]: 'mm',
};

/**
 * Validate one measurement before it reaches the table.
 *
 * The unit check is the important one. Everything downstream — cost per gram,
 * total product weight, the executive headline chart — assumes mm and grams. A
 * single row that arrives in kg with nobody noticing produces a report that is
 * wrong but entirely plausible-looking, which is the worst kind of demo bug.
 */
function validate(input) {
  if (!input.partId) throw new Error('measurement requires partId');

  if (!VALID_TYPES.includes(input.type)) {
    throw new Error(
      `measurement.type must be one of ${VALID_TYPES.join(', ')} — got: ${input.type}`,
    );
  }

  const value = Number(input.value);
  if (Number.isNaN(value)) {
    throw new Error(`measurement.value must be numeric, got: ${input.value}`);
  }

  const expected = EXPECTED_UNIT[input.type];
  if (input.unit !== expected) {
    throw new Error(
      `measurement.type "${input.type}" expects unit "${expected}", got "${input.unit}"`,
    );
  }

  return {
    partId: Number(input.partId),
    type: input.type,
    value,
    unit: input.unit,
    capturedBy: input.capturedBy || 'unknown',
    // Accept a supplied timestamp (the capture rig may batch-upload later) but
    // fall back to now.
    capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
    imageUrl: input.imageUrl ?? null,
  };
}

export async function create(input) {
  return prisma.measurement.create({ data: validate(input) });
}

/**
 * Ingest a batch atomically — the entry point for the capture endpoint.
 *
 * Validates every row *before* opening the transaction, so a bad payload fails
 * fast with a clear message instead of rolling back a partial write.
 */
export async function createMany(measurements) {
  const rows = measurements.map(validate);
  return prisma.$transaction(rows.map((data) => prisma.measurement.create({ data })));
}

export async function listByPart(partId) {
  return prisma.measurement.findMany({
    where: { partId: Number(partId) },
    orderBy: { capturedAt: 'desc' },
  });
}

/**
 * The most recent measurement of each type for a part.
 *
 * This is the "resolved view" the UI shows next to the Part record — useful for
 * spotting where the agreed value on Part has drifted from what was last
 * actually captured.
 */
export async function latestByPart(partId) {
  const rows = await listByPart(partId); // already newest-first
  const latest = {};
  for (const row of rows) {
    if (!latest[row.type]) latest[row.type] = row;
  }
  return latest;
}

/** Every measurement in a product, for the capture-history view. */
export async function listByProduct(productId) {
  return prisma.measurement.findMany({
    where: { part: { subAssembly: { productId: Number(productId) } } },
    orderBy: { capturedAt: 'desc' },
    include: { part: { select: { id: true, name: true } } },
  });
}

/** @returns {Promise<boolean>} false when the id did not exist */
export async function remove(id) {
  try {
    await prisma.measurement.delete({ where: { id: Number(id) } });
    return true;
  } catch (err) {
    if (err.code === 'P2025') return false;
    throw err;
  }
}