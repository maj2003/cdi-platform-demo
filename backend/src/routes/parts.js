// ---------------------------------------------------------------------------
// src/routes/parts.js — HTTP surface for editing a single part.
//
// Mounted at /api/parts (see src/index.js). Parts are addressed directly by
// id here rather than nested under /api/products/:id, matching how
// routes/capture.js already treats part ids as directly addressable
// (POST /api/capture/part/:partId) — one convention for "operate on a known
// part," not two.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import * as partService from '../services/partService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

/**
 * POST /api/parts
 * Body: { subAssemblyId, name, ...any other Part column }
 *
 * The BOM Authoring Workbench's "Add Part". Accepts the same field names the
 * CEDARS importer and the seed use, so all three write through one allow-list.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const created = await partService.createPart(req.body);
    res.status(201).location(`/api/parts/${created.id}`).json({ data: created });
  }),
);

/** DELETE /api/parts/:id — cascades to the part's costs and measurements. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await partService.deletePart(req.params.id) });
  }),
);

/**
 * PATCH /api/parts/:id
 * Partial update — geometryType and the geometry-specific dimension fields
 * today (see the Geometry editor on Product Detail), but accepts any subset
 * of Part's own columns since partRepository.update() already does.
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = await partService.updatePart(req.params.id, req.body);
    res.json({ data });
  }),
);

export default router;
