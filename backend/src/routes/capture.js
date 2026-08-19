// ---------------------------------------------------------------------------
// src/routes/capture.js — HTTP surface for the teardown ingestion endpoint.
//
// Mounted at /api/capture (see src/index.js).
//
// Same discipline as routes/products.js and routes/reports.js: pull values
// off the request, call captureService, send JSON. No Prisma, no validation
// beyond what belongs to HTTP — the service throws HttpErrors and the error
// middleware in index.js converts them.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import * as captureService from '../services/captureService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

/**
 * GET /api/capture/types
 * The measurement types and default operator identity the capture form needs
 * to render its fields and validate before it ever calls the API.
 */
router.get(
  '/types',
  asyncHandler(async (_req, res) => {
    res.json({ data: captureService.getCaptureTypes() });
  }),
);

/**
 * POST /api/capture/part/:partId
 * One or more readings for a single part — what the HID capture form sends as
 * it steps through length, width, height, weight.
 */
router.post(
  '/part/:partId',
  asyncHandler(async (req, res) => {
    const data = await captureService.captureForPart(req.params.partId, req.body);
    res.status(201).json({ data });
  }),
);

/**
 * POST /api/capture
 * Flexible batch ingestion — a flat list of readings that may span several
 * parts. The entry point for a future capture rig upload, and for backfilling
 * measurements outside the guided single-part flow.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = await captureService.captureBatch(req.body);
    res.status(201).json({ data });
  }),
);

export default router;
