// ---------------------------------------------------------------------------
// src/components/PhotoLabelFamily.jsx
//
// The photo labels stuck on one physical part — allocate the next sticker, say
// which face each shot is of, attach the image, print, remove.
//
// ---------------------------------------------------------------------------
// THE WORKFLOW THIS IS SHAPED AROUND
//
// A part comes off the unit and gets photographed from several angles. The
// engineer labels each SHOT, not the part: FJ0010 is the top view, FJ0011 the
// front, FJ0013 the left. So a part owns a FAMILY of labels — around seven — and
// the order of operations at the bench is:
//
//     allocate a label  ->  print it  ->  stick it on  ->  shoot  ->  attach
//
// Allocation comes FIRST and can happen before anyone knows which face the shot
// will be of, which is why `view` is optional and editable afterwards. A design
// that demanded the face up front would be asking the engineer to decide
// something they haven't done yet.
//
// Allocation is a SERVER call. Two benches must never be handed the same sticker,
// and a client-side "highest + 1" is a race whose loser has already labelled and
// photographed a part. See backend/src/data/photoLabelRepository.js.
//
// The images are browser-local (puiStore, keyed by label); the labels are server
// state. That split is stated on screen, because a photo that silently isn't
// there on the next machine is worse than one you were told about.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImageOff, Plus, Printer, Trash2, Upload } from 'lucide-react';

import api from '@/lib/api';
import * as puiStore from '@/lib/puiStore';
import { useApi } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

/** Required by the brief, verbatim. */
const FUTURE_STATE_HELP =
  'For production, these photos can be captured from tablet/mobile and stored in SharePoint or OneDrive using the same Photo ID.';

/**
 * One label: its image, its face, and the actions on it.
 *
 * The thumbnail is the primary target — big enough to tap on a bench tablet and
 * to recognise a part from, rather than the 40px squares the previous slot grid
 * used.
 */
function LabelTile({ label, image, views, active, onSelect, onAttach, onSetView, onRemove, onPrint }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const url = useMemo(() => (image ? URL.createObjectURL(image.blob) : null), [image]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // so re-picking the same file fires change again
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onAttach(label, file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`space-y-2 rounded-lg border p-2 transition-colors ${
        active ? 'border-accent bg-accent/5' : 'hover:border-accent'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect?.(label)}
        className="block w-full overflow-hidden rounded-md border bg-muted/40"
        // Consistent box whether or not there's an image, so the strip doesn't
        // reflow as photos arrive during a session.
        style={{ aspectRatio: '4 / 3' }}
        aria-label={`Select ${label.label}`}
      >
        {url ? (
          <img src={url} alt={`${label.label} ${label.view ?? ''}`} className="size-full object-cover" />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="size-5" />
            <span className="text-[11px]">No photo</span>
          </span>
        )}
      </button>

      <div className="flex items-center justify-between gap-1">
        <Badge variant="secondary" className="font-mono text-[11px]">
          {label.label}
        </Badge>
        {/* Native select: a Radix listbox steals focus when it opens, and this
            screen keeps a capture field focused for the measuring rig. */}
        <select
          value={label.view ?? ''}
          onChange={(e) => onSetView(label, e.target.value)}
          className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-1 text-xs"
          aria-label={`View for ${label.label}`}
        >
          <option value="">Face…</option>
          {views.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        {/* One control, two entry points: `capture="environment"` asks a tablet
            for its rear camera and a desktop for a file, so the same button is
            "Take photo" at the bench and "Upload" at a desk. */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 px-2 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="mr-1 size-3" />
          {busy ? '…' : image ? 'Replace' : 'Attach'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onPrint(label)}
          title="Label printing is not wired up yet"
        >
          <Printer className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
          onClick={() => onRemove(label)}
          aria-label={`Remove ${label.label}`}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * @param {object}   props
 * @param {object}   props.part             needs id
 * @param {Function} [props.onChanged]      called after any label change, so the
 *   caller can refetch — Part.photoId mirrors the lead label and the BOM grid
 *   reads it
 * @param {string}   [props.selectedLabel]  which label the caller is showing large
 * @param {Function} [props.onSelectLabel]
 * @param {boolean}  [props.compact=false]  fewer columns, for a narrow pane
 * @param {Function} [props.onPrintLabel]  hand the label to a preview. Without it,
 *   the printer button explains that printing is unwired rather than doing nothing
 */
export default function PhotoLabelFamily({
  part,
  onChanged,
  selectedLabel,
  onSelectLabel,
  compact = false,
  onPrintLabel,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
  const [printNotice, setPrintNotice] = useState(null);
  const [prefixEdit, setPrefixEdit] = useState(null);

  const partId = part?.id;
  // Part.photoId mirrors the family's LEAD label, so it changes whenever a label is
  // allocated — including from outside this component, which the capture
  // workstation now does from its own Photo ID button. Keyed on it as well as the
  // id, the family re-reads instead of showing "no photo labels on this part yet"
  // beside a header that is already displaying the label that was just allocated.
  // A primitive, so the dependency compares by value.
  const leadLabel = part?.photoId ?? '';

  // useApi, not a hand-rolled effect. Every other component fetches through it,
  // and it already owns the things that go wrong here: abort on unmount, no
  // synchronous setState in an effect body (which React's compiler lint rejects),
  // and keepPreviousData so the strip doesn't blank between refreshes.
  const {
    data: family,
    loading,
    error: loadError,
    refetch,
  } = useApi(({ signal }) => api.photoLabels.listForPart(partId, { signal }), [partId, leadLabel], {
    enabled: Boolean(partId),
    keepPreviousData: true,
  });

  const labels = family?.labels ?? [];
  const views = family?.views ?? [];
  // The typed prefix wins while it's being edited; otherwise follow the server's
  // suggestion, which continues whichever series this part is already using.
  const prefix = prefixEdit ?? family?.suggestedPrefix ?? '';

  // A stable primitive key, so the image read re-runs when the LABELS change but
  // not on every render that produces an equal array.
  const labelKey = labels.map((l) => l.label).join(',');

  // Images come from IndexedDB, and the store is shared and keyed by LABEL rather
  // than by part — so another part's panel, or another tab, can write an image
  // this strip should show. `photoVersion` is bumped by the store's change
  // notification to re-run this read.
  const [photoVersion, setPhotoVersion] = useState(0);
  useEffect(() => puiStore.onChange(() => setPhotoVersion((v) => v + 1)), []);

  const { data: images } = useApi(
    () => puiStore.getLabelImages(labelKey ? labelKey.split(',') : []),
    [labelKey, photoVersion],
    { enabled: true, keepPreviousData: true },
  );

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refetch();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const allocate = () => run(() => api.photoLabels.allocate(part.id, { prefix: prefix || undefined }));

  const addManual = () =>
    run(async () => {
      const value = manual.trim();
      if (!value) throw new Error('Type the label that is on the part.');
      await api.photoLabels.add(part.id, { label: value });
      setManual('');
    });

  const setView = (label, view) =>
    run(() => api.photoLabels.update(label.id, { view: view || null }));

  // No explicit refresh: putLabelImage fires the store's change notification,
  // which bumps photoVersion and re-reads the images.
  const attach = (label, file) => puiStore.putLabelImage(label.label, file);

  const remove = (label) =>
    run(async () => {
      if (
        !window.confirm(
          `Remove label ${label.label} from this part? Its photo in this browser goes too.`,
        )
      ) {
        return;
      }
      await api.photoLabels.remove(label.id);
      await puiStore.removeLabelImage(label.label);
    });

  // Hands off to the caller's label preview when there is one. The fallback
  // notice remains for callers that render this panel without a preview (the part
  // row in the Teardown and Engineering BOM views), so the button still explains
  // itself rather than doing nothing.
  const print = (label) => {
    if (onPrintLabel) {
      onPrintLabel(label);
      return;
    }
    setPrintNotice(
      `Label printing is available on the Capture workstation — ${label.label} previews and prints there. ` +
        'The label content is generated from this part, so nothing needs re-entering.',
    );
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-20 space-y-1">
          <label htmlFor={`label-prefix-${part.id}`} className="text-xs text-muted-foreground">
            Series
          </label>
          <Input
            id={`label-prefix-${part.id}`}
            value={prefix}
            onChange={(e) => setPrefixEdit(e.target.value.toUpperCase())}
            className="h-8 font-mono uppercase"
          />
        </div>
        <Button size="sm" className="h-8" onClick={allocate} disabled={busy || !prefix.trim()}>
          <Plus className="mr-1 size-4" />
          Next label
        </Button>
        <div className="flex items-end gap-1">
          <div className="w-28 space-y-1">
            <label htmlFor={`label-manual-${part.id}`} className="text-xs text-muted-foreground">
              Or type one
            </label>
            <Input
              id={`label-manual-${part.id}`}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
              placeholder="FJ0017"
              className="h-8 font-mono uppercase placeholder:normal-case"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={addManual}
            disabled={busy || !manual.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      {(error || loadError) && (
        <Alert variant="destructive">
          <AlertDescription>{error ?? loadError.message}</AlertDescription>
        </Alert>
      )}
      {printNotice && (
        <Alert>
          <AlertDescription className="flex items-start justify-between gap-3">
            <span className="text-sm">{printNotice}</span>
            <Button variant="ghost" size="sm" onClick={() => setPrintNotice(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {labels.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Camera className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No photo labels on this part yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            Press <strong>Next label</strong> to take the next sticker in the {prefix || 'series'}{' '}
            run, or type a label that is already on the part.
          </p>
        </div>
      ) : (
        <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'}`}>
          {labels.map((label) => (
            <LabelTile
              key={label.id}
              label={label}
              image={images?.[label.label]}
              views={views}
              active={selectedLabel === label.label}
              onSelect={(l) => onSelectLabel?.(l.label)}
              onAttach={attach}
              onSetView={setView}
              onRemove={remove}
              onPrint={print}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {labels.length > 0 && (
          <>
            <strong>{labels[0].label}</strong> is this part's lead label — the one the Engineering
            BOM shows.{' '}
          </>
        )}
        {FUTURE_STATE_HELP}
      </p>
    </div>
  );
}
