// ---------------------------------------------------------------------------
// src/db/client.js — the single PrismaClient instance for the whole process.
//
// WHY A SINGLETON:
// Each `new PrismaClient()` opens its own connection pool. Under nodemon, every
// file save re-imports your modules; if the client were constructed at each
// import site you would leak a pool per reload and eventually hit "too many
// connections" (or, on SQLite, file-lock contention) minutes into a demo.
// Node's ESM module cache guarantees this file's body runs exactly once, so one
// export = one client.
//
// This is the ONLY file in the project allowed to construct a PrismaClient, and
// src/data/* are the only files allowed to import it.
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  // Query logging is genuinely useful while you're relearning the ORM — you see
  // the SQL Prisma generates for each call. Flip to ['error'] if it gets noisy.
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});
// 
/**
 * Close the connection cleanly.
 *
 * SQLite writes are buffered; killing the process mid-write can leave a stale
 * `-journal` file next to dev.db that makes the next start look corrupted.
 * Wire this into your shutdown handlers in src/index.js.
 */
export async function disconnect() {
  await prisma.$disconnect();
}

/**
 * Cheap liveness check for a GET /api/health route.
 *
 * Returns a plain boolean rather than throwing, so the route stays a two-liner.
 * `SELECT 1` is valid on SQLite, SQL Server and Postgres alike — this survives
 * the cloud swap untouched.
 */
export async function isHealthy() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}