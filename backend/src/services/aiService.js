// ---------------------------------------------------------------------------
// src/services/aiService.js
//
// THE STUB PATTERN — read this before touching the body of parseBOM.
//
// This is the seam CONTEXT.md calls out explicitly: the function signature
// here is the same one a real Azure OpenAI call will use on the work laptop.
// parseBOM takes exactly the input a real call would (raw BOM text, or a
// measurements array captured off the teardown rig) and returns exactly the
// shape a real call would (classified parts + a summary). Swapping the stub
// body for a real chat-completions call later should not touch anything that
// imports this module.
//
// The canned catalog below is invented and generic on purpose — see
// db/seed.js's note on the same point. This is a proof-of-concept for the
// ingestion pipeline, not an attempt at real part classification.
// ---------------------------------------------------------------------------

import { badRequest } from '../lib/http.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A believable classification result, standing in for what a real model
 * would return. Ordered roughly by how confidently a vision/text model would
 * identify each part type — a barrel fan is visually unambiguous, a bracket
 * is not.
 */
const CANNED_CATALOG = [
  { name: 'Cross-Flow Fan Barrel', material: 'ABS', category: 'Fan Assembly', confidence: 0.94 },
  { name: 'Fan Motor', material: 'Steel / Copper', category: 'Fan Assembly', confidence: 0.9 },
  { name: 'Evaporator Coil Assembly', material: 'Copper / Aluminium', category: 'Heat Exchanger', confidence: 0.97 },
  { name: 'Condensate Drain Pan', material: 'PP', category: 'Heat Exchanger', confidence: 0.86 },
  { name: 'Main Control PCB', material: 'FR-4 / Mixed', category: 'Control Electronics', confidence: 0.91 },
  { name: 'Front Panel', material: 'ABS', category: 'Housing & Chassis', confidence: 0.88 },
  { name: 'Air Filter Screen', material: 'PP mesh', category: 'Housing & Chassis', confidence: 0.79 },
  { name: 'Motor Mount Bracket', material: 'Galvanised Steel', category: 'Fan Assembly', confidence: 0.71 },
];

/**
 * How many input lines/rows a real model would need to see before it starts
 * running out of distinct parts to name — capped at the catalog size. Purely
 * to make the demo feel responsive to what was actually pasted or captured,
 * not a claim about real extraction accuracy.
 */
function itemCountFor(input) {
  if (Array.isArray(input)) return input.length;
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

/**
 * Parse a raw BOM description into classified parts.
 *
 * @param {string|Array<object>} input
 *   Either raw BOM text (a pasted parts list / spec sheet excerpt) or a
 *   measurements array in the shape the capture rig produces. A real Azure
 *   OpenAI call would branch on the same union: text goes to a completions
 *   prompt, structured measurements go to a classification prompt.
 * @returns {Promise<{parts: Array<{name: string, material: string, category: string, confidence: number}>, summary: string}>}
 * @throws {HttpError} 400 when there is nothing to parse
 */
export async function parseBOM(input) {
  const hasText = typeof input === 'string' && input.trim().length > 0;
  const hasMeasurements = Array.isArray(input) && input.length > 0;
  if (!hasText && !hasMeasurements) {
    throw badRequest('parseBOM requires non-empty rawText or a measurements array');
  }

  // Stand in for real inference latency — a fixed instant response would be
  // the one thing in this demo that immediately reads as fake.
  await delay(800 + Math.random() * 500);

  const count = Math.min(Math.max(itemCountFor(input), 1), CANNED_CATALOG.length);
  const parts = CANNED_CATALOG.slice(0, count);
  const categories = new Set(parts.map((p) => p.category)).size;

  return {
    parts,
    summary:
      `Identified ${parts.length} part${parts.length === 1 ? '' : 's'} across ` +
      `${categories} sub-assembl${categories === 1 ? 'y' : 'ies'}.`,
  };
}
