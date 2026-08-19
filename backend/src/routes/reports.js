// ---------------------------------------------------------------------------
// src/routes/reports.js — HTTP surface for persona reports and comparison.
//
// Mounted at /api/reports (see src/index.js).
//
// Same discipline as routes/products.js: pull values off the request, call
// benchmarkService, send JSON. No arithmetic, no Prisma, no status-code
// branching — the service throws HttpErrors and the middleware in index.js
// converts them.
//
// GET  = read (generates on first request, then serves the snapshot)
// POST = explicitly (re)generate a snapshot
//
// That split matters: GET stays safe to refresh, retry, or hit from the address
// bar, while "recompute now" is a deliberate action.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import * as benchmarkService from '../services/benchmarkService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

// ---------------------------------------------------------------------------
// ⚠ ROUTE ORDER — two literal paths must be declared before the param routes
// that would otherwise swallow them:
//
//   /compare            would match /:productId  -> 400 "not an integer"
//   /:id/history        would match /:id/:persona -> 400 "unknown persona"
//
// Both produce error messages that point at the wrong thing entirely. Keep the
// literals above the params.
// ---------------------------------------------------------------------------

/**
 * GET /api/reports/compare?ids=1,2,3
 *
 * Product-vs-product summary. First id is the baseline; every delta is stated
 * against it. Returns per-product totals, deltas, and pre-shaped chart series.
 */
router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    res.json({ data: await benchmarkService.compareProducts(req.query.ids) });
  }),
);

/**
 * GET /api/reports/best-of-best?ids=1,2,3
 *
 * The Competitive Intelligence Engine's headline view: per-metric and
 * per-module winners across 2–5 products, plus the composite "cheapest of every
 * module" target. No baseline — every product is ranked against every other.
 *
 * Declared up here with /compare for the same route-order reason: without it,
 * "best-of-best" would match /:productId and 400 as a non-integer id.
 */
router.get(
  '/best-of-best',
  asyncHandler(async (req, res) => {
    res.json({ data: await benchmarkService.buildBestOfBest(req.query.ids) });
  }),
);

/**
 * GET /api/reports/:productId/history
 * Metadata for previously generated reports — persona and timestamp, no payloads.
 */
router.get(
  '/:productId/history',
  asyncHandler(async (req, res) => {
    const data = await benchmarkService.listHistory(req.params.productId);
    res.json({ count: data.length, data });
  }),
);

/**
 * GET /api/reports/:productId/:persona[?refresh=true]
 *
 * The main read. Serves the last stored snapshot; computes one if none exists.
 * `?refresh=true` forces a recompute — use it after editing a teardown.
 *
 * `cached` is returned in the body on purpose: when a demo shows a number
 * someone disputes, the first question is "is that stale?", and the answer
 * should be visible rather than guessed at.
 */
router.get(
  '/:productId/:persona',
  asyncHandler(async (req, res) => {
    const { report, cached } = await benchmarkService.getReport(
      req.params.productId,
      req.params.persona,
      { refresh: req.query.refresh === 'true' },
    );
    res.json({ cached, data: report });
  }),
);

/**
 * POST /api/reports/:productId
 * Generate all three persona reports — the "run benchmarking" button.
 */
router.post(
  '/:productId',
  asyncHandler(async (req, res) => {
    const data = await benchmarkService.generateAllReports(req.params.productId);
    res.status(201).json({ data });
  }),
);

/**
 * POST /api/reports/:productId/:persona
 * Force a fresh snapshot for one persona.
 */
router.post(
  '/:productId/:persona',
  asyncHandler(async (req, res) => {
    const { report } = await benchmarkService.generateReport(
      req.params.productId,
      req.params.persona,
    );
    res.status(201).json({ data: report });
  }),
);

/**
 * DELETE /api/reports/:productId[?persona=cost_engineer]
 * Drop cached snapshots. Call after editing a teardown.
 */
router.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    const data = await benchmarkService.clearReports(
      req.params.productId,
      req.query.persona ?? null,
    );
    res.json({ data });
  }),
);

export default router;