// ---------------------------------------------------------------------------
// src/routes/photoLabels.js — mounted at /api/photo-labels
//
// The photo-label family for a part: list, allocate the next one in the series,
// attach one by hand, edit, remove, and look up which parts share a label.
//
// Allocation is a POST rather than a GET even though it reads to decide the next
// value, because it WRITES — the returned label is now taken. A GET that hands out
// a number nobody has claimed is how two engineers end up with the same sticker.
// ---------------------------------------------------------------------------

import { Router } from 'express';

import * as photoLabelService from '../services/photoLabelService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

/** Every label on a part, plus valid views and the next prefix. */
router.get(
  '/part/:partId',
  asyncHandler(async (req, res) => {
    res.json({ data: await photoLabelService.listForPart(req.params.partId) });
  }),
);

/** Allocate the next label in this part's series. */
router.post(
  '/part/:partId/allocate',
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await photoLabelService.allocate(req.params.partId, req.body) });
  }),
);

/** Attach a label the engineer typed. */
router.post(
  '/part/:partId',
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await photoLabelService.add(req.params.partId, req.body) });
  }),
);

/** Which parts carry this label. */
router.get(
  '/shared/:label',
  asyncHandler(async (req, res) => {
    res.json({ data: await photoLabelService.partsSharing(req.params.label) });
  }),
);

router.patch(
  '/:labelId',
  asyncHandler(async (req, res) => {
    res.json({ data: await photoLabelService.update(req.params.labelId, req.body) });
  }),
);

router.delete(
  '/:labelId',
  asyncHandler(async (req, res) => {
    res.json({ data: await photoLabelService.remove(req.params.labelId) });
  }),
);

export default router;
