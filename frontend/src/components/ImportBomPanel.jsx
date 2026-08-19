// ---------------------------------------------------------------------------
// src/components/ImportBomPanel.jsx
//
// The "Import BOM" flow: pick a workbook, see exactly what was parsed out of it,
// correct the product records, then commit.
//
// ---------------------------------------------------------------------------
// WHY PARSE-THEN-CONFIRM, RATHER THAN ONE-CLICK IMPORT
//
// The parse makes real judgement calls the user should see before anything is
// written: which format the file is, which sheets it recognised, how many rows it
// discarded as outline furniture, which module names it corrected — and, most
// importantly, a product name/brand/category that may have been GUESSED. Writing
// a competitor teardown into the database under a wrong model number and only
// finding out later is a much worse outcome than one extra click. So the panel
// shows its work, flags what it inferred, and lets the fields be edited first.
//
// ---------------------------------------------------------------------------
// WHY THIS RENDERS A LIST OF PRODUCTS
//
// The two supported formats have different shapes. A CEDARS export is ten
// commodity sheets describing ONE product; a Daikin Mapped BOM workbook is one
// sheet per product and routinely carries four. importWorkbook.js normalises both
// to an array, so this panel has one review-and-commit path rather than two, and
// a CEDARS file simply renders a list of one — its behaviour is unchanged,
// including navigating straight to the imported product on success.
//
// Each product is committed with a SEPARATE POST to the existing single-product
// endpoint, which is why the backend needed no change at all. They run in
// sequence, not in parallel: four concurrent nested writes into one SQLite file
// is how you get a busy-timeout, and the per-product progress is more useful to
// watch than it would be to save two seconds.
// ---------------------------------------------------------------------------

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '@/lib/api';
import { FORMAT_LABELS, importBomFile } from '@/lib/importWorkbook';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** The CEDARS spec's suggested curated size, offered as an opt-in per product. */
const DEMO_CAP = 40;

const PRODUCT_FIELDS = [
  { key: 'brand', label: 'Brand' },
  { key: 'name', label: 'Model / name' },
  { key: 'category', label: 'Category' },
];

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Tally({ label, entries }) {
  const list = Object.entries(entries ?? {});
  if (!list.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map(([name, count]) => (
          <Badge key={name} variant="outline" className="font-normal">
            {name} · {count}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Everything the import is NOT doing, per product.
 *
 * Deliberately one component covering both formats — the fields are simply
 * absent on the format that doesn't produce them. Splitting it in two would mean
 * a caveat added for one format silently never showing for the other.
 */
function Caveats({ s }) {
  const items = [];

  if (s.droppedByCap > 0) {
    items.push(
      <li key="cap">
        <strong>{s.droppedByCap} parts dropped by the {DEMO_CAP}-part cap</strong> — the lowest
        extended-cost rows. Turn the cap off to import all {s.partLines + s.droppedByCap}.
      </li>,
    );
  }
  // ---- Mapped BOM ----
  if (Object.keys(s.modulesCanonicalised ?? {}).length > 0) {
    items.push(
      <li key="canon">
        Module names corrected to match the rest of the repository:{' '}
        {Object.entries(s.modulesCanonicalised)
          .map(([from, to]) => `"${from}" → "${to}"`)
          .join(', ')}
        . Left as-is they would never match another product's module.
      </li>,
    );
  }
  if (s.emptyModules?.length > 0) {
    items.push(
      <li key="empty">
        {s.emptyModules.join(', ')} declared in the outline but carrying no parts —{' '}
        <strong>not created</strong>, because an empty module would read as a module this product
        has.
      </li>,
    );
  }
  if (s.uncostedRows > 0) {
    items.push(
      <li key="uncosted">
        {s.uncostedRows} parts have no cost in the source, so they import{' '}
        <strong>uncosted</strong> rather than as $0.00.
      </li>,
    );
  }
  if (s.fractionalQuantityRows > 0) {
    items.push(
      <li key="frac">
        {s.fractionalQuantityRows} rows have a fractional quantity, which the quantity column
        can't hold; the fraction is folded into the unit cost so module totals stay correct.
      </li>,
    );
  }
  if (s.rateDivergedRows > 0) {
    items.push(
      <li key="rate">
        {s.rateDivergedRows} rows where Rate / Unit × Qty disagrees with Cost / Set — expected on
        Make parts, whose rate is a material rate. Cost / Set was used.
      </li>,
    );
  }
  // ---- CEDARS ----
  if (s.laborRowsSkipped > 0) {
    items.push(
      <li key="labor">
        {s.laborRowsSkipped} Labor rows skipped — that sheet holds times, not rates, so a labour
        cost can't be derived from it.
      </li>,
    );
  }
  if (s.costDivergedRows > 0) {
    items.push(
      <li key="costdiv">
        {s.costDivergedRows} rows where Total Cost disagreed with Cost Per part; the Total Cost
        figure was used so module totals match the spreadsheet.
      </li>,
    );
  }
  if (s.costFromMaterialOnlyRows > 0) {
    items.push(
      <li key="matonly">
        {s.costFromMaterialOnlyRows} rows priced from Cost Material only, which may understate
        them.
      </li>,
    );
  }
  if (s.strikingDifferencesFound > 0) {
    items.push(
      <li key="striking">
        {s.strikingDifferencesFound} Striking Differences entries parsed but{' '}
        <strong>not stored</strong> — there's no screen for the photo/feature comparison yet.
      </li>,
    );
  }

  if (!items.length) return null;
  return (
    <Alert>
      <AlertTitle>What this import leaves out</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4 text-sm">{items}</ul>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Parsed totals vs the totals the workbook states for itself.
 *
 * The Mapped BOM format carries `Subtotal <module>` and `GRAND TOTAL` rows —
 * the mapping author's own arithmetic. Showing this comparison answers the
 * question a stakeholder actually asks ("will your numbers match the
 * spreadsheet I sent?") before the import happens rather than after.
 */
function Reconciliation({ s }) {
  if (!s.reconciliation?.length) return null;

  const costOk = (s.worstCostDelta ?? 0) <= 0.011;
  const weightExplained = s.weightFromUnitFallbackRows > 0;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-medium">Reconciled against the file's own subtotals</p>
        <Badge variant="outline" className={costOk ? '' : 'text-warning'}>
          worst module gap ${Math.abs(s.worstCostDelta ?? 0).toFixed(2)} ·{' '}
          {Math.abs(s.worstWeightDeltaG ?? 0).toFixed(1)} g
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {costOk
          ? 'Costs match to within a cent per module — the residue is the source rounding each row to two decimals.'
          : 'Costs differ from the stated subtotals by more than rounding explains. Worth checking before importing.'}
        {weightExplained &&
          ` ${s.weightFromUnitFallbackRows} row${
            s.weightFromUnitFallbackRows === 1 ? '' : 's'
          } state a 0 extended weight but a real per-unit weight, so the per-unit figure was used — that is the whole of any weight difference.`}
      </p>
      {s.statedGrandTotal && (
        <p className="text-xs text-muted-foreground tabular-nums">
          File's GRAND TOTAL: ${(s.statedGrandTotal.cost ?? 0).toFixed(2)} ·{' '}
          {((s.statedGrandTotal.weightG ?? 0) / 1000).toFixed(2)} kg
        </p>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {() => void} props.onClose   the page owns the trigger button, so it
 *   also owns open/closed — this panel only renders when open
 * @param {(created?: Array<{id: number, brand: string, name: string}>) => void}
 *   [props.onImported]  refetch hook for the product list. Receives the models this
 *   import CREATED, so a caller that needs to act on them — the New Project wizard
 *   selects and opens them, since an import that appears to do nothing is the
 *   complaint it was fixing — does not have to diff the list before and after.
 *   Callers that only refetch (the repository page) ignore the argument.
 * @param {boolean} [props.navigateOnSingle=true]  after a single-product import, go
 *   to the new teardown. The wizard turns this off so the import stays in the flow.
 */
export default function ImportBomPanel({ onClose, onImported, navigateOnSingle = true }) {
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [parsed, setParsed] = useState(null);
  /** One editable product record per parsed sheet, index-aligned with parsed.products. */
  const [edits, setEdits] = useState([]);
  const [included, setIncluded] = useState([]);
  const [capParts, setCapParts] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const [committing, setCommitting] = useState(false);
  /** Per-product outcome, so a partial import reports honestly. */
  const [results, setResults] = useState(null);

  /**
   * Refetching the product list is DEFERRED until this panel closes, and that is
   * load-bearing rather than tidy.
   *
   * ProductsPage does `if (loading) return <LoadingList />`, so calling its
   * refetch while this panel is open unmounts the panel mid-render and takes
   * `results` with it. With a single-product CEDARS import that was invisible —
   * the panel navigated away on success anyway. With a four-product workbook it
   * destroys the only report of what was written, links included, the instant
   * the list comes back. So the flag is raised here and spent on close.
   */
  const pendingRefetch = useRef(false);
  /**
   * The models this import created, carried alongside the pending flag.
   *
   * A ref rather than state for the same reason as the flag: it is read once on
   * close, and putting it in state would re-render the panel for a value nothing
   * on screen shows.
   */
  const createdModels = useRef([]);
  const flushRefetch = () => {
    if (pendingRefetch.current) {
      pendingRefetch.current = false;
      const created = createdModels.current;
      createdModels.current = [];
      onImported?.(created);
    }
  };

  const reset = () => {
    setParsed(null);
    setEdits([]);
    setIncluded([]);
    setParseError(null);
    setCapParts(false);
    setReplaceExisting(false);
    setResults(null);
    setCommitting(false);
    // Clearing the input's value matters: picking the SAME file twice in a row
    // fires no change event otherwise, so a re-import after a failed attempt
    // would look like a dead button.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** Re-parse with the current cap setting — the cap changes which parts survive. */
  const parseFile = async (file, { cap }) => {
    setParsing(true);
    setParseError(null);
    setResults(null);
    try {
      const result = await importBomFile(file, { maxParts: cap ? DEMO_CAP : null });
      setParsed({ ...result, file });
      setEdits(result.products.map((p) => ({ ...p.product })));
      // Template/reference sheets start UNTICKED. A real workbook carries working
      // sheets next to the product ones, and one of them — "Reference BOM -
      // Template" — was imported as a manufacturer called "Reference BOM -
      // Template" with a refrigerator part in it. The sheet is still parsed and
      // still listed with its reasons, so including it is one click; see
      // importMappedBom.js for why this unticks rather than drops.
      setIncluded(result.products.map((p) => !p.summary.isLikelyTemplate));
    } catch (err) {
      setParsed(null);
      setEdits([]);
      setIncluded([]);
      setParseError(err);
    } finally {
      setParsing(false);
    }
  };

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await parseFile(file, { cap: capParts });
  };

  const onToggleCap = async (checked) => {
    setCapParts(checked);
    if (parsed?.file) await parseFile(parsed.file, { cap: checked });
  };

  const setEdit = (i, field, value) =>
    setEdits((prev) => prev.map((p, j) => (j === i ? { ...p, [field]: value } : p)));

  /**
   * Commit each included product in turn.
   *
   * A failure on one does NOT abort the rest. With four products in a file, a
   * single 409 on an already-imported model shouldn't cost the user the other
   * three — so every outcome is collected and reported together, and the panel
   * stays open so a partial result is visible rather than being navigated away
   * from.
   */
  const onCommit = async () => {
    setCommitting(true);
    setResults(null);
    const outcomes = [];

    for (let i = 0; i < parsed.products.length; i += 1) {
      if (!included[i]) continue;
      const entry = parsed.products[i];
      const label = `${edits[i].brand} ${edits[i].name}`;
      try {
        const { product } = await api.products.import({
          product: edits[i],
          parts: entry.parts,
          replaceExisting,
          // So each module's description names the file it actually came from.
          sourceLabel: FORMAT_LABELS[parsed.format] ?? 'BOM import',
        });
        outcomes.push({ label, sheet: entry.summary.sheet, status: 'ok', product });
      } catch (err) {
        outcomes.push({ label, sheet: entry.summary.sheet, status: 'error', error: err });
      }
      // Rendered as it goes, so a four-product import isn't a frozen button.
      setResults([...outcomes]);
    }

    setCommitting(false);
    const succeeded = outcomes.filter((o) => o.status === 'ok');
    if (succeeded.length) {
      pendingRefetch.current = true;
      createdModels.current = succeeded.map((o) => o.product).filter(Boolean);
    }
    // A single-product file (every CEDARS export) keeps its original behaviour on
    // the repository page: go straight to the teardown that was just created.
    // Nothing is left on screen to protect, so the refetch can go out now.
    //
    // The New Project wizard turns that OFF. There, an import is how a MODEL gets
    // created, and the next step is the module list one section down — navigating to
    // the teardown would abandon the flow and make the wizard's own "the import
    // created this model, here are its modules" impossible to show. The refetch
    // still fires, so the caller learns what was created either way.
    if (succeeded.length === 1 && outcomes.length === 1) {
      flushRefetch();
      if (navigateOnSingle) navigate(`/products/${succeeded[0].product.id}`);
    }
  };

  const summary = parsed?.summary;
  const includedCount = included.filter(Boolean).length;
  const includedParts = (parsed?.products ?? []).reduce(
    (sum, p, i) => sum + (included[i] ? p.summary.partLines : 0),
    0,
  );
  const multi = (parsed?.products?.length ?? 0) > 1;
  /** Only CEDARS parses report a variant, and only ever one per file. */
  const cedarsVariant = parsed?.products?.[0]?.summary?.variant ?? null;

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Import a BOM workbook</CardTitle>
          <p className="text-sm text-muted-foreground">
            Two formats are read: a <strong>CEDARS export</strong> (one product across commodity
            sheets) and a <strong>Daikin Mapped BOM</strong> workbook (one product per sheet). The
            file is read in this browser — nothing is saved until you confirm below.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset();
            flushRefetch();
            onClose?.();
          }}
        >
          Cancel
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ---- file picker ---- */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={onFileChange}
            className="block w-full max-w-md cursor-pointer rounded-md border border-input bg-background text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          {parsing && <span className="text-sm text-muted-foreground">Reading…</span>}
        </div>

        {/* What a valid file looks like, BEFORE one is chosen. Previously the only
            way to find out was to pick the wrong file and read the error. Hidden
            once a file has parsed, since by then it's answered. */}
        {!summary && !parsing && (
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              What can I import?
            </summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              <p>
                <strong className="text-foreground">Daikin Mapped BOM</strong> — one worksheet per
                product, each with <code className="font-mono text-xs">Sl. No.</code>,{' '}
                <code className="font-mono text-xs">Sub Assy / Part / Consumable</code> and{' '}
                <code className="font-mono text-xs">Module</code> column headers. A four-product
                workbook imports as four products. Template and reference worksheets are detected
                and left out.
              </p>
              <p>
                <strong className="text-foreground">CEDARS export</strong> — one product across
                per-commodity worksheets (Steel, Tubing, Evaporator Coil, Electrical Components,
                Wire, Fasteners, Insulation/Tape, Packaging, Miscellaneous, Labels/Literature), or a
                single combined <code className="font-mono text-xs">CostWeights</code> sheet.
              </p>
              <p>
                Worksheets that match neither are listed as ignored rather than guessed at. Nothing
                is written until you press Import.
              </p>
            </div>
          </details>
        )}

        {/* ---- parse failure ---- */}
        {parseError && (
          <Alert variant="destructive">
            <AlertTitle>Could not read that file</AlertTitle>
            <AlertDescription className="whitespace-pre-line">
              {parseError.message}
            </AlertDescription>
          </Alert>
        )}

        {summary && (
          <>
            {/* ---- what the file is ---- */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{FORMAT_LABELS[summary.format] ?? summary.format}</Badge>
              {/* A CEDARS export comes in two shapes and which one it is changes
                  where the parts were read from. Generalising this header for the
                  second format dropped it, which lost real information about
                  every CEDARS file — restored, and only shown when it applies. */}
              {cedarsVariant && (
                <Badge variant="outline">
                  Variant {cedarsVariant}
                  <span className="ml-1 font-normal text-muted-foreground">
                    {cedarsVariant === 'A'
                      ? '— one combined CostWeights sheet'
                      : '— one sheet per commodity'}
                  </span>
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {summary.sheetsSeen} sheets ·{' '}
                {/* Counts the sheets that look like PRODUCTS, not every sheet
                    matched. Saying "4 products" and then quietly unticking one
                    would make the headline disagree with the list under it. */}
                {summary.productSheets ?? summary.productsFound}{' '}
                {(summary.productSheets ?? summary.productsFound) === 1 ? 'product' : 'products'}
                {summary.templateSheets > 0 && (
                  <>
                    {' · '}
                    <span className="text-warning">
                      {summary.templateSheets} template{summary.templateSheets === 1 ? '' : 's'}{' '}
                      excluded
                    </span>
                  </>
                )}{' '}
                · {summary.partLines} parts
              </span>
              {summary.unmappedSheets?.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ignored: {summary.unmappedSheets.join(', ')}
                </span>
              )}
            </div>

            {summary.duplicateProducts?.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Two sheets describe the same product</AlertTitle>
                <AlertDescription>
                  {summary.duplicateProducts
                    .map((d) => `"${d.sheet}" clashes with "${d.clashesWith}"`)
                    .join('; ')}
                  . Edit one of the model names below, or leave one unticked.
                </AlertDescription>
              </Alert>
            )}

            {/* ---- one block per product ---- */}
            {parsed.products.map((entry, i) => {
              const s = entry.summary;
              const inferredFields = PRODUCT_FIELDS.filter((f) => s.inferred?.[f.key]).map(
                (f) => f.label,
              );
              const outcome = results?.find((r) => r.sheet === s.sheet);

              return (
                <div
                  key={s.sheet ?? i}
                  className={`space-y-4 rounded-md border p-4 ${
                    included[i] ? '' : 'opacity-60'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {(multi || s.isLikelyTemplate) && (
                        <Checkbox
                          id={`import-include-${i}`}
                          checked={included[i]}
                          onCheckedChange={(v) =>
                            setIncluded((prev) => prev.map((b, j) => (j === i ? Boolean(v) : b)))
                          }
                          className="mt-1"
                          aria-label={`Include ${edits[i]?.brand} ${edits[i]?.name}`}
                        />
                      )}
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">
                          {edits[i]?.brand} {edits[i]?.name}
                        </p>
                        {s.sheet && (
                          <p className="text-xs text-muted-foreground">from sheet "{s.sheet}"</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.isLikelyTemplate && (
                        <Badge variant="outline" className="text-warning">
                          Looks like a template — excluded
                        </Badge>
                      )}
                      {inferredFields.length > 0 && (
                        <Badge variant="outline" className="text-warning">
                          {inferredFields.join(', ')} inferred — check before importing
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* The reasons, in full. This is the whole point of detecting by
                      named rules instead of a score: the user is the one deciding,
                      so they get the facts rather than a number. */}
                  {s.isLikelyTemplate && (
                    <Alert>
                      <AlertTitle>
                        This sheet doesn't look like a product, so it isn't selected
                      </AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4 text-sm">
                          {s.templateReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        <p className="mt-2 text-sm">
                          Template and reference worksheets share their column headers with real
                          product sheets, so they can't be told apart by shape alone. Tick it above
                          if this really is a product you want in the repository.
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}

                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Parts" value={s.partLines} />
                    <Stat label="Part units" value={s.partUnits} />
                    <Stat label="Modules" value={Object.keys(s.byModule).length} />
                    <Stat
                      label="Source total cost"
                      value={`$${(s.sourceExtendedCostTotal ?? 0).toFixed(2)}`}
                    />
                  </dl>

                  <Tally label="Modules" entries={s.byModule} />
                  <Tally label="Commodities" entries={s.byCommodity} />

                  <Reconciliation s={s} />
                  <Caveats s={s} />

                  {/* ---- editable product record ---- */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {PRODUCT_FIELDS.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label htmlFor={`import-${field.key}-${i}`}>{field.label}</Label>
                        <Input
                          id={`import-${field.key}-${i}`}
                          value={edits[i]?.[field.key] ?? ''}
                          onChange={(e) => setEdit(i, field.key, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {edits[i]?.notes && (
                    <p className="text-sm text-muted-foreground">{edits[i].notes}</p>
                  )}

                  {/* ---- per-product outcome ---- */}
                  {outcome?.status === 'ok' && (
                    <Alert>
                      <AlertTitle>Imported</AlertTitle>
                      <AlertDescription>
                        <Button
                          variant="link"
                          className="h-auto p-0"
                          onClick={() => navigate(`/products/${outcome.product.id}`)}
                        >
                          Open {outcome.label}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                  {outcome?.status === 'error' && (
                    <Alert variant="destructive">
                      <AlertTitle>This product was not imported</AlertTitle>
                      <AlertDescription>
                        {outcome.error.message}
                        {outcome.error.status === 409 && !replaceExisting && (
                          <span className="mt-1 block">
                            Turn on "Replace an existing teardown" below to overwrite it.
                          </span>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              );
            })}

            {/* ---- options ---- */}
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="import-cap" className="font-normal">
                  Import only the {DEMO_CAP} most expensive parts of each product
                  <span className="block text-xs text-muted-foreground">
                    A shorter BOM reads better in a demo. The parts left out are the cheapest ones,
                    and how many were dropped is listed above — never silently.
                  </span>
                </Label>
                <Switch id="import-cap" checked={capParts} onCheckedChange={onToggleCap} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="import-replace" className="font-normal">
                  Replace existing teardowns with the same brand + model
                  <span className="block text-xs text-muted-foreground">
                    Deletes the existing product and its whole teardown first. Off by default.
                  </span>
                </Label>
                <Switch
                  id="import-replace"
                  checked={replaceExisting}
                  onCheckedChange={setReplaceExisting}
                />
              </div>
            </div>

            {/* ---- overall outcome, for a multi-product file ---- */}
            {results && !committing && multi && (
              <Alert
                variant={results.some((r) => r.status === 'error') ? 'destructive' : 'default'}
              >
                <AlertTitle>
                  {results.filter((r) => r.status === 'ok').length} of {results.length} imported
                </AlertTitle>
                <AlertDescription>
                  {results.some((r) => r.status === 'error')
                    ? 'The products that failed are marked above; the rest were written.'
                    : 'All selected products were written. Their teardowns are linked above.'}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {/* Once everything selected has landed there is nothing left to do
                  here, and the only exits used to be "Cancel" and "Clear" — both of
                  which read like undoing the import you just performed. */}
              {results && !committing && results.every((r) => r.status === 'ok') ? (
                <Button
                  onClick={() => {
                    reset();
                    flushRefetch();
                    onClose?.();
                  }}
                >
                  Done — back to the repository
                </Button>
              ) : (
                <Button
                  onClick={onCommit}
                  disabled={committing || parsing || includedCount === 0 || includedParts === 0}
                >
                  {committing
                    ? `Importing… (${results?.length ?? 0}/${includedCount})`
                    : `Import ${includedCount} ${
                        includedCount === 1 ? 'product' : 'products'
                      } · ${includedParts} parts`}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  flushRefetch();
                }}
                disabled={committing}
              >
                Clear
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
