// ---------------------------------------------------------------------------
// src/index.js — Express app entry point.
//
// RUN:  npm run dev        (nodemon)
//       npm start          (plain node)
//
// Layering, top to bottom:
//   index.js  -> routes/  -> services/  -> data/  -> db/client.js -> SQLite
// Each layer only knows the one below it. That is what makes the eventual
// Azure/Snowflake swap a change to data/ alone.
// ---------------------------------------------------------------------------

import 'dotenv/config'; // must come first — later imports may read process.env

import express from 'express';
import cors from 'cors';

import productRoutes from './routes/products.js';
import reportRoutes from './routes/reports.js';
import captureRoutes from './routes/capture.js';
import aiRoutes from './routes/ai.js';
import partRoutes from './routes/parts.js';
import moduleRoutes from './routes/modules.js';
import photoLabelRoutes from './routes/photoLabels.js';
import { isHealthy, disconnect } from './data/index.js';
import { HttpError } from './lib/http.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// ---------------------------------------------------------------------------
// CORS
//
// The frontend runs on its own origin in development (Vite: 5173), so the
// browser treats every API call as cross-origin and blocks it without these
// headers. This is THE most common "the backend works in the browser bar but
// the app shows a blank page" cause.
//
// An explicit allowlist rather than `cors()` with no arguments: the wide-open
// default is fine locally but is exactly the sort of thing that survives a
// copy-paste onto a real deployment. Add origins via CORS_ORIGIN (comma-sep).
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // `!origin` covers curl, Postman and same-origin navigation — requests
      // with no Origin header aren't subject to CORS in the first place.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new HttpError(403, `Origin not allowed by CORS: ${origin}`));
    },
  }),
);

// 8mb ceiling. Still no files — the BOM import parses the .xlsx in the browser
// and POSTs rows as JSON, so the biggest body this app sees is a parsed BOM at
// importService's 2000-part cap (order of 1mb). Raised from 2mb to leave real
// headroom above that rather than sitting just under it. Images will go through
// multipart on a separate route later.
app.use(express.json({ limit: '8mb' }));

/**
 * One-line request log.
 *
 * Deliberately hand-rolled rather than pulling in morgan — it is six lines, it
 * has no dependency, and during a demo you want to see at a glance whether the
 * frontend is actually reaching the API.
 */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/health — is the process up AND can it reach the database?
 *
 * Checking the DB rather than just returning 200 matters: "server is running
 * but the SQLite file moved" is a real failure mode, and a health check that
 * can't detect it isn't worth having.
 */
app.get('/api/health', async (_req, res) => {
  const dbOk = await isHealthy();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'connected' : 'unreachable',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/products', productRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/capture', captureRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/photo-labels', photoLabelRoutes);

// ---------------------------------------------------------------------------
// 404 — anything that reached here matched no route.
// Note: `app.use(handler)` rather than `app.get('*')`, because Express 5
// changed wildcard path syntax and '*' now throws at startup.
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.originalUrl}` } });
});

// ---------------------------------------------------------------------------
// Error handler.
//
// Must be LAST and must take four arguments — Express identifies error
// middleware by arity, so dropping the unused `next` silently turns this into
// a normal handler that never runs. Nothing warns you.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;

  // Expected errors (400/404/409) are normal traffic — log them at one line.
  // Unexpected ones get a full stack, because those are the ones you need.
  if (status >= 500) console.error(err);
  else console.warn(`  ${status}: ${err.message}`);

  res.status(status).json({
    error: {
      message: status >= 500 ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
});

// ---------------------------------------------------------------------------
// Start + graceful shutdown
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`\n  Daikin Benchmarking API`);
  console.log(`  → http://localhost:${PORT}/api/health`);
  console.log(`  → http://localhost:${PORT}/api/products`);
  console.log(`  → http://localhost:${PORT}/api/reports/1/executive`);
  console.log(`  → http://localhost:${PORT}/api/reports/compare?ids=1,2,3`);
  console.log(`  → http://localhost:${PORT}/api/capture/types`);
  console.log(`  → http://localhost:${PORT}/api/ai/parse-bom`);
  console.log(`  → http://localhost:${PORT}/api/parts/:id (PATCH)`);
  console.log(`  → http://localhost:${PORT}/api/products/import (POST)`);
  console.log(`  → http://localhost:${PORT}/api/modules (POST) · /api/parts (POST) — BOM authoring`);
  console.log(`  CORS allows: ${ALLOWED_ORIGINS.join(', ')}\n`);
});

/**
 * Close the HTTP server and the DB connection before exiting.
 *
 * Without this, Ctrl+C can kill the process mid-write and leave a stale
 * `dev.db-journal` beside the database that makes the next start look corrupt.
 */
async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down.`);
  server.close(async () => {
    await disconnect();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app; // exported for tests