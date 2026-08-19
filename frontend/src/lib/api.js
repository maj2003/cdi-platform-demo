// ---------------------------------------------------------------------------
// src/lib/api.js — the only file in the frontend that knows the API exists.
//
// Components import from here and never call fetch() directly. That gives one
// place to change the base URL, one place that understands the response
// envelope, one error type, and — when Entra ID auth arrives — one place to
// attach a bearer token.
//
// USAGE:
//   import api from '@/lib/api';
//   const products = await api.products.list();
//   const { report, cached } = await api.reports.get(1, 'cost_engineer');
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Base URL
//
// Vite exposes env vars on import.meta.env, and only ones prefixed VITE_ (the
// prefix is a safety rail: it stops a stray secret in .env being bundled into
// client-side JS that anyone can read).
//
// The `?.` matters — it lets this module be imported by a plain Node script for
// testing, where import.meta.env doesn't exist and a bare property access would
// throw before anything runs.
// ---------------------------------------------------------------------------
const API_BASE =
  import.meta.env?.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:4000/api';

/** How long before a request is considered dead. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * An error carrying the HTTP status, so components can branch on it:
 *
 *   catch (err) {
 *     if (err.status === 404) showEmptyState();
 *     else showError(err.message);
 *   }
 *
 * Without this, every caller is reduced to string-matching the message, which
 * breaks the moment someone rewords an error on the backend.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, url, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.details = details;
  }

  /** True for the "backend isn't running" case, which needs different UI. */
  get isNetworkError() {
    return this.status === 0;
  }
}

/** Build a query string, skipping null/undefined so callers can pass optionals. */
function qs(params = {}) {
  const usable = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!usable.length) return '';
  return `?${new URLSearchParams(usable).toString()}`;
}

/**
 * Combine a caller's AbortSignal with a timeout.
 *
 * Hand-rolled rather than AbortSignal.any(), which is recent enough that
 * browser support is worth not depending on for the sake of six lines. Returns
 * a cleanup function — call it in `finally` so a completed request doesn't
 * leave a timer pending.
 */
function withTimeout(callerSignal, ms) {
  const controller = new AbortController();

  // A flag, rather than aborting with a custom reason.
  //
  // `controller.abort(new Error('timeout'))` looks like the obvious way to mark
  // this, but fetch then rejects with that exact object — an Error named
  // "Error", not an AbortError — so the `err.name === 'AbortError'` check below
  // misses it and a timeout gets reported as "cannot reach the API". Aborting
  // with no argument keeps the standard AbortError; the flag records why.
  const state = { timedOut: false };

  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, ms);

  const forward = () => controller.abort(callerSignal.reason);
  if (callerSignal) {
    if (callerSignal.aborted) forward();
    else callerSignal.addEventListener('abort', forward, { once: true });
  }

  return {
    signal: controller.signal,
    state,
    cleanup() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forward);
    },
  };
}

/**
 * The single fetch wrapper. Everything below goes through it.
 *
 * Returns the parsed response BODY, envelope and all — `{ data }`,
 * `{ count, data }` or `{ cached, data }`. Unwrapping happens in the endpoint
 * functions, because `cached` and `count` are real information and a client
 * that silently discarded them would be lying by omission.
 *
 * @param {string} path        e.g. '/products/1/teardown'
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.body]      serialised as JSON
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeout]
 * @throws {ApiError}
 */
async function request(path, { method = 'GET', body, signal, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${API_BASE}${path}`;
  const { signal: combined, state, cleanup } = withTimeout(signal, timeout);

  let response;
  try {
    response = await fetch(url, {
      method,
      signal: combined,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    cleanup();

    // Order matters: check the timeout flag before the caller's signal, since
    // both surface as an AbortError and only the flag distinguishes them.
    if (state.timedOut) {
      throw new ApiError(`Request timed out after ${timeout}ms: ${method} ${url}`, { url });
    }

    // A caller-initiated abort is not an error — it's a component unmounting.
    // Rethrow untouched so callers can `if (err.name === 'AbortError') return;`
    // instead of rendering an error banner for a cancelled request.
    if (err.name === 'AbortError') throw err;

    // fetch() rejects with a bare TypeError when it can't reach the host, and
    // the default message ("Failed to fetch") tells you nothing. This is the
    // single most common thing to hit in local dev, so name the likely cause.
    throw new ApiError(
      `Cannot reach the API at ${API_BASE}. Is the backend running (npm run dev)?`,
      { url, details: err.message },
    );
  }

  cleanup();

  // 204 or an empty body — nothing to parse.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    if (!response.ok) throw new ApiError(response.statusText, { status: response.status, url });
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response: usually a proxy error page or the dev server
    // answering instead of the API. Say so rather than "unexpected token <".
    throw new ApiError(
      `Expected JSON from ${url} but got ${response.headers.get('content-type') || 'no content-type'} (HTTP ${response.status})`,
      { status: response.status, url },
    );
  }

  if (!response.ok) {
    // The backend's shape is { error: { message, details? } }.
    throw new ApiError(payload?.error?.message || `HTTP ${response.status}`, {
      status: response.status,
      url,
      details: payload?.error?.details ?? null,
    });
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Personas
//
// Mirrors the backend's PERSONAS constant. Duplicated rather than imported
// because frontend/ and backend/ are separate npm packages — the honest home
// for this is shared/, once a Vite alias points there. Until then, changing a
// persona means changing it in both files. Small and worth flagging.
// ---------------------------------------------------------------------------
export const PERSONAS = Object.freeze({
  COST_ENGINEER: 'cost_engineer',
  DESIGN_ENGINEER: 'design_engineer',
  EXECUTIVE: 'executive',
});

export const PERSONA_LABELS = Object.freeze({
  cost_engineer: 'Cost Engineer',
  design_engineer: 'Design Engineer',
  executive: 'Executive',
});

// ---------------------------------------------------------------------------
// Endpoints
//
// Each function unwraps the envelope to the thing a component actually wants:
// arrays come back as arrays, single records as objects. Only reports.get keeps
// its envelope, because `cached` is worth showing in the UI.
//
// Every function takes an options object last so a React effect can pass
// `{ signal }` to cancel on unmount.
// ---------------------------------------------------------------------------

/** Is the API up and can it reach the database? */
export async function health(opts) {
  return request('/health', opts);
}

export const products = {
  /** @returns {Promise<Array>} products with subAssemblyCount */
  async list(opts) {
    return (await request('/products', opts)).data;
  },

  /** @returns {Promise<object>} the product row alone */
  async get(id, opts) {
    return (await request(`/products/${id}`, opts)).data;
  },

  /** @returns {Promise<object>} full tree + counts block */
  async teardown(id, opts) {
    return (await request(`/products/${id}/teardown`, opts)).data;
  },

  /** @returns {Promise<Array>} flat parts across all sub-assemblies */
  async parts(id, opts) {
    return (await request(`/products/${id}/parts`, opts)).data;
  },

  /** @returns {Promise<Array>} flat cost rows */
  async costs(id, opts) {
    return (await request(`/products/${id}/costs`, opts)).data;
  },

  /** @returns {Promise<Array>} capture history, newest first */
  async measurements(id, opts) {
    return (await request(`/products/${id}/measurements`, opts)).data;
  },

  /**
   * Full teardowns for 2–5 products.
   * @param {Array<number>|string} ids
   */
  async compare(ids, opts) {
    const list = Array.isArray(ids) ? ids.join(',') : ids;
    return (await request(`/products/compare${qs({ ids: list })}`, opts)).data;
  },

  /** @param {{name: string, brand: string, category: string, notes?: string}} body */
  async create(body, opts) {
    return (await request('/products', { ...opts, method: 'POST', body })).data;
  },

  /**
   * Create a whole product from a parsed CEDARS BOM.
   *
   * The .xlsx is parsed in the browser by lib/importCedarsBom.js — this sends
   * the resulting rows, not the file. A bigger body than anything else here, so
   * it gets a longer timeout: a 40-part import is quick but every part is an
   * individual INSERT inside one transaction, and SQLite on a laptop under a
   * cold Prisma client can take a few seconds.
   *
   * @param {{product: object, parts: Array<object>, replaceExisting?: boolean}} body
   * @returns {Promise<{product: object, summary: object}>}
   */
  async import(body, opts) {
    return (
      await request('/products/import', {
        timeout: 60_000,
        ...opts,
        method: 'POST',
        body,
      })
    ).data;
  },

  async update(id, patch, opts) {
    return (await request(`/products/${id}`, { ...opts, method: 'PATCH', body: patch })).data;
  },

  async remove(id, opts) {
    return (await request(`/products/${id}`, { ...opts, method: 'DELETE' })).data;
  },
};

export const reports = {
  /**
   * Fetch a persona report. Computed on first request, then served from the
   * stored snapshot.
   *
   * Returns the envelope, not just the payload: `cached` tells you whether the
   * numbers on screen were computed just now or read from an earlier snapshot,
   * and `generatedAt` is only meaningful alongside it.
   *
   * @returns {Promise<{report: object, payload: object, cached: boolean}>}
   */
  async get(productId, persona, { refresh = false, ...opts } = {}) {
    const body = await request(
      `/reports/${productId}/${persona}${qs({ refresh: refresh || undefined })}`,
      opts,
    );
    return { report: body.data, payload: body.data.payload, cached: body.cached };
  },

  /**
   * Product-vs-product comparison. First id is the baseline.
   * @returns {Promise<object>} { baselineProductId, products, comparisons, chartSeries }
   */
  async compare(ids, opts) {
    const list = Array.isArray(ids) ? ids.join(',') : ids;
    return (await request(`/reports/compare${qs({ ids: list })}`, opts)).data;
  },

  /**
   * Best-of-best leaderboards across 2–5 products.
   *
   * No baseline id — unlike compare(), every product is ranked against every
   * other, so order is presentational only.
   *
   * @param {Array<number>|string} ids
   * @returns {Promise<object>} { currency, products, productLeaders, overall,
   *   moduleLeaders, composite }
   */
  async bestOfBest(ids, opts) {
    const list = Array.isArray(ids) ? ids.join(',') : ids;
    return (await request(`/reports/best-of-best${qs({ ids: list })}`, opts)).data;
  },

  /** @returns {Promise<Array>} persona + timestamp, no payloads */
  async history(productId, opts) {
    return (await request(`/reports/${productId}/history`, opts)).data;
  },

  /** Generate all three personas — the "run benchmarking" button. */
  async generateAll(productId, opts) {
    return (await request(`/reports/${productId}`, { ...opts, method: 'POST' })).data;
  },

  /** Force a fresh snapshot for one persona. */
  async generate(productId, persona, opts) {
    return (await request(`/reports/${productId}/${persona}`, { ...opts, method: 'POST' })).data;
  },

  /**
   * Drop cached snapshots. Call after editing a teardown — a stale report still
   * renders and still carries a timestamp, which is worse than showing none.
   */
  async clear(productId, persona = null, opts) {
    return (
      await request(`/reports/${productId}${qs({ persona })}`, { ...opts, method: 'DELETE' })
    ).data;
  },
};

export const capture = {
  /** @returns {Promise<{types: object, defaultCapturedBy: string}>} */
  async types(opts) {
    return (await request('/capture/types', opts)).data;
  },

  /**
   * Submit one or more readings for a single part — what the HID capture form
   * sends as it steps through length, width, height, weight.
   * @param {number} partId
   * @param {{measurements: Array<{type: string, value: number, unit: string}>}} body
   * @returns {Promise<{part: object, measurements: Array}>}
   */
  async submitForPart(partId, body, opts) {
    return (await request(`/capture/part/${partId}`, { ...opts, method: 'POST', body })).data;
  },
};

export const ai = {
  /**
   * Classify a raw BOM description into parts. Stubbed on the backend today;
   * the same call shape a real Azure OpenAI request will use later.
   * @param {{rawText?: string, measurements?: Array}} body  exactly one of the two
   * @returns {Promise<{parts: Array<{name, material, category, confidence}>, summary: string}>}
   */
  async parseBom(body, opts) {
    return (await request('/ai/parse-bom', { ...opts, method: 'POST', body })).data;
  },

  /**
   * Ask a natural-language question about the benchmark set.
   *
   * Deterministic and backed by live data — the language layer is rule-based,
   * not a model (see backend askService.js). Same call shape a real
   * model-backed answer would use.
   *
   * @param {string} question
   * @returns {Promise<object>} { understood, intent, headline, stats, table,
   *   narrative, notes, sources, suggestions }
   */
  async ask(question, opts) {
    return (await request('/ai/ask', { ...opts, method: 'POST', body: { question } })).data;
  },

  /** @returns {Promise<Array<string>>} the example questions the parser handles */
  async askExamples(opts) {
    return (await request('/ai/ask/examples', opts)).data.examples;
  },
};

export const parts = {
  /**
   * Partially update a part — geometryType and dimension fields today (see
   * the Geometry editor on Product Detail). Only the keys present in `patch`
   * are touched server-side.
   * @param {number} id
   * @param {object} patch
   */
  async update(id, patch, opts) {
    return (await request(`/parts/${id}`, { ...opts, method: 'PATCH', body: patch })).data;
  },

  /**
   * Create a part inside a module — the BOM Authoring Workbench's "Add Part".
   *
   * Accepts the same field names the CEDARS importer and the seed use, so all
   * three write through one server-side allow-list.
   *
   * @param {{subAssemblyId: number, name: string, material?, quantity?, weightG?,
   *   lengthMm?, widthMm?, heightMm?, description?, photoId?}} body
   */
  async create(body, opts) {
    return (await request('/parts', { ...opts, method: 'POST', body })).data;
  },

  /** Delete a part. Cascades to its costs and measurements. */
  async remove(id, opts) {
    return (await request(`/parts/${id}`, { ...opts, method: 'DELETE' })).data;
  },
};

/**
 * Teardown modules (Level-1 sub-assemblies).
 *
 * Called "modules" here and on the wire because that's the word the teardown
 * process uses; the table is still SubAssembly. The translation lives in the
 * backend's subAssemblyService and nowhere else.
 */
export const modules = {
  /** @param {{productId: number, name: string, description?: string}} body */
  async create(body, opts) {
    return (await request('/modules', { ...opts, method: 'POST', body })).data;
  },

  /**
   * Delete a module. The server REFUSES a module that still has parts (409) —
   * deleting one would cascade through its parts, costs and captures.
   */
  async remove(id, opts) {
    return (await request(`/modules/${id}`, { ...opts, method: 'DELETE' })).data;
  },
};

/**
 * A part's photo-label family — the labels physically written on it and printed
 * onto stickers ("FJ0010", "FJ0011", …).
 *
 * A part owns SEVERAL of these, one per shot, which is why allocation is a server
 * call rather than a client-side increment: two engineers at two benches must
 * never be handed the same sticker. See backend/src/data/photoLabelRepository.js.
 *
 * The IMAGES are not here. They live in the browser, keyed by label
 * (src/lib/puiStore.js). This group is the linkage and the allocation ledger.
 */
export const photoLabels = {
  /** @returns {Promise<{labels: Array, views: string[], suggestedPrefix: string}>} */
  async listForPart(partId, opts) {
    return (await request(`/photo-labels/part/${partId}`, opts)).data;
  },

  /**
   * Take the next label in this part's series. WRITES — the returned label is now
   * claimed, which is why it isn't a GET.
   * @param {{prefix?: string, width?: number, view?: string}} [body]
   */
  async allocate(partId, body = {}, opts) {
    return (await request(`/photo-labels/part/${partId}/allocate`, {
      ...opts,
      method: 'POST',
      body,
    })).data;
  },

  /** Attach a label read off a sticker by hand. 409 if it's already on this part. */
  async add(partId, body, opts) {
    return (await request(`/photo-labels/part/${partId}`, { ...opts, method: 'POST', body })).data;
  },

  /** @param {{label?: string, view?: string}} patch */
  async update(labelId, patch, opts) {
    return (await request(`/photo-labels/${labelId}`, { ...opts, method: 'PATCH', body: patch }))
      .data;
  },

  /** Detach a label. Its browser-stored image is the caller's to clean up. */
  async remove(labelId, opts) {
    return (await request(`/photo-labels/${labelId}`, { ...opts, method: 'DELETE' })).data;
  },

  /** Which parts carry this label — two parts photographed in one shot. */
  async partsSharing(label, opts) {
    return (await request(`/photo-labels/shared/${encodeURIComponent(label)}`, opts)).data;
  },
};

const api = {
  health,
  products,
  reports,
  capture,
  photoLabels,
  ai,
  parts,
  modules,
  PERSONAS,
  PERSONA_LABELS,
  ApiError,
  API_BASE,
};

export default api;