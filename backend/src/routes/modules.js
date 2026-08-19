// ---------------------------------------------------------------------------
// src/routes/modules.js — HTTP surface for authoring a teardown's modules.
//
// Mounted at /api/modules (see src/index.js).
//
// Modules are addressed directly by id, the same convention routes/parts.js and
// routes/capture.js already use for parts: "operate on a known record" lives at
// its own resource rather than nested three levels under a product.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import * as subAssemblyService from '../services/subAssemblyService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

/**
 * POST /api/modules
 * Body: { productId, name, description? }
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const created = await subAssemblyService.createModule(req.body);
    res.status(201).json({ data: created });
  }),
);

/**
 * DELETE /api/modules/:id
 * Refuses a module that still has parts — see subAssemblyService.deleteModule.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await subAssemblyService.deleteModule(req.params.id) });
  }),
);

export default router;
