// ---------------------------------------------------------------------------
// src/components/PartPhotos.jsx
//
// Upload + thumbnail grid for one part's photos. Storage is photoStore.js
// (IndexedDB, this browser only) — treated exactly like a network call
// through useApi/useApiAction so this component doesn't need to know that.
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';

import * as photoStore from '@/lib/photoStore';
import { useApi, useApiAction } from '@/lib/useApi';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * @param {object} props
 * @param {number} props.partId
 */
export default function PartPhotos({ partId }) {
  const {
    data: photos,
    loading,
    error,
    refetch,
  } = useApi(() => photoStore.listByPart(partId), [partId]);

  // Re-read whenever ANY part's photos change, not just this one — cheap at
  // this scale, and it's what keeps this grid in sync with the product-wide
  // gallery when a photo is added or deleted from there instead of here.
  useEffect(() => photoStore.onChange(refetch), [refetch]);

  const upload = useApiAction((files) => photoStore.addPhotos(partId, files));

  // Object URLs are recomputed whenever the photo list changes. The effect
  // below only revokes them — it never sets state — so each batch is freed
  // exactly once, when the next batch replaces it or the component unmounts.
  // Skipping the revoke leaks a blob URL per thumbnail for the life of the
  // tab, which adds up fast on a page with photos on several parts.
  const urls = useMemo(
    () => Object.fromEntries((photos ?? []).map((p) => [p.id, URL.createObjectURL(p.blob)])),
    [photos],
  );
  useEffect(() => () => Object.values(urls).forEach(URL.revokeObjectURL), [urls]);

  async function handleFileChange(e) {
    const { files } = e.target;
    if (!files || files.length === 0) return;
    try {
      // No explicit refetch here: addPhotos's notifyChange() reaches this
      // component's own onChange subscription above.
      await upload.run(files);
    } catch {
      // upload.error renders below.
    } finally {
      e.target.value = ''; // allow re-selecting the same file(s) immediately
    }
  }

  async function handleDelete(id) {
    await photoStore.remove(id); // same: notifyChange() covers the refetch
  }

  return (
    <div className="space-y-2">
      <Input
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="h-auto max-w-xs py-1"
      />
      {upload.loading && <p className="text-xs text-muted-foreground">Saving…</p>}
      {upload.error && <p className="text-xs text-destructive">{upload.error.message}</p>}
      {error && <p className="text-xs text-destructive">{error.message}</p>}

      {loading ? (
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="size-16 rounded-md" />
          ))}
        </div>
      ) : !photos?.length ? (
        <p className="text-sm text-muted-foreground">No photos captured for this part yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative">
              <img
                src={urls[photo.id]}
                alt={photo.name}
                className="size-16 rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => handleDelete(photo.id)}
                aria-label={`Delete ${photo.name}`}
                className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive group-hover:flex"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
