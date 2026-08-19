// ---------------------------------------------------------------------------
// src/data/costRepository.js
//
// SCOPE BOUNDARY — worth being explicit about, because it's the line teams
// usually blur:
//   This file FETCHES cost rows. It does not decide what a cost *means*.
//   Rollups, per-product totals, product-vs-product deltas and anything the
//   Cost Engineer persona actually reads on screen belong in
//   services/benchmarkService.js.
//
// Keeping arithmetic out of the repository keeps the benchmarking logic in
// plain, readable JavaScript you can point at during the demo — rather than
// buried in SQL that would have to be rewritten for Snowflake anyway.
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';

/** Default currency for the MVP. Single-currency by design — no FX in scope. */
const DEFAULT_CURRENCY = 'USD';

function toCost(value, field) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Cost.${field} must be numeric, got: ${value}`);
  if (n < 0) throw new Error(`Cost.${field} cannot be negative, got: ${n}`);
  return n;
}

/**
 * Exported as `normaliseCost` at the bottom of this file, for the same reason
 * partRepository exports its normalise(): productRepository's BOM-import nested
 * write needs it, and one shared normaliser beats two that can drift.
 */
function normalise(input) {
  return {
    materialCost: toCost(input.materialCost, 'materialCost'),
    processCost: toCost(input.processCost, 'processCost'),
    labourCost: toCost(input.labourCost, 'labourCost'),
    currency: input.currency || DEFAULT_CURRENCY,
  };
}

/**
 * Create or replace the cost row for a part.
 *
 * Upsert rather than create, because the schema allows exactly one cost row per
 * part (@@unique([partId])). Re-running the seed or re-submitting the cost form
 * updates in place instead of erroring or duplicating.
 */
export async function upsertForPart(partId, input) {
  const pid = Number(partId);
  const data = normalise(input);

  return prisma.cost.upsert({
    where: { partId: pid },
    update: data,
    create: { partId: pid, ...data },
  });
}

/** @returns {Promise<object|null>} the cost row for a part, or null */
export async function getByPart(partId) {
  return prisma.cost.findUnique({ where: { partId: Number(partId) } });
}

/**
 * Every cost row in a product, with enough part context to group by material or
 * sub-assembly downstream.
 *
 * Returns a flat array on purpose — flat rows are what the benchmark service's
 * reduce() calls and Recharts both want. Re-nesting would just be undone.
 */
export async function listByProduct(productId) {
  const rows = await prisma.cost.findMany({
    where: { part: { subAssembly: { productId: Number(productId) } } },
    include: {
      part: {
        select: {
          id: true,
          name: true,
          material: true,
          quantity: true,
          weightG: true,
          subAssembly: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Flatten the nested include into one row per cost record.
  return rows.map((row) => ({
    costId: row.id,
    partId: row.partId,
    partName: row.part.name,
    material: row.part.material,
    quantity: row.part.quantity,
    weightG: row.part.weightG,
    subAssemblyId: row.part.subAssembly.id,
    subAssemblyName: row.part.subAssembly.name,
    materialCost: row.materialCost,
    processCost: row.processCost,
    labourCost: row.labourCost,
    currency: row.currency,
  }));
}

export { normalise as normaliseCost };

/** @returns {Promise<boolean>} false when the part had no cost row */
export async function removeForPart(partId) {
  try {
    await prisma.cost.delete({ where: { partId: Number(partId) } });
    return true;
  } catch (err) {
    if (err.code === 'P2025') return false;
    throw err;
  }
}