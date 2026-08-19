// ---------------------------------------------------------------------------
// src/components/ProductPhotoGallery.jsx
//
// A read-only, whole-teardown view over the same photoStore data PartPhotos
// writes to — every photo across every part, newest first, captioned with
// which part it belongs to. Uploading happens at the part level (Part
// Details, below); this section exists to show the association at a glance
// rather than duplicate the upload control per part.
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from 'react';

import * as photoStore from '@/lib/photoStore';
import { useApi } from '@/lib/useApi';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * @param {object} props
 * @param {Array<object>} props.subAssemblies  teardown.subAssemblies, each with .parts
 */
export default function ProductPhotoGallery({ subAssemblies }) {
  const flatParts = useMemo(
    () =>
      subAssemblies.flatMap((sub) => sub.parts.map((part) => ({ ...part, subAssemblyName: sub.name }))),
    [subAssemblies],
  );

  const partById = useMemo(() => new Map(flatParts.map((p) => [p.id, p])), [flatParts]);
  const partIds = flatParts.map((p) => p.id);
  const idsKey = partIds.join(',');

  const { data: photos, loading, error, refetch } = useApi(
    () => photoStore.listByParts(idsKey ? idsKey.split(',').map(Number) : []),
    [idsKey],
  );

  // Re-read on any photo add/delete anywhere on the page — this is the other
  // half of the sync described in photoStore.js's onChange note. Without it,
  // a photo added from a part's own upload control wouldn't appear here until
  // the next full reload.
  useEffect(() => photoStore.onChange(refetch), [refetch]);

  // See PartPhotos.jsx for why this is a memo (recompute) + effect (revoke
  // only) pair rather than a single effect that also calls setState.
  const urls = useMemo(
    () => Object.fromEntries((photos ?? []).map((p) => [p.id, URL.createObjectURL(p.blob)])),
    [photos],
  );
  useEffect(() => () => Object.values(urls).forEach(URL.revokeObjectURL), [urls]);

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }

  if (!photos?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No photos captured yet — add some from any part's detail view below.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {photos.map((photo) => {
        const part = partById.get(photo.partId);
        return (
          <div key={photo.id} className="space-y-1">
            <img
              src={urls[photo.id]}
              alt={photo.name}
              className="aspect-square w-full rounded-md border object-cover"
            />
            <p className="truncate text-xs text-muted-foreground" title={part?.name}>
              {part?.name ?? 'Unknown part'}
            </p>
          </div>
        );
      })}
    </div>
  );
}
