// ---------------------------------------------------------------------------
// src/routes/products.js — HTTP surface for products and teardowns.
//
// Mounted at /api/products (see src/index.js).
//
// Routes do three things and nothing else: pull values off the request, call a
// service, send JSON. No Prisma, no business rules, no `if (!x) 404` — the
// service throws an HttpError and the error middleware in index.js turns it
// into a status code. If a handler in here grows past ~4 lines, the logic
// belongs in productService.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import * as productService from '../services/productService.js';
import * as importService from '../services/importService.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

// ---------------------------------------------------------------------------
// ⚠ ROUTE ORDER MATTERS HERE.
//
// Express matches top-down, so a literal path that could also look like a
// param — /compare vs /:id — must be declared FIRST. Declared after /:id,
// a request to /api/products/compare would match /:id with id="compare",
// fail parseId, and return a confusing 400 about "compare" not being an
// integer. Classic Express footgun; costs an hour if you hit it cold.
// ---------------------------------------------------------------------------

/**
 * GET /api/products/compare?ids=1,2,3
 * Full teardowns for 2–5 products, for side-by-side views.
 */
router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const data = await productService.compareTeardowns(req.query.ids);
    res.json({ count: data.length, data });
  }),
);

/**
 * POST /api/products/import
 * Create a whole product from a parsed CEDARS BOM.
 *
 * Body: { product: {name, brand, category, notes?}, parts: [...], replaceExisting? }
 * The .xlsx itself is parsed in the browser — see importService.js's header for
 * why. Declared up here with /compare for the same route-order reason, even
 * though POST /:id doesn't exist today: the next person to add one shouldn't
 * have to rediscover the footgun.
 */
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const { product, summary } = await importService.importBom(req.body);
    res.status(201).location(`/api/products/${product.id}`).json({ data: { product, summary } });
  }),
);

/**
 * GET /api/products
 * Shallow list with subAssemblyCount. The index page and picker.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const data = await productService.listProducts();
    res.json({ count: data.length, data });
  }),
);

/** GET /api/products/:id — the product row alone, no tree. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await productService.getProduct(req.params.id) });
  }),
);

/**
 * GET /api/products/:id/teardown
 * The full tree plus a counts block. This is the main read for the app.
 */
router.get(
  '/:id/teardown',
  asyncHandler(async (req, res) => {
    res.json({ data: await productService.getTeardown(req.params.id) });
  }),
);

/** GET /api/products/:id/parts — flat parts across all sub-assemblies. */
router.get(
  '/:id/parts',
  asyncHandler(async (req, res) => {
    const data = await productService.getParts(req.params.id);
    res.json({ count: data.length, data });
  }),
);

/** GET /api/products/:id/costs — flat cost rows; benchmarkService's input. */
router.get(
  '/:id/costs',
  asyncHandler(async (req, res) => {
    const data = await productService.getCosts(req.params.id);
    res.json({ count: data.length, data });
  }),
);

/** GET /api/products/:id/measurements — capture history, newest first. */
router.get(
  '/:id/measurements',
  asyncHandler(async (req, res) => {
    const data = await productService.getMeasurements(req.params.id);
    res.json({ count: data.length, data });
  }),
);

/** POST /api/products — { name, brand, category, notes? } */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const created = await productService.createProduct(req.body);
    // 201 + Location is the correct REST answer and costs nothing to get right.
    res.status(201).location(`/api/products/${created.id}`).json({ data: created });
  }),
);

/** PATCH /api/products/:id — partial update. */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await productService.updateProduct(req.params.id, req.body) });
  }),
);

/** DELETE /api/products/:id — cascades to the whole teardown tree. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await productService.deleteProduct(req.params.id) });
  }),
);

export default router;