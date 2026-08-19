// ---------------------------------------------------------------------------
// src/data/reportRepository.js
//
// This repository exists mostly to hide one SQLite limitation: there is no Json
// column type, so `payload` is stored as a string. Every JSON.stringify and
// JSON.parse in the entire project lives in this file. Services and routes pass
// and receive real objects and never learn that the storage is text.
//
// When this moves to Azure SQL (which has a real JSON type), you delete the two
// helper calls below and nothing upstream notices.
// ---------------------------------------------------------------------------

import { prisma } from '../db/client.js';

/**
 * The personas the app can generate reports for.
 *
 * Same reasoning as MEASUREMENT_TYPES: a code-level constant standing in for a
 * DB enum SQLite can't express.
 */
export const PERSONAS = Object.freeze({
  COST_ENGINEER: 'cost_engineer',
  DESIGN_ENGINEER: 'design_engineer',
  EXECUTIVE: 'executive',
});

const VALID_PERSONAS = Object.values(PERSONAS);

/** Storage shape -> application shape. The only JSON.parse in the project. */
function fromRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload: safeParse(row.payload),
  };
}

/**
 * Parse defensively.
 *
 * A row written by an older version of the payload shape shouldn't crash the
 * reports page — you'd rather render "this report is unreadable, regenerate it"
 * than throw a 500 mid-demo. Returns a marker object instead of throwing.
 */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { _unparseable: true, raw: text };
  }
}

function assertPersona(persona) {
  if (!VALID_PERSONAS.includes(persona)) {
    throw new Error(
      `persona must be one of ${VALID_PERSONAS.join(', ')} — got: ${persona}`,
    );
  }
}

/**
 * Persist a generated report snapshot.
 *
 * @param {number} productId
 * @param {string} persona   one of PERSONAS
 * @param {object} payload   the computed view — a real object, not a string
 */
export async function save(productId, persona, payload) {
  assertPersona(persona);
  if (payload === null || typeof payload !== 'object') {
    throw new Error('report payload must be an object');
  }

  const row = await prisma.report.create({
    data: {
      productId: Number(productId),
      persona,
      payload: JSON.stringify(payload), // the only JSON.stringify in the project
    },
  });

  return fromRow(row);
}

/**
 * The newest report of a given persona for a product.
 *
 * Lets the reports page render instantly from the last snapshot and only
 * recompute when the user asks — which is both faster and a nicer demo beat
 * than a spinner on every tab switch.
 *
 * @returns {Promise<object|null>} null when none has been generated yet
 */
export async function getLatest(productId, persona) {
  assertPersona(persona);

  const row = await prisma.report.findFirst({
    where: { productId: Number(productId), persona },
    orderBy: { generatedAt: 'desc' },
  });

  return fromRow(row);
}

/** @returns {Promise<object|null>} */
export async function getById(id) {
  const row = await prisma.report.findUnique({ where: { id: Number(id) } });
  return fromRow(row);
}

/**
 * Report history for a product.
 *
 * Omits `payload` deliberately — a history list only needs persona and
 * timestamp, and parsing N payloads to render N rows of metadata is waste.
 */
export async function listByProduct(productId) {
  return prisma.report.findMany({
    where: { productId: Number(productId) },
    orderBy: { generatedAt: 'desc' },
    select: { id: true, productId: true, persona: true, generatedAt: true },
  });
}

/**
 * Drop stored reports for a product, optionally just one persona.
 *
 * Call this after a teardown is edited: a cached report computed from stale
 * parts is worse than no report at all, because it looks authoritative.
 *
 * @returns {Promise<number>} how many rows were deleted
 */
export async function clearForProduct(productId, persona = null) {
  if (persona) assertPersona(persona);

  const { count } = await prisma.report.deleteMany({
    where: {
      productId: Number(productId),
      ...(persona ? { persona } : {}),
    },
  });

  return count;
}