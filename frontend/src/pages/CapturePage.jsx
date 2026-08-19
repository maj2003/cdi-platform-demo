// ---------------------------------------------------------------------------
// src/pages/CapturePage.jsx — route /products/:id/capture
//
// HID KEYBOARD-INPUT MODE
//
// The capture rig behaves like a barcode scanner: it "types" a value into
// whatever field currently has focus, then sends Enter. There is no driver to
// talk to and no button to click — the whole job of this page is to keep
// exactly one input focused at all times and to know what the next keystroke
// means. That is why:
//   - focus is re-asserted by effect on every step, not just on mount
//   - the part picker is a native <select> (a custom listbox would steal
//     focus on open and silently break capture mid-session)
//   - the input is never disabled while a commit is in flight — disabling it
//     would drop whatever the device sends next
//
// Order is fixed: length -> width -> height -> weight -> next part, with no
// wrap at the end. That mirrors how an operator actually walks a teardown.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FolderPlus, Keyboard, LayoutGrid } from 'lucide-react';

import api, { PERSONAS } from '@/lib/api';
import { useApi, useApiAction } from '@/lib/useApi';
import ProductSubNav from '@/components/ProductSubNav';
import BomStructureTree from '@/components/capture/BomStructureTree';
import CaptureWorkstation from '@/components/capture/CaptureWorkstation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';

/**
 * Measurement.type -> capture-form field, in walk order.
 *
 * Mirrors the backend's MEASUREMENT_TYPES / Part columns. Duplicated rather
 * than imported for the same reason api.js duplicates PERSONAS: frontend/ and
 * backend/ are separate npm packages, so this is the one place to update if
 * the backend's constant ever changes shape.
 */
const FIELDS = [
  { type: 'dimension_length', label: 'Length', unit: 'mm', partField: 'lengthMm' },
  { type: 'dimension_width', label: 'Width', unit: 'mm', partField: 'widthMm' },
  { type: 'dimension_height', label: 'Height', unit: 'mm', partField: 'heightMm' },
  { type: 'weight', label: 'Weight', unit: 'g', partField: 'weightG' },
];

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-48" />
    </div>
  );
}

export default function CapturePage() {
  const { id } = useParams();

  const {
    data: teardown,
    loading,
    error,
    refetch,
  } = useApi(({ signal }) => api.products.teardown(id, { signal }), [id], {
    // THE SCROLLING BUG.
    //
    // Without keepPreviousData, every refetch blanks `teardown` while in flight,
    // hits the loading guard below, and unmounts the ENTIRE page to a skeleton.
    // The workstation calls refetch after every geometry change and every
    // committed dimension, so each one tore the page down and rebuilt it — which
    // lost focus and let the remounted BOM tree scroll the window to the bottom.
    //
    // Exactly the fix ProductDetailPage already carries for the same reason (see
    // its note: PartGeometryEditor calls refetch after every save).
    keepPreviousData: true,
  });

  // Flatten in the order the API already returns it (sub-assembly name, then
  // part name) — a stable, predictable walk order for the operator.
  const flatParts = useMemo(() => {
    if (!teardown) return [];
    return teardown.subAssemblies.flatMap((sub) =>
      sub.parts.map((part) => ({ ...part, subAssemblyName: sub.name })),
    );
  }, [teardown]);

  // Which capture experience. The WORKSTATION is the default — three panes over
  // one part, the redesign's subject. RAPID is the original keyboard-wedge wizard,
  // kept because its single-focused-input rhythm is what a hundred-part session
  // actually runs on, and because its whole design premise (exactly one focusable
  // field) cannot survive inside a workstation.
  const [mode, setMode] = useState('workstation');

  const [partIndex, setPartIndex] = useState(0);

  // ---- arriving from the New Project wizard -------------------------------
  // `?part=` selects the part the wizard just created, so the engineer is
  // measuring the thing they named rather than whichever part happens to be first
  // in the teardown. `?from=project` puts a "Back to project" action in the header
  // — the return leg, so creating a part is a round trip rather than a one-way
  // door out of the wizard.
  //
  // Applied during render on a derived-state latch rather than in an effect: an
  // effect would render the wrong part for one frame, and a synchronous setState
  // in an effect body is what React's compiler lint rejects (the same pattern
  // CaptureWorkstation uses for its per-part buffer reset).
  const [searchParams] = useSearchParams();
  const requestedPartId = Number(searchParams.get('part')) || null;
  const cameFromProject = searchParams.get('from') === 'project';

  const [appliedPartId, setAppliedPartId] = useState(null);
  if (requestedPartId && appliedPartId !== requestedPartId && flatParts.length > 0) {
    const index = flatParts.findIndex((p) => p.id === requestedPartId);
    setAppliedPartId(requestedPartId);
    // Guarded: a stale link to a deleted part must leave the station on a real
    // part rather than jumping to index -1 and rendering nothing.
    if (index >= 0) setPartIndex(index);
  }
  const [fieldIndex, setFieldIndex] = useState(0);
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState(null);
  const [log, setLog] = useState([]); // this session's commits, newest first

  // What the server has confirmed this session, keyed by partId. Lets the
  // "part record" reference stay accurate as the operator moves through a
  // part without re-fetching the whole teardown on every keystroke — a
  // refetch would swap in the page's loading skeleton and drop focus, which
  // is exactly what HID mode can't tolerate.
  const [capturedPatches, setCapturedPatches] = useState({});

  const inputRef = useRef(null);
  const committingRef = useRef(false); // guards double-commit without disabling the input

  const submit = useApiAction((partId, body) => api.capture.submitForPart(partId, body));

  // The BOM structure tree shows each part's extended cost. It comes from the cost
  // report like everywhere else in this app — a second definition of a total in the
  // browser is how two screens start disagreeing.
  const { data: costReport } = useApi(
    ({ signal }) => api.reports.get(id, PERSONAS.COST_ENGINEER, { signal }),
    [id],
  );
  const costingByPart = useMemo(() => {
    const byPart = costReport?.payload?.byPart;
    if (!byPart) return null;
    return new Map(byPart.map((row) => [row.partId, row]));
  }, [costReport]);

  const currentPart = flatParts[partIndex] ?? null;
  const currentField = FIELDS[fieldIndex] ?? null;
  const done = flatParts.length > 0 && partIndex >= flatParts.length;

  useEffect(() => {
    if (!done) inputRef.current?.focus();
  }, [partIndex, fieldIndex, done]);

  // `&& !teardown`, not just `loading`: with keepPreviousData a background
  // refetch keeps the previous tree, and the skeleton must only appear on the
  // FIRST load. Guarding on `loading` alone would defeat the fix above.
  if (loading && !teardown) return <LoadingSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {error.status === 404
            ? 'Product not found'
            : error.isNetworkError
              ? 'Cannot reach the API'
              : 'Could not load teardown'}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error.message}</p>
          <div className="flex gap-2">
            {error.status !== 404 && (
              <Button variant="outline" size="sm" onClick={refetch}>
                Try again
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to={error.status === 404 ? '/products' : `/products/${id}`}>
                {error.status === 404 ? 'All products' : 'Back to teardown'}
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  async function commit() {
    if (committingRef.current || !currentPart || !currentField) return;

    const trimmed = value.trim();
    const num = Number(trimmed);
    if (trimmed === '' || Number.isNaN(num)) {
      submit.reset(); // don't leave a stale server error next to a fresh client one
      setValidationError(`"${value}" is not a number`);
      return;
    }

    committingRef.current = true;
    setValidationError(null);

    try {
      await submit.run(currentPart.id, {
        measurements: [{ type: currentField.type, value: num, unit: currentField.unit }],
      });

      setCapturedPatches((prev) => ({
        ...prev,
        [currentPart.id]: { ...prev[currentPart.id], [currentField.partField]: num },
      }));

      setLog((prev) =>
        [
          {
            key: `${currentPart.id}-${currentField.type}-${Date.now()}`,
            partName: currentPart.name,
            fieldLabel: currentField.label,
            value: num,
            unit: currentField.unit,
            at: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 20),
      );

      setValue('');
      if (fieldIndex + 1 < FIELDS.length) {
        setFieldIndex(fieldIndex + 1);
      } else if (partIndex + 1 < flatParts.length) {
        setPartIndex(partIndex + 1);
        setFieldIndex(0);
      } else {
        setPartIndex(partIndex + 1); // one past the end => done, no wrap
      }
    } catch {
      // submit.error carries the message; keep the typed value so the
      // operator can retry without re-entering it.
    } finally {
      committingRef.current = false;
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  }

  function jumpToPart(index) {
    setPartIndex(index);
    setFieldIndex(0);
    setValue('');
    setValidationError(null);
    submit.reset();
  }

  const referenceValue = currentPart && currentField
    ? capturedPatches[currentPart.id]?.[currentField.partField] ?? currentPart[currentField.partField]
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {/* Back where you came from. Arriving from the wizard, "All products" is
            the wrong exit — it drops the engineer into the catalog with the project
            abandoned. The wizard restores the model and module it had open, so this
            lands on the part that was just captured. */}
        {cameFromProject ? (
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/new-project">
              <ArrowLeft className="mr-1 size-4" />
              Back to project
              <FolderPlus className="ml-1.5 size-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/products">
              <ArrowLeft className="mr-1 size-4" />
              All products
            </Link>
          </Button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              BOM Capture — {teardown.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === 'workstation'
                ? 'Photograph the part, label it, measure it, classify it, save. The measuring rig types into the armed field.'
                : 'Keyboard-input mode: type a value on the connected device (or keyboard) and press Enter. Focus stays on the active field.'}
            </p>
          </div>

          {/* Two capture experiences over the same data, switched not migrated —
              see the note on `mode`. */}
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Capture mode">
            <Button
              size="sm"
              variant={mode === 'workstation' ? 'default' : 'ghost'}
              onClick={() => setMode('workstation')}
              aria-pressed={mode === 'workstation'}
            >
              <LayoutGrid className="mr-1.5 size-4" />
              Workstation
            </Button>
            <Button
              size="sm"
              variant={mode === 'rapid' ? 'default' : 'ghost'}
              onClick={() => setMode('rapid')}
              aria-pressed={mode === 'rapid'}
            >
              <Keyboard className="mr-1.5 size-4" />
              Rapid capture
            </Button>
          </div>
        </div>
        <ProductSubNav productId={id} />
      </div>

      {flatParts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            This product has no parts to capture yet.
          </CardContent>
        </Card>
      ) : mode === 'workstation' ? (
        <>
          {/* The workstation walks the same flat part list the wizard does, so the
              two modes share their place in the teardown — switching mode keeps you
              on the part you were holding. `done` is a wizard concept (one past the
              end) and is clamped away here: a workstation has no end state, you
              simply stop. */}
          <CaptureWorkstation
            part={flatParts[Math.min(partIndex, flatParts.length - 1)]}
            onPartSaved={refetch}
            onNextPart={() => setPartIndex((i) => Math.min(i + 1, flatParts.length - 1))}
            hasNextPart={partIndex < flatParts.length - 1}
          />
          <BomStructureTree
            teardown={teardown}
            currentPartId={flatParts[Math.min(partIndex, flatParts.length - 1)]?.id}
            onSelectPart={(partId) => {
              const index = flatParts.findIndex((p) => p.id === partId);
              if (index !== -1) jumpToPart(index);
            }}
            costingByPart={costingByPart}
            currency={costReport?.payload?.currency ?? 'USD'}
          />
        </>
      ) : done ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            {/* Muted, not green — the sentence below already says "done";
                the icon doesn't need to repeat that with color. */}
            <CheckCircle2 className="size-8 text-muted-foreground" />
            <p className="font-medium">All parts captured for this teardown.</p>
            <div className="flex gap-2">
              <Button asChild size="sm">
                <Link to={`/products/${id}`}>View teardown</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to={`/products/${id}/reports`}>View reports</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="part-select">Jump to part</Label>
              {/* Native <select>, not the Radix combobox used elsewhere in this
                  app — Radix's listbox steals focus on open, which would break
                  HID mode the instant the operator's device types into a field
                  that silently isn't focused any more. */}
              <select
                id="part-select"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={partIndex}
                onChange={(e) => jumpToPart(Number(e.target.value))}
              >
                {flatParts.map((part, i) => (
                  <option key={part.id} value={i}>
                    {part.subAssemblyName} — {part.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">
              Part {partIndex + 1} of {flatParts.length}
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                <span>{currentPart.name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  Step {fieldIndex + 1} of {FIELDS.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="capture-value">
                  {currentField.label} ({currentField.unit})
                </Label>
                <Input
                  id="capture-value"
                  ref={inputRef}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setValidationError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  aria-invalid={Boolean(validationError)}
                  autoComplete="off"
                  className="h-12 text-lg"
                  placeholder={referenceValue != null ? String(referenceValue) : ''}
                />
                {validationError && <p className="text-sm text-destructive">{validationError}</p>}
                {referenceValue !== null && referenceValue !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Part record: {referenceValue} {currentField.unit}
                  </p>
                )}
              </div>

              {submit.error && (
                <Alert variant="destructive">
                  <AlertTitle>Capture failed</AlertTitle>
                  <AlertDescription>{submit.error.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {log.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  This session
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {log.map((entry) => (
                    <li key={entry.key} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="w-20 shrink-0 text-muted-foreground">
                        {entry.fieldLabel}
                      </span>
                      <span className="font-medium tabular-nums">
                        {entry.value} {entry.unit}
                      </span>
                      <span className="text-muted-foreground">{entry.partName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(entry.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
