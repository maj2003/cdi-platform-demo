// ---------------------------------------------------------------------------
// src/components/capture/CaptureWorkstation.jsx
//
// The teardown bench, as a screen. Three panes over one part:
//
//   THE PART            MEASUREMENTS              ENGINEERING METADATA
//   image, photo,       geometry, dimensions,     material, module, category,
//   Photo ID, label,    weight, session log       levels, processes, remarks
//   view slots
//
// The workflow it is shaped around, left to right:
//
//   physical part -> photograph -> assign Photo ID -> measure -> classify -> save
//
// ---------------------------------------------------------------------------
// THE ARMED CAPTURE TARGET — why this screen can host a measuring rig at all
//
// The rig is a keyboard wedge. It types a value into whatever field has focus and
// sends Enter; there is no driver, no button and no way to ask it anything. The
// Rapid capture wizard survives that by having exactly ONE focusable input on
// screen. A workstation cannot: it has a dozen measurement fields and a dozen
// metadata controls, and a keystroke landing in "Remarks" is a silently lost
// reading.
//
// So one measurement field is ARMED at a time. The armed field is focused by
// effect, outlined, and named in the header bar. Enter commits it and arms the
// next one, which reproduces the wizard's rhythm — value, Enter, value, Enter —
// while leaving everything else visible. Clicking any measurement field arms it.
//
// And when focus leaves the armed field (someone opens a metadata dropdown), the
// header says so in amber rather than pretending the rig is still connected.
// Being told "not armed" is recoverable; a reading typed into a select is not.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Circle,
  Keyboard,
  Layers,
  Printer,
  RectangleHorizontal,
  Save,
  Scale,
  Shapes,
  Sigma,
  Tag,
  Upload,
} from 'lucide-react';

import api from '@/lib/api';
import * as photoStore from '@/lib/photoStore';
import * as puiStore from '@/lib/puiStore';
import { useApi } from '@/lib/useApi';
import PhotoLabelFamily from '@/components/PhotoLabelFamily';
import CameraCapture from '@/components/capture/CameraCapture';
import LabelPreview from '@/components/capture/LabelPreview';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  advanceSequenceForGeometry,
  countFieldsForGeometry,
  fieldsForGeometry,
  finishFieldsForGeometry,
  FINISH_OPTIONS,
  FINISH_SECTIONS,
  GEOMETRY_OPTIONS,
  QUANTITY_FIELD,
} from '@/lib/captureFields';
import { toDisplay, toStored, unitLabel, UNIT_SYSTEMS } from '@/lib/units';
import { formatDateTime } from '@/lib/format';
import { useCaptureOptions } from '@/lib/useCaptureOptions';

const GEOMETRY_ICON = {
  rectangular: RectangleHorizontal,
  circular: Circle,
  sheet_metal: Layers,
  custom: Shapes,
};

/**
 * The right-hand pane's fields.
 *
 * Exactly the list the brief asks for, in that order. Options mirror
 * PartInfoEditor's so a value chosen here is the same string the part row's editor
 * offers — two different vocabularies for one column would make the same part read
 * differently on two screens.
 *
 * `surfaceFinish` is labelled "Finishing Process" here because that is what the
 * brief and the reference dashboards call it. Same column, the name the engineers
 * use.
 */
const METADATA_FIELDS = [
  { key: 'material', label: 'Material' },
  { key: 'moduleName', label: 'Module' },
  { key: 'productCategory', label: 'Product Category' },
  {
    key: 'assemblyLevel',
    label: 'Assembly Level',
    options: ['Level 0', 'Level 1', 'Level 2', 'Level 3', 'Level 4'],
  },
  {
    key: 'primaryProcess',
    label: 'Primary Process',
    options: [
      'Injection Molding', 'Stamping', 'Machining', 'Die Casting',
      'Extrusion', 'Assembly', 'PCB Fabrication', 'Purchased',
      'Sheet-metal fabrication', 'Coil fabrication & brazing',
    ],
  },
  {
    key: 'secondaryProcess',
    label: 'Secondary Process',
    options: ['Painting', 'Plating', 'Anodizing', 'Heat Treatment', 'Welding', 'None'],
  },
  {
    key: 'surfaceFinish',
    label: 'Finishing Process',
    options: ['As-moulded', 'Painted', 'Zinc Plated', 'Anodized', 'Powder Coated', 'Bare'],
  },
  { key: 'description', label: 'Remarks', textarea: true },
];

/** A hardware step that exists in the workflow but not yet in this build. */
function PlannedButton({ icon: Icon, children, onClick }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="border-dashed text-muted-foreground"
      // Not `disabled`: a dead control explains nothing. It responds, and says
      // what it will do once the hardware is connected — the same way the rest of
      // the app marks Planned features.
      title="Planned — hardware not connected in this build"
    >
      <Icon className="mr-1.5 size-4" />
      {children}
      <span className="ml-1.5 rounded bg-muted px-1 text-[10px] uppercase">Planned</span>
    </Button>
  );
}

/**
 * @param {object}   props
 * @param {object}   props.part          the part being captured
 * @param {Function} props.onPartSaved   refetch the teardown
 * @param {Function} props.onNextPart
 * @param {boolean}  props.hasNextPart
 */
export default function CaptureWorkstation({ part, onPartSaved, onNextPart, hasNextPart }) {
  // Display options — unit system, and whether the paint-thickness inputs are
  // shown. Both persist, because re-picking them on every part would make them
  // useless, and both are DISPLAY-only: nothing here changes what is stored.
  const { options, setUnitSystem, setHidePaintThickness } = useCaptureOptions();
  const imperial = options.unitSystem === UNIT_SYSTEMS.IMPERIAL;

  const geometry = part.geometryType ?? null;
  const fields = useMemo(
    () => fieldsForGeometry(geometry, { hidePaintThickness: options.hidePaintThickness }),
    [geometry, options.hidePaintThickness],
  );
  const counts = useMemo(() => countFieldsForGeometry(geometry), [geometry]);
  const finishes = useMemo(() => finishFieldsForGeometry(geometry), [geometry]);
  // The flat measurement list AND the Enter-advance sequence — deliberately the same
  // array, so what is walked is exactly what is rendered as a sequence. See
  // advanceSequenceForGeometry() for why the paint thicknesses are excluded.
  const measurementFields = useMemo(
    () => advanceSequenceForGeometry(geometry, { hidePaintThickness: options.hidePaintThickness }),
    [geometry, options.hidePaintThickness],
  );

  // ---- armed capture target ---------------------------------------------
  const [armedType, setArmedType] = useState(measurementFields[0]?.type ?? null);
  const [deviceFocused, setDeviceFocused] = useState(false);
  const inputRefs = useRef({});

  // Geometry changes replace the visible field set; an armed field that is no
  // longer on screen would leave the rig typing into nothing.
  //
  // The fallback is the first field in the SEQUENCE, not in `fields` — landing on a
  // paint thickness after a geometry change would be the same wrong destination the
  // advance bug produced, arrived at another way. The validity test still uses
  // `fields`, because a manually-armed paint thickness IS on screen and must stay
  // armed.
  const armed = fields.some((f) => f.type === armedType)
    ? armedType
    : (measurementFields[0]?.type ?? null);

  useEffect(() => {
    const el = inputRefs.current[armed];
    if (!el) return;
    // preventScroll: the default is to scroll the focused element into view, and
    // after a geometry change the layout has just shifted underneath it. Enter
    // should ADVANCE FOCUS ONLY — never move the page.
    el.focus({ preventScroll: true });
    el.select();
  }, [armed, part.id]);

  const [values, setValues] = useState({});
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const committingRef = useRef(false);

  // A new part clears the typed-but-uncommitted buffer. Not an effect: doing it
  // during render when the part id changes is React's documented adjustment, and
  // avoids a frame where the previous part's values sit in the new part's fields.
  const [valuesForPart, setValuesForPart] = useState(part.id);
  if (valuesForPart !== part.id) {
    setValuesForPart(part.id);
    setValues({});
    setError(null);
  }

  /**
   * Commit one measurement, then arm the next field.
   *
   * `rawFromInput` is the value read off the ELEMENT at the moment of the
   * keypress, and it takes precedence over React state.
   *
   * WHY. The measuring rig is a keyboard wedge: it writes into the DOM and sends
   * Enter, with no gap. Depending on React's onChange having already round-tripped
   * through state by the time the Enter handler runs makes the commit a race — and
   * it is a race this screen loses, while the single-input Rapid capture wizard
   * happens to win it. Reading the element is not a workaround for the framework;
   * it is reading the value from where the device actually put it.
   *
   * State stays the fallback, so a click-driven commit with no event still works.
   */
  async function commit(field, rawFromInput) {
    if (committingRef.current) return;
    const raw = (rawFromInput ?? values[field.type] ?? '').toString().trim();
    if (raw === '') return;
    // The engineer types in whatever system is selected; the column is always
    // metric. Converting HERE means nothing downstream — reports, exports,
    // Best-of-Best, the importers — ever sees an imperial number.
    const num = toStored(raw, field.unit, options.unitSystem);
    if (num === null) {
      setError(`"${raw}" is not a number`);
      return;
    }

    committingRef.current = true;
    setError(null);
    try {
      if (field.directToPart) {
        // Inner diameter and paint thickness are Part columns with no matching
        // MEASUREMENT_TYPE, so they are written directly. They still appear in the
        // session log — from the engineer's side it was the same action — but they
        // carry no capture-provenance row, and inventing a measurement type just to
        // manufacture one would be worse than the honest gap.
        await api.parts.update(part.id, { [field.partField]: num });
      } else {
        await api.capture.submitForPart(part.id, {
          measurements: [{ type: field.type, value: num, unit: field.unit }],
        });
      }
      setLog((prev) =>
        [
          { key: `${field.type}-${Date.now()}`, label: field.label, value: num, unit: field.unit, at: new Date().toISOString() },
          ...prev,
        ].slice(0, 12),
      );
      setValues((prev) => ({ ...prev, [field.type]: '' }));
      onPartSaved?.();

      // Advance along the DIMENSIONAL sequence, not the raw field list. Walking
      // `fields` sent Thickness -> External Paint Thickness, because that is where
      // the paint fields sit in CAPTURE_FIELDS even though they render in their own
      // sections further down the pane.
      //
      // The `i >= 0` guard is load-bearing: a paint thickness is not IN the sequence,
      // so findIndex returns -1 and `[-1 + 1]` would be element 0 — committing a
      // coating value would jump the rig back to Length. A field outside the sequence
      // simply stays armed, which is what someone who deliberately clicked into it
      // expects.
      const i = measurementFields.findIndex((f) => f.type === field.type);
      if (i >= 0) {
        const next = measurementFields[i + 1];
        if (next) setArmedType(next.type);
      }
    } catch (err) {
      // The typed value is deliberately kept so a failed commit can be retried
      // without re-reading the instrument.
      setError(err.message);
    } finally {
      committingRef.current = false;
    }
  }

  /** Geometry and the integer counts write straight to the Part — not measurements. */
  const patchPart = async (patch) => {
    setError(null);
    try {
      await api.parts.update(part.id, patch);
      onPartSaved?.();
    } catch (err) {
      setError(err.message);
    }
  };

  // ---- metadata pane -----------------------------------------------------
  const [meta, setMeta] = useState(() => Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, part[f.key] ?? ''])));
  const [metaForPart, setMetaForPart] = useState(part.id);
  if (metaForPart !== part.id) {
    setMetaForPart(part.id);
    setMeta(Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, part[f.key] ?? ''])));
  }
  const metaDirty = METADATA_FIELDS.some((f) => (meta[f.key] ?? '') !== (part[f.key] ?? ''));

  const saveMeta = async () => {
    setSaving(true);
    await patchPart(Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, meta[f.key] === '' ? null : meta[f.key]])));
    setSaving(false);
  };

  // ---- the part's primary image -----------------------------------------
  // The lead photo label's image if there is one, else the first part-scoped
  // photo. Two stores, because the two were built for different moments: labels
  // are the teardown's own naming, part photos predate it.
  const { data: leadImage, refetch: refetchLeadImage } = useApi(
    () => puiStore.getLabelImage(part.photoId),
    [part.photoId],
    { enabled: Boolean(part.photoId), keepPreviousData: true },
  );
  const { data: partPhotos, refetch: refetchPhotos } = useApi(
    () => photoStore.listByPart(part.id),
    [part.id],
    { keepPreviousData: true },
  );
  const primaryBlob = leadImage?.blob ?? partPhotos?.[0]?.blob ?? null;
  const primaryUrl = useMemo(
    () => (primaryBlob ? URL.createObjectURL(primaryBlob) : null),
    [primaryBlob],
  );
  useEffect(() => () => primaryUrl && URL.revokeObjectURL(primaryUrl), [primaryUrl]);

  // Which left-pane panel is open. Mutually exclusive — the pane is narrow, and
  // stacking a live camera above a label preview pushes the part photo off screen.
  const [leftPanel, setLeftPanel] = useState(null); // null | 'camera' | 'label'
  // Which label the preview is for, when opened from a specific one in the family
  // rather than from the part's lead label.
  const [labelOverride, setLabelOverride] = useState(null);

  // Allocating the Photo ID is a SERVER call, not a client-side increment: two
  // engineers at two benches must never be handed the same sticker. The repository
  // also points Part.photoId at the new lead label, so the header below and the
  // photo store key both pick it up from the refreshed part.
  const [allocating, setAllocating] = useState(false);
  const allocatePhotoId = async () => {
    setAllocating(true);
    try {
      // The route returns the PhotoLabel record itself, so `.label` is the string.
      // No prefix is passed: the service derives the series from the product, which
      // is what keeps one teardown's stickers in one sequence.
      const created = await api.photoLabels.allocate(part.id);
      await onPartSaved?.();
      setNotice(`Photo ID ${created.label} allocated. Photos and labels now use it.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setAllocating(false);
    }
  };

  const photoInputRef = useRef(null);
  /**
   * Store a photo against the PHOTO ID — the identifier the review made primary.
   *
   * Photos previously went to photoStore keyed by partId, which meant the Photo ID
   * named the label and the sticker but not the image, so the one identifier
   * everything else is supposed to hang off did not actually address the photo.
   * With a Photo ID present the image goes to puiStore under that label, which is
   * also where the Picture UI already looks — so a photo taken here is retrievable
   * by ID, which is the whole point.
   *
   * Falls back to the part-keyed store when the part has no label yet, rather than
   * refusing the photo: losing a shot because a sticker had not been allocated
   * would be the wrong trade at a bench.
   */
  const storePhoto = async (file) => {
    try {
      if (part.photoId) {
        await puiStore.putLabelImage(part.photoId, file);
        refetchLeadImage();
      } else {
        await photoStore.addPhotos(part.id, [file]);
        setNotice(
          'Saved against this part. Allocate a Photo ID below and photos will be stored under it, which is how they are retrieved later.',
        );
      }
      refetchPhotos();
    } catch (err) {
      setError(err.message);
    }
  };

  const onPickPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await storePhoto(file);
  };

  /**
   * One measurement row — label, armed input, and the value already on the record.
   *
   * A named helper rather than inline JSX because paint thickness is rendered inside
   * its own EXTERNAL/INTERNAL section further down while every other field is
   * rendered in the flat list. Two copies of an armed input would drift, and the
   * arming behaviour is the part of this pane it is least acceptable to get subtly
   * wrong in one place only.
   */
  const measurementRow = (field) => {
      const isArmed = field.type === armed;
      // The value already on the record, shown in the CHOSEN system so the
      // engineer is never comparing their inches against stored millimetres.
      const stored = toDisplay(part[field.partField], field.unit, options.unitSystem);
      const shownUnit = unitLabel(field.unit, options.unitSystem);
      return (
        <div key={field.type} className="flex items-center gap-2">
          <Label
            htmlFor={`cap-${field.type}`}
            className="w-28 shrink-0 text-xs font-normal text-muted-foreground"
          >
            {field.label}
          </Label>
          <div className="relative flex-1">
            <Input
              id={`cap-${field.type}`}
              ref={(el) => {
                inputRefs.current[field.type] = el;
              }}
              value={values[field.type] ?? ''}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.type]: e.target.value }))
              }
              onFocus={() => {
                setArmedType(field.type);
                setDeviceFocused(true);
              }}
              onBlur={(e) => {
                setDeviceFocused(false);
                // For a real MEASUREMENT, Enter commits and blur does not:
                // committing every measurement on blur was tried and
                // reverted because it raced the refetch a geometry change
                // triggers.
                //
                // `directToPart` fields are different and commit on blur.
                // Inner diameter and paint thickness are not instrument
                // readings — no rig sends them, a person types them — so
                // holding them hostage to a key the rig sends made them the
                // only fields on the pane you could fill in and silently
                // lose. Same shape as Quantity and the bend/punch counts,
                // which have been stable.
                if (field.directToPart) commit(field, e.target?.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(field, e.target?.value);
                }
              }}
              inputMode="decimal"
              placeholder={stored ?? ''}
              key={`${field.type}-${options.unitSystem}`}
              className={`h-9 pr-9 tabular-nums ${
                isArmed ? 'border-accent ring-2 ring-accent/40' : ''
              }`}
              aria-label={`${field.label} in ${shownUnit}`}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {shownUnit}
            </span>
          </div>
          {/* The value already on the part record, so the operator can see
              what they are replacing rather than overwriting it blind. */}
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {stored ?? '—'}
          </span>
        </div>
      );
  };

  return (
    <div className="space-y-3">
      {/* ---- armed-device bar ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
              deviceFocused
                ? 'bg-accent/25 text-accent-foreground'
                : 'bg-warning/15 text-warning'
            }`}
          >
            <Keyboard className="size-4" />
            {deviceFocused ? (
              <>
                DEVICE ARMED →{' '}
                <strong>{fields.find((f) => f.type === armed)?.label ?? '—'}</strong>
              </>
            ) : (
              'NOT ARMED — click a measurement field'
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            Type a value on the rig (or keyboard) and press Enter. Enter commits and arms the next
            field.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Metric / Imperial. DISPLAY ONLY — every column stays mm and grams, and
              a typed imperial value is converted before it is stored, so nothing
              downstream ever sees an inch. */}
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Unit system">
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              variant={imperial ? 'ghost' : 'default'}
              onClick={() => setUnitSystem(UNIT_SYSTEMS.METRIC)}
              aria-pressed={!imperial}
            >
              mm / g
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              variant={imperial ? 'default' : 'ghost'}
              onClick={() => setUnitSystem(UNIT_SYSTEMS.IMPERIAL)}
              aria-pressed={imperial}
            >
              in / lb
            </Button>
          </div>

          {/* A demo option. Hides the paint-thickness INPUTS; the columns and any
              recorded values are untouched, so turning it back on shows them. */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              id="opt-hide-paint"
              checked={options.hidePaintThickness}
              onChange={(e) => setHidePaintThickness(e.target.checked)}
              className="size-3.5"
            />
            Hide paint thickness
          </label>

          <Button size="sm" onClick={onNextPart} disabled={!hasNextPart}>
            <Check className="mr-1.5 size-4" />
            {hasNextPart ? 'Save & next part' : 'Last part'}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription className="flex items-start justify-between gap-3">
            <span className="text-sm">{notice}</span>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ---- the three panes ----
          Stacks below xl. A bench monitor gets three columns; a tablet held over a
          part gets one, in workflow order, which is the order the panes are
          declared in. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_minmax(300px,1fr)_minmax(280px,1fr)]">
        {/* ================= 1. THE PART ================= */}
        <section className="space-y-3 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              The part
            </h2>
            {/* The Photo ID, at the head of the pane it identifies. It is the key the
                photo above is STORED under, the string printed on the sticker, and how
                the shot is found again later — so it is shown, not buried in the label
                list below. Allocating it is one press when it is absent. */}
            {part.photoId ? (
              <Badge className="font-mono text-sm tracking-wider" data-testid="photo-id">
                {part.photoId}
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={allocating}
                onClick={allocatePhotoId}
                data-testid="allocate-photo-id"
              >
                <Tag className="mr-1.5 size-3.5" />
                {allocating ? 'Allocating…' : 'Get Photo ID'}
              </Button>
            )}
          </div>

          {/* ONE photo area. The camera opens INTO this frame rather than adding a
              second panel below it, so Take Photo does not become a separate photo
              experience — the preview appears where the photo will appear, and the
              capture replaces "No photo yet" in place. */}
          {leftPanel === 'camera' ? (
            <CameraCapture
              inline
              onCaptured={async (file) => {
                await storePhoto(file);
                setLeftPanel(null);
              }}
              onCancel={() => setLeftPanel(null)}
              onUploadInstead={() => {
                setLeftPanel(null);
                photoInputRef.current?.click();
              }}
            />
          ) : (
            <div
              className="overflow-hidden rounded-md border bg-muted/40"
              style={{ aspectRatio: '4 / 3' }}
            >
              {primaryUrl ? (
                <img src={primaryUrl} alt={part.name} className="size-full object-contain" />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Camera className="size-8" />
                  <p className="text-sm">No photo yet</p>
                  <p className="max-w-56 px-4 text-center text-xs">
                    Press Take Photo for a live preview here, or upload a file.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="hidden"
            />
            {/* One input, two entry points: `capture="environment"` asks a tablet
                for its rear camera and a desktop for a file picker. */}
            {/* Take Photo opens a CAMERA. It used to open this same file input,
                which made the button a lie on a desktop and only accidentally
                right on a tablet. */}
            <Button
              variant={leftPanel === 'camera' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeftPanel(leftPanel === 'camera' ? null : 'camera')}
            >
              <Camera className="mr-1.5 size-4" />
              Take Photo
            </Button>
            <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()}>
              <Upload className="mr-1.5 size-4" />
              Upload
            </Button>
            {/* No longer a Planned stub: it generates and previews the real label
                content. Only the direct printer connection is outstanding, and the
                browser print dialog covers it in the meantime. */}
            <Button
              variant={leftPanel === 'label' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (!part.photoId) {
                  setNotice(
                    'This part has no Photo ID yet. Use "Next label" below to take the next sticker in the series, then print it.',
                  );
                  return;
                }
                setLabelOverride(null);
                setLeftPanel(leftPanel === 'label' ? null : 'label');
              }}
            >
              <Printer className="mr-1.5 size-4" />
              Print Label
            </Button>
          </div>

          {leftPanel === 'label' && (labelOverride?.label ?? part.photoId) && (
            <LabelPreview
              label={labelOverride?.label ?? part.photoId}
              view={labelOverride?.view ?? null}
              part={part}
              onClose={() => setLeftPanel(null)}
            />
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Photo ID / labels
            </p>
            <PhotoLabelFamily
              part={part}
              onChanged={onPartSaved}
              compact
              // Per-label printing goes through the SAME preview, so a label printed
              // from the family and one printed from the button above cannot come
              // out differently.
              onPrintLabel={(entry) => {
                setLabelOverride({ label: entry.label, view: entry.view });
                setLeftPanel('label');
              }}
            />
          </div>
        </section>

        {/* ================= 2. MEASUREMENTS ================= */}
        <section className="space-y-3 rounded-lg border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Measurements
          </h2>

          {/* Geometry sits at the TOP of this pane, not in the left one, because it
              GATES the fields directly beneath it — a sheet-metal part reveals
              Unfolded L/W and Bends. Putting the control a column away from its
              own effect would hide the cause. */}
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Geometry</p>
            <div className="grid grid-cols-2 gap-2">
              {GEOMETRY_OPTIONS.map((opt) => {
                const Icon = GEOMETRY_ICON[opt.value];
                const active = geometry === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patchPart({ geometryType: opt.value })}
                    className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs font-medium transition-colors ${
                      active ? 'border-accent bg-accent/15' : 'hover:border-accent'
                    }`}
                    aria-pressed={active}
                  >
                    <Icon className="size-5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">{measurementFields.map(measurementRow)}</div>

          {/* ---- per-face finish + coating thickness ----
              EXTERNAL section first, INTERNAL second, exactly as reviewed. A formed
              panel is coated differently on each side — external powder coat over
              internal primer is the normal case — so each face gets its finish NAME
              and its own thickness together. Grouping them this way is the point of
              the change: a single "paint thickness" forced a choice between recording
              the outside or the inside.

              The thickness rows come from `fields`, so the hide-paint-thickness demo
              option removes them here too, leaving the finish names in place. */}
          {FINISH_SECTIONS.map(({ key, heading }) => {
            const finish = finishes.find((f) => f.section === key);
            const thickness = fields.find((f) => f.isPaintThickness && f.section === key);
            if (!finish && !thickness) return null;
            return (
              <div key={key} className="space-y-2 border-t pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {heading}
                </p>
                {finish && (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`fin-${finish.key}`}
                      className="w-28 shrink-0 text-xs font-normal text-muted-foreground"
                    >
                      {finish.label}
                    </Label>
                    <Input
                      id={`fin-${finish.key}`}
                      list={`fin-opts-${finish.key}`}
                      // Re-keyed on the saved value so the field picks up a refetch
                      // rather than holding a stale defaultValue.
                      key={`${finish.key}-${part.id}-${part[finish.key] ?? ''}`}
                      defaultValue={part[finish.key] ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === (part[finish.key] ?? '')) return;
                        patchPart({ [finish.key]: v === '' ? null : v });
                      }}
                      className="h-9 flex-1"
                      placeholder="Coating"
                    />
                    {/* A datalist, not a select: imported BOMs already carry finish
                        names outside any list this app would fix. */}
                    <datalist id={`fin-opts-${finish.key}`}>
                      {FINISH_OPTIONS.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                    <span className="w-20 shrink-0" />
                  </div>
                )}
                {thickness && measurementRow(thickness)}
              </div>
            );
          })}

          {/* Quantity — shown for EVERY geometry, because it was in all four review
              lists and because every extended cost and weight rollup multiplies by
              it. Not a measurement: no instrument reads a count. Committed on blur
              rather than on Enter, since Enter belongs to the armed measurement
              sequence and must not be hijacked by a field sitting outside it. */}
          <div className="flex items-center gap-2 border-t pt-2">
            <Label
              htmlFor={`cap-${QUANTITY_FIELD.key}`}
              className="w-28 shrink-0 text-xs font-normal text-muted-foreground"
            >
              {QUANTITY_FIELD.label}
            </Label>
            <Input
              id={`cap-${QUANTITY_FIELD.key}`}
              key={`qty-${part.id}-${part.quantity}`}
              defaultValue={part.quantity ?? 1}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (raw === '' || Number(raw) === part.quantity) return;
                const n = Number(raw);
                if (!Number.isInteger(n) || n < 1) {
                  setError('Quantity must be a whole number of 1 or more.');
                  e.target.value = part.quantity ?? 1;
                  return;
                }
                patchPart({ quantity: n });
              }}
              className="h-9 w-24 tabular-nums"
              inputMode="numeric"
            />
            <span className="text-xs text-muted-foreground">
              multiplies this line's cost and weight
            </span>
          </div>

          {counts.length > 0 && (
            <div className="flex flex-wrap gap-3 border-t pt-2">
              {counts.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <Label
                    htmlFor={`cnt-${c.key}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {c.label}
                  </Label>
                  <Input
                    id={`cnt-${c.key}`}
                    defaultValue={part[c.key] ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v === (part[c.key] ?? '').toString()) return;
                      patchPart({ [c.key]: v === '' ? null : Number(v) });
                    }}
                    className="h-8 w-16 tabular-nums"
                    inputMode="numeric"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-2">
            <PlannedButton
              icon={Scale}
              onClick={() =>
                setNotice(
                  'Weight scale integration is planned — the scale would write into the Weight field and commit it.',
                )
              }
            >
              Read Scale
            </PlannedButton>
            <PlannedButton
              icon={Sigma}
              onClick={() =>
                setNotice(
                  'Compute is planned. Deriving weight from volume needs a material density table, and unfolded length from bends needs a bend-deduction table — neither exists in this build, so nothing is guessed here.',
                )
              }
            >
              Compute
            </PlannedButton>
          </div>

          <div className="border-t pt-2">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Captured this session
            </p>
            {log.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing yet. Each Enter is recorded here with its timestamp.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {log.map((entry) => (
                  <li key={entry.key} className="flex items-baseline gap-2 text-xs">
                    <Check className="size-3 shrink-0 text-accent-foreground" />
                    <span className="w-24 shrink-0 text-muted-foreground">{entry.label}</span>
                    <span className="font-medium tabular-nums">
                      {entry.value} {entry.unit}
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(entry.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ================= 3. ENGINEERING METADATA ================= */}
        <section className="space-y-3 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Engineering metadata
            </h2>
            {metaDirty && (
              <Badge variant="outline" className="text-warning">
                Unsaved
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            {METADATA_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label
                  htmlFor={`meta-${field.key}`}
                  className="text-xs font-normal text-muted-foreground"
                >
                  {field.label}
                </Label>
                {field.textarea ? (
                  <textarea
                    id={`meta-${field.key}`}
                    value={meta[field.key] ?? ''}
                    onChange={(e) => setMeta((p) => ({ ...p, [field.key]: e.target.value }))}
                    rows={2}
                    className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
                  />
                ) : field.options ? (
                  // Native select, not the Radix combobox: opening a Radix listbox
                  // moves focus, which un-arms the measuring rig mid-session.
                  <>
                    <Input
                      id={`meta-${field.key}`}
                      list={`meta-opts-${field.key}`}
                      value={meta[field.key] ?? ''}
                      onChange={(e) => setMeta((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="h-8"
                    />
                    {/* A datalist rather than a closed select — the seeded and
                        imported data already contain process names outside any
                        fixed list, and a select would make those uneditable. */}
                    <datalist id={`meta-opts-${field.key}`}>
                      {field.options.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <Input
                    id={`meta-${field.key}`}
                    value={meta[field.key] ?? ''}
                    onChange={(e) => setMeta((p) => ({ ...p, [field.key]: e.target.value }))}
                    className="h-8"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t pt-2">
            <Button size="sm" onClick={saveMeta} disabled={!metaDirty || saving}>
              <Save className="mr-1.5 size-4" />
              {saving ? 'Saving…' : 'Save metadata'}
            </Button>
            {!metaDirty && <span className="text-xs text-muted-foreground">Up to date</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
