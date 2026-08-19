// ---------------------------------------------------------------------------
// src/data/subAssemblyRepository.js
//
// Thin by design. Sub-assemblies are usually read as part of the product tree
// (see productRepository.getTeardown), so this file only covers the cases where
// you need one on its own — mainly the capture flow.
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';

/**
 * @returns {Promise<Array<object>>} sub-assemblies for a product, each with a
 *   `partCount` for list rendering
 */
export async function listByProduct(productId) {
  const rows = await prisma.subAssembly.findMany({
    where: { productId: Number(productId) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { parts: true } } },
  });

  return rows.map(({ _count, ...sub }) => ({ ...sub, partCount: _count.parts }));
}

/**
 * @returns {Promise<object|null>} the sub-assembly with its parts, or null
 */
export async function getById(id) {
  return prisma.subAssembly.findUnique({
    where: { id: Number(id) },
    include: { parts: { orderBy: { name: 'asc' } } },
  });
}

export async function create({ productId, name, description = null }) {
  if (!productId || !name) {
    throw new Error('createSubAssembly requires productId and name');
  }
  return prisma.subAssembly.create({
    data: { productId: Number(productId), name, description },
  });
}

/**
 * Find by (productId, name) or create.
 *
 * Not a true DB upsert — there is no unique constraint on (productId, name),
 * because in a real teardown two sub-assemblies can legitimately share a name.
 * The seed needs idempotency though, so this does the lookup explicitly. The
 * honest tradeoff: it is racy under concurrent writes, which a local single-
 * user MVP never sees. Revisit if this ever runs behind a real API.
 */
export async function findOrCreate({ productId, name, description = null }) {
  const existing = await prisma.subAssembly.findFirst({
    where: { productId: Number(productId), name },
  });
  if (existing) return existing;
  return create({ productId, name, description });
}

export async function update(id, patch) {
  const allowed = ['name', 'description'];
  const data = Object.fromEntries(
    Object.entries(patch).filter(([k]) => allowed.includes(k)),
  );
  if (Object.keys(data).length === 0) return getById(id);

  try {
    return await prisma.subAssembly.update({ where: { id: Number(id) }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

/** @returns {Promise<boolean>} false when the id did not exist */
export async function remove(id) {
  try {
    await prisma.subAssembly.delete({ where: { id: Number(id) } });
    return true;
  } catch (err) {
    if (err.code === 'P2025') return false;
    throw err;
  }
}