// ---------------------------------------------------------------------------
// src/lib/photoDb.js — the single IndexedDB connection for every image store.
//
// ---------------------------------------------------------------------------
// WHY THIS MODULE EXISTS — IT PREVENTS A REAL, SILENT BREAKAGE
//
// Two features now keep images in this database:
//   - photoStore.js  — free-form photos attached to a PART (keyed by part id)
//   - puiStore.js    — one image per standard view, attached to a PHOTO ID
//
// IndexedDB has ONE version number per database. If each module opened the DB
// with its own `DB_VERSION`, the module with the higher number would upgrade the
// database, and the other module's `open(…, lowerVersion)` would then fail
// outright with a VersionError — a browser-level error, on a feature that
// previously worked, appearing only after the newer feature had been used once.
// Nothing in the app would look wrong until a user who had touched Picture UI
// went back to a part's photo grid.
//
// So the version, and the upgrade that creates every store, live here exactly
// once. Both modules import `openDb` and neither knows the version.
//
// ADDING A STORE LATER: bump DB_VERSION by one and add another idempotent
// `if (!db.objectStoreNames.contains(...))` block. The blocks are written
// unconditionally rather than switched on `event.oldVersion` so that upgrading
// from ANY earlier version lands in the same shape.
// ---------------------------------------------------------------------------

const DB_NAME = 'daikin-benchmark-photos';

/**
 * v1 — `photos` (per-part photo grid)
 * v2 — adds `pui` (Picture UI: one image per photo-ID + view)
 */
const DB_VERSION = 2;

/** Free-form photos attached to a part id. */
export const PHOTOS_STORE = 'photos';
export const PHOTOS_PART_ID_INDEX = 'partId';

/**
 * Picture UI images, keyed by the compound [photoId, view].
 *
 * A compound primary key rather than an autoincrement id plus indexes, because
 * the domain rule is exactly "one image per view per photo ID" — making that the
 * key means `put` replaces a re-uploaded view for free, and the database itself
 * enforces the rule rather than application code remembering to.
 */
export const PUI_STORE = 'pui';

/**
 * Open the shared database, creating or upgrading stores as needed.
 *
 * Every caller opens its own short-lived connection rather than the module
 * holding one open — IndexedDB connections are cheap, and this way nothing has
 * to reason about a stale handle. Note an open connection BLOCKS an upgrade, so
 * a long-lived one would also risk wedging the next version bump.
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('This browser has IndexedDB disabled — photo storage is unavailable.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        const store = db.createObjectStore(PHOTOS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex(PHOTOS_PART_ID_INDEX, 'partId', { unique: false });
      }

      if (!db.objectStoreNames.contains(PUI_STORE)) {
        db.createObjectStore(PUI_STORE, { keyPath: ['photoId', 'view'] });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open photo storage'));
  });
}

/** Wrap an IDBRequest in a promise — every call in both stores is one request. */
export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Photo storage request failed'));
  });
}
