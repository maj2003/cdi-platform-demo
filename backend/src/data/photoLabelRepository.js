// ---------------------------------------------------------------------------
// src/data/photoLabelRepository.js
//
// The photo-label family for a part, and the allocator that hands out the next
// label. Only this file touches the PhotoLabel table.
//
// ---------------------------------------------------------------------------
// WHY ALLOCATION IS ON THE SERVER
//
// The labels are physically written on parts and printed onto stickers, so two
// engineers must never be handed the same one. "Read the highest label, add one"
// is safe in one browser and a collision the moment there are two — the classic
// read-modify-write race, except the losing side has already stuck a duplicate
// label on a part and photographed it. So the next label is computed and INSERTED
// inside one transaction, and the unique constraint on (partId, label) is the
// backstop rather than the plan.
//
// ---------------------------------------------------------------------------
// WHY Part.photoId IS MAINTAINED ALONGSIDE
//
// Part.photoId holds the family's LEAD label (position 0). The Engineering BOM
// View renders it as a column and filters on its absence across 124 rows; making
// that a join to display one label out of seven would be a real cost for no gain.
// Every function here that can change which label leads calls syncLeadLabel, so
// the mirror cannot drift from the family.
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';

/** The faces a shot can be of. "Detail" is the escape hatch for close-ups. */
export const PHOTO_VIEWS = Object.freeze([
  'Top',
  'Front',
  'Left',
  'Right',
  'Rear',
  'ISO',
  'Detail',
]);

/**
 * Trimmed, upper-cased. Mirrors partRepository's normalisePhotoId so a label
 * written "fj0010" and a photo stored under "FJ0010" always meet.
 * @returns {string|null} null for blank
 */
export function normaliseLabel(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

/** Reject a view we don't know rather than storing a typo as a face. */
function normaliseView(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = PHOTO_VIEWS.find((v) => v.toLowerCase() === String(value).trim().toLowerCase());
  if (!match) {
    throw new Error(`PhotoLabel.view must be one of ${PHOTO_VIEWS.join(', ')} — got: ${value}`);
  }
  return match;
}

const ORDER = Object.freeze([{ position: 'asc' }, { id: 'asc' }]);

/**
 * A part with the product it belongs to, in ONE query.
 *
 * Every entry point here needs both — the part to attach a label to, and the
 * product to scope the label series and to clear cached reports for. Walking
 * part -> subAssembly -> product through three service calls would be three round
 * trips to answer a question the relation already answers.
 *
 * @returns {Promise<{part: object, productId: number, product: object}|null>}
 */
export async function getPartWithProduct(partId) {
  const part = await prisma.part.findUnique({
    where: { id: Number(partId) },
    include: { subAssembly: { include: { product: true } } },
  });
  if (!part) return null;
  return {
    part,
    productId: part.subAssembly.productId,
    product: part.subAssembly.product,
  };
}

/** Every label on a part, lead first. */
export async function listForPart(partId) {
  return prisma.photoLabel.findMany({ where: { partId: Number(partId) }, orderBy: ORDER });
}

/** Labels for many parts at once, so a page can load a whole teardown's families. */
export async function listForParts(partIds) {
  if (!partIds?.length) return [];
  return prisma.photoLabel.findMany({
    where: { partId: { in: partIds.map(Number) } },
    orderBy: ORDER,
  });
}

/** Every part carrying this label — the "shared with N other parts" lookup. */
export async function findPartsByLabel(label) {
  const normalised = normaliseLabel(label);
  if (!normalised) return [];
  return prisma.photoLabel.findMany({
    where: { label: normalised },
    include: { part: { select: { id: true, name: true, subAssemblyId: true } } },
    orderBy: ORDER,
  });
}

/**
 * Point Part.photoId at whatever now leads the family (or null if it's empty).
 *
 * Always called inside the caller's transaction, so a part is never briefly
 * advertising a label that no longer exists.
 */
async function syncLeadLabel(tx, partId) {
  const [lead] = await tx.photoLabel.findMany({
    where: { partId: Number(partId) },
    orderBy: ORDER,
    take: 1,
  });
  await tx.part.update({
    where: { id: Number(partId) },
    data: { photoId: lead?.label ?? null },
  });
  return lead ?? null;
}

/**
 * Split "FJ0010" into its prefix and numeric tail.
 *
 * The width matters as much as the number: the reference labels are zero-padded
 * ("FJ0010", not "FJ10"), and losing the padding would make the printed stickers
 * inconsistent halfway through a teardown.
 *
 * @returns {{prefix: string, number: number, width: number}|null}
 */
export function splitLabel(label) {
  const match = /^(.*?)(\d+)$/.exec(normaliseLabel(label) ?? '');
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]), width: match[2].length };
}

/** Re-join a prefix and number, preserving the zero padding. */
export function formatLabel(prefix, number, width) {
  return `${prefix}${String(number).padStart(width, '0')}`;
}

/**
 * Allocate the next label in a series and attach it to a part, atomically.
 *
 * The series is identified by PREFIX and scoped to the product, not to the part:
 * "FJ" runs across a whole teardown, so part 9's labels continue where part 8's
 * stopped. That's what the reference workflow's "FJ0010 → 0011, 0012, 0013, 17"
 * describes — one continuous run of stickers, handed out as parts come apart.
 *
 * @param {object} args
 * @param {number} args.partId
 * @param {string} args.prefix     e.g. "FJ"
 * @param {number} [args.width=4]  zero-padded width of the numeric tail
 * @param {string} [args.view]     the face this shot is of, if already known
 * @returns {Promise<object>} the created PhotoLabel
 */
export async function allocateForPart({ partId, prefix, width = 4, view }) {
  const id = Number(partId);
  const cleanPrefix = normaliseLabel(prefix) ?? '';
  const resolvedView = normaliseView(view);

  return prisma.$transaction(async (tx) => {
    const part = await tx.part.findUnique({
      where: { id },
      select: { id: true, subAssembly: { select: { productId: true } } },
    });
    if (!part) throw new Error(`No part with id ${id}`);

    // Scan the whole PRODUCT's labels, not just this part's, so the series is
    // continuous across a teardown. `startsWith` then a numeric compare in JS:
    // SQLite cannot order by a substring cast to an integer, and a teardown's
    // label count is in the hundreds, not millions.
    const existing = await tx.photoLabel.findMany({
      where: {
        label: { startsWith: cleanPrefix },
        part: { subAssembly: { productId: part.subAssembly.productId } },
      },
      select: { label: true },
    });

    let next = 1;
    let resolvedWidth = width;
    for (const row of existing) {
      const parsed = splitLabel(row.label);
      if (!parsed || parsed.prefix !== cleanPrefix) continue;
      if (parsed.number >= next) next = parsed.number + 1;
      // Follow the padding already in use rather than imposing the default, so a
      // series started as "FJ010" keeps three digits.
      resolvedWidth = Math.max(resolvedWidth, parsed.width);
    }

    const count = await tx.photoLabel.count({ where: { partId: id } });
    const created = await tx.photoLabel.create({
      data: {
        partId: id,
        label: formatLabel(cleanPrefix, next, resolvedWidth),
        view: resolvedView,
        position: count,
      },
    });

    await syncLeadLabel(tx, id);
    return created;
  });
}

/**
 * Attach a label the engineer typed themselves.
 *
 * Kept separate from allocateForPart because the two have different failure
 * modes: an allocation cannot collide by construction, whereas a typed label can
 * already be on this part, and that has to be reported rather than silently
 * de-duplicated — the engineer needs to know the sticker they're holding is
 * already stuck to something.
 */
export async function addToPart({ partId, label, view }) {
  const id = Number(partId);
  const normalised = normaliseLabel(label);
  if (!normalised) throw new Error('A photo label cannot be blank.');
  const resolvedView = normaliseView(view);

  return prisma.$transaction(async (tx) => {
    const count = await tx.photoLabel.count({ where: { partId: id } });
    const created = await tx.photoLabel.create({
      data: { partId: id, label: normalised, view: resolvedView, position: count },
    });
    await syncLeadLabel(tx, id);
    return created;
  });
}

/** Change a label's view, or its text. */
export async function updateLabel(labelId, { label, view } = {}) {
  const id = Number(labelId);
  const data = {};
  if (label !== undefined) {
    const normalised = normaliseLabel(label);
    if (!normalised) throw new Error('A photo label cannot be blank.');
    data.label = normalised;
  }
  if (view !== undefined) data.view = normaliseView(view);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.photoLabel.update({ where: { id }, data });
    await syncLeadLabel(tx, updated.partId);
    return updated;
  });
}

/**
 * Remove a label and close the gap in `position`.
 *
 * Renumbering matters because position 0 IS the lead label: deleting the lead
 * without resequencing would leave the family starting at 1 and the next
 * syncLeadLabel picking correctly by chance rather than by rule.
 */
export async function removeLabel(labelId) {
  const id = Number(labelId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.photoLabel.findUnique({ where: { id } });
    if (!existing) return null;

    await tx.photoLabel.delete({ where: { id } });

    const remaining = await tx.photoLabel.findMany({
      where: { partId: existing.partId },
      orderBy: ORDER,
    });
    await Promise.all(
      remaining.map((row, index) =>
        row.position === index
          ? null
          : tx.photoLabel.update({ where: { id: row.id }, data: { position: index } }),
      ),
    );

    await syncLeadLabel(tx, existing.partId);
    return existing;
  });
}
