// ---------------------------------------------------------------------------
// src/lib/puiStore.js — Picture UI storage: one image per standard view, per
// photo ID.
//
// ---------------------------------------------------------------------------
// THE KEY IS THE PHOTO ID, NOT THE PART ID — THAT IS THE WHOLE POINT
//
// photoStore.js keys images by part id: "these are photos of part 137". This
// module keys them by the label written on the physical part during teardown
// ("C1", "FJ1", "CAB-001") plus which standard view they are.
//
// That mirrors the actual workflow stakeholders described: photos are captured
// and grouped by ID at teardown time, BEFORE anyone knows which BOM row they
// will belong to. Later a BOM creator types the ID onto a part and the photos
// appear. Two parts can carry the same ID — a left and right panel shot together
// — and both should then show the same set. Keying on part id could not express
// any of that.
//
// The part↔photo-ID link therefore lives on the Part record (`Part.photoId`,
// server-side), while the image bytes live here in the browser. That split is
// deliberate: the ID is BOM metadata that must survive and travel, the bytes
// belong in SharePoint/Blob storage which this build doesn't talk to.
//
// Storage details are in photoDb.js — notably that this shares one database with
// photoStore.js and why the version lives in one place.
// ---------------------------------------------------------------------------

import { openDb, promisify, PUI_STORE } from '@/lib/photoDb';

/**
 * The six standard teardown views, in the order they're shot and displayed.
 *
 * Fixed and closed on purpose: the value of a "standard view" set is that every
 * part is photographed the same way, so two teardowns can be compared view by
 * view. A free-form list would let one teardown have "top" and another "above".
 */
export const VIEWS = Object.freeze(['Top', 'Front', 'Left', 'Right', 'Rear', 'ISO']);

/**
 * Normalise a photo ID to its storage form: trimmed, upper-cased.
 *
 * Mirrors the backend's normalisation in partRepository.normalise() so a part
 * saved with "c1" and a photo stored under "C1" always meet. Duplicated rather
 * than shared because frontend/ and backend/ are separate npm packages — the
 * same honest tradeoff lib/api.js already notes for PERSONAS.
 *
 * @returns {string|null} null for blank, which callers treat as "no ID set"
 */
export function normalisePhotoId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Change notification — same pattern and same reasoning as photoStore.js: the
// PUI section on one part and the same photo ID on another part are independent
// readers with no shared cache, so every write tells everyone to re-read.
// ---------------------------------------------------------------------------
const listeners = new Set();

function notifyChange() {
  for (const listener of listeners) listener();
}

/** @returns {() => void} unsubscribe, for a useEffect cleanup */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Store one image against a photo ID and view, replacing whatever was there.
 *
 * `put`, not `add`: the compound key [photoId, view] IS the domain rule "one
 * image per view", so re-uploading a view overwrites rather than erroring or
 * silently creating a second Top shot.
 *
 * @param {string} photoId
 * @param {string} view    one of VIEWS
 * @param {File} file
 * @returns {Promise<object>} the stored record
 * @throws {Error} on a blank ID, an unknown view, or a non-image file
 */
export async function putView(photoId, view, file) {
  const id = normalisePhotoId(photoId);
  if (!id) throw new Error('Set a Photo ID on this part before attaching photos.');
  if (!VIEWS.includes(view)) throw new Error(`Unknown view "${view}".`);
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Only image files can be attached — pick a JPG or PNG.');
  }

  const record = {
    photoId: id,
    view,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file, // Blob/File clones natively via IndexedDB's structured clone
    createdAt: Date.now(),
  };

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readwrite');
  await promisify(tx.objectStore(PUI_STORE).put(record));
  db.close();

  notifyChange();
  return record;
}

// ---------------------------------------------------------------------------
// THE LABEL-KEYED API — one label, one photo
//
// The six-view model above answers "show me every angle of part C1". The photo
// LABEL model answers a different question: the engineers label each SHOT, so
// FJ0010 *is* the top view and FJ0011 *is* the front. One label holds exactly one
// image, and which face it shows is recorded on the PhotoLabel row server-side,
// not in this key.
//
// Implemented on the same object store with a reserved slot name rather than a new
// store, because a new store means an IndexedDB version bump — and photoDb.js
// exists precisely to keep one version across both stores after a VersionError
// taught us that lesson. The reserved name cannot collide with a real view: it
// isn't in VIEWS, and putView rejects anything that isn't.
// ---------------------------------------------------------------------------

/** The sole slot a label-keyed image occupies. Deliberately not a valid view. */
const LABEL_SLOT = '#label';

/** Attach (or replace) the single image belonging to one photo label. */
export async function putLabelImage(label, file) {
  const id = normalisePhotoId(label);
  if (!id) throw new Error('This photo label is blank — allocate or type one first.');
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Only image files can be attached — pick a JPG or PNG.');
  }

  const record = {
    photoId: id,
    view: LABEL_SLOT,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    createdAt: Date.now(),
  };

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readwrite');
  await promisify(tx.objectStore(PUI_STORE).put(record));
  db.close();

  notifyChange();
  return record;
}

/** The image for one label, or null. */
export async function getLabelImage(label) {
  const id = normalisePhotoId(label);
  if (!id) return null;

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readonly');
  const row = await promisify(tx.objectStore(PUI_STORE).get([id, LABEL_SLOT]));
  db.close();
  return row ?? null;
}

/**
 * Images for many labels at once, keyed by label.
 *
 * The workstation and the Picture UI both render a whole family — seven labels for
 * one part — and a per-label round trip would open and close the database seven
 * times to draw one strip of thumbnails.
 */
export async function getLabelImages(labels) {
  const ids = (labels ?? []).map(normalisePhotoId).filter(Boolean);
  if (!ids.length) return {};

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readonly');
  const store = tx.objectStore(PUI_STORE);
  const rows = await Promise.all(ids.map((id) => promisify(store.get([id, LABEL_SLOT]))));
  db.close();

  return Object.fromEntries(rows.filter(Boolean).map((row) => [row.photoId, row]));
}

/** Drop the image for one label. The label itself lives server-side. */
export async function removeLabelImage(label) {
  const id = normalisePhotoId(label);
  if (!id) return false;

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readwrite');
  await promisify(tx.objectStore(PUI_STORE).delete([id, LABEL_SLOT]));
  db.close();

  notifyChange();
  return true;
}

/**
 * Every stored view for one photo ID, keyed by view name.
 *
 * Returns an object rather than an array so a caller can render the six slots by
 * name without searching. A missing view is simply absent.
 *
 * @param {string} photoId
 * @returns {Promise<Record<string, object>>} {} when the ID is blank or unused
 */
export async function listByPhotoId(photoId) {
  const id = normalisePhotoId(photoId);
  if (!id) return {};

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readonly');
  // The compound key is [photoId, view], so a bound range over one photoId
  // returns exactly its views — no index needed, and no full scan.
  const range = IDBKeyRange.bound([id, ''], [id, '￿']);
  const rows = await promisify(tx.objectStore(PUI_STORE).getAll(range));
  db.close();

  return Object.fromEntries(rows.map((row) => [row.view, row]));
}

/**
 * How many views each photo ID has, across everything stored.
 *
 * Used to tell a BOM creator that an ID they typed already has photos waiting —
 * the "enter the ID and the photos appear" half of the workflow.
 *
 * @returns {Promise<Record<string, number>>}
 */
export async function countsByPhotoId() {
  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readonly');
  const rows = await promisify(tx.objectStore(PUI_STORE).getAll());
  db.close();

  const counts = {};
  for (const row of rows) counts[row.photoId] = (counts[row.photoId] ?? 0) + 1;
  return counts;
}

/** Delete one view. Resolves either way — deleting an absent key is not an error. */
export async function removeView(photoId, view) {
  const id = normalisePhotoId(photoId);
  if (!id) return false;

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readwrite');
  await promisify(tx.objectStore(PUI_STORE).delete([id, view]));
  db.close();

  notifyChange();
  return true;
}

/** Delete every view for one photo ID. */
export async function removeAll(photoId) {
  const id = normalisePhotoId(photoId);
  if (!id) return false;

  const db = await openDb();
  const tx = db.transaction(PUI_STORE, 'readwrite');
  const store = tx.objectStore(PUI_STORE);
  await Promise.all(VIEWS.map((view) => promisify(store.delete([id, view]))));
  db.close();

  notifyChange();
  return true;
}
