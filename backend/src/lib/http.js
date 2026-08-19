// ---------------------------------------------------------------------------
// src/lib/http.js — the two pieces of plumbing every route file needs.
// ---------------------------------------------------------------------------

/**
 * An error that carries an HTTP status.
 *
 * WHY: without this, services have to either return `null` and let every route
 * write its own `if (!x) return res.status(404)...` (repetitive, easy to
 * forget), or import `res` (which would couple the service layer to Express and
 * defeat the point of having one). Throwing a status-carrying error lets the
 * service say "this is a 404" without knowing what Express is.
 */
export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg) => new HttpError(404, msg);

/**
 * Wrap an async route handler so rejected promises reach the error middleware.
 *
 * Express 5 does this automatically; Express 4 does not — an unhandled
 * rejection there just hangs the request until the client times out, with no
 * log line, which is a genuinely awful thing to debug live. `npm install
 * express` today gives you 5.x, so this is belt-and-braces: harmless on 5,
 * essential if anything ever pins 4.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Parse a route param that must be a positive integer.
 *
 * Centralised because `Number('abc')` is NaN and Prisma would otherwise receive
 * NaN and throw a 500. A malformed id is the client's mistake — it should read
 * as 400, not as the server falling over.
 */
export function parseId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw badRequest(`${label} must be a positive integer, got: ${value}`);
  }
  return n;
}