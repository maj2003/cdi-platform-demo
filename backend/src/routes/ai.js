// ---------------------------------------------------------------------------
// src/routes/ai.js — HTTP surface for the stubbed AI layer.
//
// Mounted at /api/ai (see src/index.js).
//
// Same discipline as every other route file: pull values off the request,
// call the service, send JSON. The route doesn't know aiService is a stub —
// that knowledge is entirely inside aiService.js, which is the point.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import * as aiService from '../services/aiService.js';
import * as askService from '../services/askService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

/**
 * GET /api/ai/ask/examples
 * The example questions the prompt UI offers. Served from the service rather
 * than hardcoded in the frontend so the examples can't drift from the question
 * shapes the parser actually handles.
 */
router.get('/ask/examples', (_req, res) => {
  res.json({ data: { examples: askService.EXAMPLE_QUESTIONS } });
});

/**
 * POST /api/ai/ask
 * Body: { question: string }
 *
 * Lives under /api/ai because that's where a real model-backed answer would go,
 * but note askService is NOT a stub — every figure it returns is live benchmark
 * data. Only the language layer is rule-based. See askService.js's header.
 */
router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    res.json({ data: await askService.ask(req.body?.question) });
  }),
);

/**
 * POST /api/ai/parse-bom
 * Body: { rawText: string } or { measurements: Array<object> } — exactly one.
 */
router.post(
  '/parse-bom',
  asyncHandler(async (req, res) => {
    const input = Array.isArray(req.body?.measurements) ? req.body.measurements : req.body?.rawText;
    const data = await aiService.parseBOM(input);
    res.json({ data });
  }),
);

export default router;
