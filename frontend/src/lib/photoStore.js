// ---------------------------------------------------------------------------
// src/lib/photoStore.js — per-part photo storage, entirely client-side.
//
// WHY INDEXEDDB, NOT LOCALSTORAGE OR THE BACKEND:
//
// This is deliberately a browser-only MVP of "teardown photo capture," not a
// real upload pipeline — the eventual destination is a shared store (Azure
// Blob / SharePoint), which is out of scope for this pre-integration build
// (see CONTEXT.md 3a). Until then:
//   - localStorage only holds strings and is capped at ~5–10MB per origin —
//     nowhere near enough for photos, and it would mean base64-encoding every
//     image, inflating it by ~33% for no reason.
//   - IndexedDB stores real Blob/File objects natively, has a much larger
//     quota, and — unlike component state — survives a page reload, which is
//     the whole point of calling this "storage" rather than "state".
//
// Every function here opens its own connection rather than holding one open
// across the module's lifetime; IndexedDB connections are cheap to open and
// this avoids ever having to reason about a connection going stale.
//
// CAVEAT WORTH KNOWING: `npm run seed` deletes and rebuilds every part with a
// new id (see db/seed.js's note on why). Any photos captured for the old part
// ids become unreachable orphans after a re-seed — the same tradeoff the
// project already accepts for hand-entered captures.
// ---------------------------------------------------------------------------

// The database handle, version and upgrade path moved to photoDb.js when
// Picture UI added a second store to the same database. IndexedDB has one
// version per database, so two modules each declaring their own DB_VERSION would
// make whichever opened with the lower number fail with a VersionError — see
// that file's header. This module keeps its public API unchanged.
import { openDb, promisify, PHOTOS_STORE, PHOTOS_PART_ID_INDEX } from '@/lib/photoDb';

const STORE = PHOTOS_STORE;
const PART_ID_INDEX = PHOTOS_PART_ID_INDEX;

// ---------------------------------------------------------------------------
// Change notification
//
// The Product Detail page renders two independent readers of this store at
// once — the per-part photo grid and the whole-teardown gallery — each with
// its own useApi call and no shared cache. Without this, uploading a photo on
// a part would leave the gallery below showing stale data until the next full
// page load, which is exactly the kind of "two screens disagree" bug this
// codebase otherwise goes out of its way to avoid (see the two-fetch pattern
// note in ProductDetailPage.jsx). A plain subscriber list is enough: every
// write calls notifyChange(), every reader refetches. Cheap at this scale —
// no need for anything fancier than "when in doubt, everyone re-reads".
// ---------------------------------------------------------------------------
const listeners = new Set();

function notifyChange() {
  for (const listener of listeners) listener();
}

/** @returns {() => void} an unsubscribe function, for a useEffect cleanup */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Store one or more images against a part.
 *
 * @param {number} partId
 * @param {FileList|File[]} files
 * @returns {Promise<Array<object>>} the created records, including their new ids
 * @throws {Error} if none of the selected files are images
 */
export async function addPhotos(partId, files) {
  const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) {
    throw new Error('No image files selected — only image/* files are stored here.');
  }

  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);

  const created = await Promise.all(
    images.map((file) =>
      promisify(
        store.add({
          partId: Number(partId),
          name: file.name,
          type: file.type,
          size: file.size,
          blob: file, // Blob/File clones natively through IndexedDB's structured-clone algorithm
          createdAt: Date.now(),
        }),
      ).then((id) => ({ id, partId: Number(partId), name: file.name, type: file.type, size: file.size, blob: file })),
    ),
  );

  db.close();
  notifyChange();
  return created;
}

/** Every photo for one part, newest first. */
export async function listByPart(partId) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index(PART_ID_INDEX);
  const rows = await promisify(index.getAll(IDBKeyRange.only(Number(partId))));
  db.close();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Every photo across several parts, newest first — the product-wide gallery's
 * read. IndexedDB has no native "id IN (...)" query, so this loops the index
 * per part id; fine at the scale of one teardown's part count.
 */
export async function listByParts(partIds) {
  if (!partIds || partIds.length === 0) return [];

  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index(PART_ID_INDEX);

  const rows = (
    await Promise.all(partIds.map((id) => promisify(index.getAll(IDBKeyRange.only(Number(id))))))
  ).flat();

  db.close();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** @returns {Promise<boolean>} false when the id did not exist */
export async function remove(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await promisify(tx.objectStore(STORE).delete(id));
  db.close();
  notifyChange();
  return true;
}

/**
 * Drop every photo belonging to any of these part ids.
 *
 * ---------------------------------------------------------------------------
 * WHY DELETING A PRODUCT HAS TO CALL THIS
 *
 * These photos live in the browser, not the database, so the server's cascade
 * (Product -> SubAssembly -> Part -> Cost/Measurement) cannot reach them. Nothing
 * else ever will either: they are keyed by `partId`, and those part rows are gone,
 * so the photos become unreachable bytes that sit in the user's browser storage
 * for good. A "delete product" that leaves them behind hasn't cleaned anything up.
 *
 * They are NOT a correctness hazard, and it's worth being precise about that: Part
 * ids are `INTEGER PRIMARY KEY AUTOINCREMENT`, which in SQLite never reuses a
 * value, so a future part cannot inherit a deleted part's id and show its photos.
 * This is housekeeping, not a bug fix.
 *
 * PUI view-slot images (puiStore.js) are deliberately NOT purged here. Those are
 * keyed by the Photo ID written on the physical part, not by part id, and one label
 * is shared by design across several parts — possibly across products. Deleting
 * them with a product could destroy photos another product's part still points at,
 * which is a worse outcome than leaving them.
 *
 * @param {number[]} partIds
 * @returns {Promise<number>} how many photos were removed
 */
export async function removeByParts(partIds) {
  if (!partIds || partIds.length === 0) return 0;

  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const index = store.index(PART_ID_INDEX);

  const rows = (
    await Promise.all(partIds.map((id) => promisify(index.getAll(IDBKeyRange.only(Number(id))))))
  ).flat();

  await Promise.all(rows.map((row) => promisify(store.delete(row.id))));

  db.close();
  if (rows.length) notifyChange();
  return rows.length;
}
