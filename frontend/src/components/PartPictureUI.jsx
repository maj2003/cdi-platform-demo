// ---------------------------------------------------------------------------
// src/components/PartPictureUI.jsx — the Picture UI (PUI) section of a part.
//
// Two halves that meet at the Photo ID:
//   1. The Photo ID field — the label written on the physical part ("C1", "FJ1",
//      "CAB-001"). Saved to Part.photoId through the same
//      local-edit-then-batched-Save + PATCH /api/parts/:id pattern
//      PartInfoEditor and PartGeometryEditor use.
//   2. Six standard view slots (Top / Front / Left / Right / Rear / ISO), each
//      holding at most one image, read from puiStore BY PHOTO ID.
//
// ---------------------------------------------------------------------------
// WHY THE SLOTS KEY OFF THE PHOTO ID AND NOT THE PART
//
// This is the workflow, not an implementation detail: photos are captured and
// grouped by ID at teardown time, before anyone knows which BOM row they belong
// to. Typing an existing ID onto a part therefore SURFACES photos that were
// already there — the part didn't upload them. Two parts sharing an ID show the
// same set, which is intended (a left and right panel shot together).
//
// The consequence to keep in mind while reading this file: the slot grid follows
// the SAVED photoId, not the text in the input. Showing photos for half-typed
// text would flicker between unrelated sets on the way to "CAB-001".
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImageOff, Upload, X } from 'lucide-react';

import api from '@/lib/api';
import * as puiStore from '@/lib/puiStore';
import { useApi, useApiAction } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

/** Required by the brief, verbatim. */
const FUTURE_STATE_HELP =
  'For production, these photos can be captured from tablet/mobile and stored in SharePoint or OneDrive using the same Photo ID.';

/** One view slot: thumbnail or empty state, plus upload and clear. */
function ViewSlot({ view, record, url, photoId, onUploaded, onCleared, disabled }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file fires another change event.
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      await puiStore.putView(photoId, view, file);
      onUploaded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    setError(null);
    try {
      await puiStore.removeView(photoId, view);
      onCleared?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5" data-pui-slot={view}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{view}</span>
        {record && (
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            aria-label={`Remove the ${view} photo`}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div
        className={`flex aspect-4/3 items-center justify-center overflow-hidden rounded-md border ${
          record ? 'border-accent/60 bg-muted/30' : 'border-dashed bg-muted/20'
        }`}
      >
        {record ? (
          // Plain <img> on an object URL. No lazy loading: there are at most six
          // and they're already in local storage, so there's nothing to defer.
          <img
            src={url}
            alt={`${view} view of ${photoId}`}
            className="size-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageOff className="size-4" aria-hidden />
            <span className="text-[11px]">No photo</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
        aria-label={`Upload the ${view} view for ${photoId ?? 'this part'}`}
      />
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1 size-3.5" />
        {busy ? 'Saving…' : record ? 'Replace' : 'Upload'}
      </Button>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.part                the part record, including photoId
 * @param {() => void} [props.onSaved]       refetch the teardown after a PATCH
 */
export default function PartPictureUI({ part, onSaved }) {
  // The SAVED id drives the photo grid; `draft` is just what's in the input.
  const savedPhotoId = part.photoId ?? null;
  const [draft, setDraft] = useState(savedPhotoId ?? '');

  // Re-sync the input when the SAVED id changes underneath us — the part gets
  // refetched whenever any editor on this row saves, and without this the input
  // would keep showing a stale value after an external change.
  //
  // Done as a render-phase adjustment rather than in an effect. React documents
  // this exact case ("adjusting state when a prop changes"): the setState runs
  // during render, so React re-renders immediately without committing the stale
  // pass. An effect would commit the wrong value first and then correct it,
  // which is the cascading-render pattern the lint rule flags.
  const [syncedFrom, setSyncedFrom] = useState(savedPhotoId);
  if (syncedFrom !== savedPhotoId) {
    setSyncedFrom(savedPhotoId);
    setDraft(savedPhotoId ?? '');
  }

  const save = useApiAction((photoId) => api.parts.update(part.id, { photoId }));

  const {
    data: photos,
    loading,
    error,
    refetch,
  } = useApi(() => puiStore.listByPhotoId(savedPhotoId), [savedPhotoId]);

  // Any PUI write anywhere re-reads: another part sharing this Photo ID is an
  // independent reader of the same rows. Same reasoning as photoStore's pub-sub.
  useEffect(() => puiStore.onChange(refetch), [refetch]);

  // Object URLs are rebuilt whenever the photo set changes; the effect only
  // revokes them, so each batch is freed exactly once. Skipping the revoke leaks
  // a blob URL per thumbnail for the life of the tab.
  const urls = useMemo(
    () => Object.fromEntries(Object.entries(photos ?? {}).map(([view, r]) => [view, URL.createObjectURL(r.blob)])),
    [photos],
  );
  useEffect(() => () => Object.values(urls).forEach(URL.revokeObjectURL), [urls]);

  const normalisedDraft = puiStore.normalisePhotoId(draft);
  const dirty = normalisedDraft !== savedPhotoId;
  const filledCount = Object.keys(photos ?? {}).length;

  async function handleSave() {
    try {
      await save.run(normalisedDraft);
      onSaved?.();
    } catch {
      // save.error renders below.
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- Photo ID ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`pui-photo-id-${part.id}`}>Photo ID</Label>
          <Input
            id={`pui-photo-id-${part.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. C1, FJ1, CAB-001"
            // `uppercase` is for what the user TYPES (IDs are stored upper-cased),
            // but it also hit the placeholder, rendering "E.G. C1, FJ1, CAB-001".
            // placeholder:normal-case keeps the hint in its authored casing.
            className="w-48 uppercase placeholder:normal-case"
            maxLength={40}
          />
        </div>
        <Button size="sm" onClick={handleSave} disabled={!dirty || save.loading}>
          {save.loading ? 'Saving…' : 'Save Photo ID'}
        </Button>
        {savedPhotoId && (
          <Badge variant="secondary" className="font-normal">
            {filledCount} of {puiStore.VIEWS.length} views captured
          </Badge>
        )}
        {dirty && !save.loading && (
          <span className="text-xs text-muted-foreground">
            Unsaved — the photo slots follow the saved ID.
          </span>
        )}
      </div>

      {save.error && (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      )}

      {/* ---- the six view slots ---- */}
      {!savedPhotoId ? (
        // Photos are keyed by the ID, so there is genuinely nowhere to put an
        // image until one is saved. Say that rather than showing six dead slots.
        //
        // ---------------------------------------------------------------
        // WHY THE WIDTH IS CAPPED AGAINST THE VIEWPORT, NOT JUST IN rem
        //
        // This panel lives in a TableCell inside the expanded part row, and that
        // cell is far wider than the visible card — measured at 1191px even in a
        // 298px-wide container on mobile. The width comes from the pre-existing
        // Geometry / Part Information grids in the same cell, so it is inherited,
        // not caused here; the table container scrolls horizontally to cope.
        //
        // An unconstrained panel therefore stretched to the full 1191px and ran
        // past the card edge — by 144px even on a 1400px desktop. `w-full` alone
        // cannot fix that (100% IS the over-wide cell), and neither can a plain
        // rem cap on mobile. Capping against BOTH a sensible panel width and the
        // viewport keeps it inside the visible area at every size:
        //   desktop 1400 -> min(32rem, 1272px) = 512px
        //   tablet   820 -> min(32rem,  692px) = 512px
        //   mobile   380 -> min(32rem,  252px) = 252px
        //
        // The 8rem subtraction covers the card padding plus the table cell's own
        // padding that sit to the LEFT of this panel (measured at 81px on
        // mobile), with a little slack. A 6rem subtraction was measurably 9px too
        // generous and still crossed the card edge on a 380px viewport.
        //
        // Left-aligned in the cell rather than mx-auto, deliberately: centring
        // inside a 1191px cell would push the panel off the right of a 298px
        // viewport. The CONTENT is centred within the panel, which is what a
        // reader actually sees, and starting at the left edge also lines the
        // panel up with the Geometry and Part Information sections above it.
        // ---------------------------------------------------------------
        <div className="flex min-h-44 w-full max-w-[min(32rem,calc(100vw-8rem))] flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed px-6 py-10 text-center">
          <Camera className="size-6 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No Photo ID saved</p>
          <p className="max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground wrap-break-word">
            Save a Photo ID to unlock Top, Front, Left, Right, Rear and ISO view slots.
          </p>
        </div>
      ) : (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {loading && !photos ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {puiStore.VIEWS.map((view) => (
                <Skeleton key={view} className="aspect-4/3" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {puiStore.VIEWS.map((view) => (
                <ViewSlot
                  key={view}
                  view={view}
                  record={photos?.[view] ?? null}
                  url={urls[view]}
                  photoId={savedPhotoId}
                  onUploaded={refetch}
                  onCleared={refetch}
                />
              ))}
            </div>
          )}

          {filledCount === 0 && (
            <p className="text-xs text-muted-foreground">
              No photos stored against <span className="font-mono">{savedPhotoId}</span> yet — upload
              a view above, or capture them at teardown and they will appear here.
            </p>
          )}
        </>
      )}

      {/* ---- future state ---- */}
      <p className="text-xs text-muted-foreground">{FUTURE_STATE_HELP}</p>
      <p className="text-xs text-muted-foreground">
        Photos are held in this browser only for now (IndexedDB) — they do not travel between
        machines, and re-running the seed re-creates parts with new ids. The Photo ID itself is saved
        on the part record, so it survives both.
      </p>
    </div>
  );
}
