// ---------------------------------------------------------------------------
// src/pages/ProductDetailPage.jsx — route /products/:id
//
// The teardown tree: sub-assemblies -> parts -> measurements.
//
// ---------------------------------------------------------------------------
// WHY TWO REQUESTS AGAIN
//
// GET /:id/teardown carries everything structural — parts, materials, weights,
// dimensions, raw cost columns, capture history. What it does NOT carry is any
// COMPUTED figure: sub-assembly subtotals, a part's share of product cost, the
// product total.
//
// Those could be summed here in about four lines. Doing so would be a mistake:
// benchmarkService already defines how cost extends by quantity, how shares are
// rounded, and what a total means. A second implementation in the browser would
// agree today and drift the first time either side changes — and the failure
// mode is two screens quietly showing different numbers for the same product,
// which destroys trust in the whole app during a demo.
//
// So the money on this page comes from /api/reports/:id/cost_engineer, the same
// source the reports page will use. The teardown supplies structure; the report
// supplies arithmetic.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet, Presentation, Rows3, Table2, Trash2 } from 'lucide-react';

import api, { PERSONAS } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { exportBomToExcel } from '@/lib/exportBom';
import { exportBenchmarkToPowerPoint } from '@/lib/exportPptx';
import AddModuleForm from '@/components/AddModuleForm';
import AddPartForm from '@/components/AddPartForm';
import DeleteProductPanel from '@/components/DeleteProductPanel';
import EngineeringBomTable from '@/components/EngineeringBomTable';
import PartRow from '@/components/PartRow';
import ProductSourceBadge from '@/components/ProductSourceBadge';
import ProductPhotoGallery from '@/components/ProductPhotoGallery';
import ProductSubNav from '@/components/ProductSubNav';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatCurrency } from '@/lib/format';

function SummaryStat({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-6 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </CardContent>
      </Card>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();

  // `id` from useParams is a string — a primitive, so a valid dependency.
  //
  // keepPreviousData matters here specifically because PartGeometryEditor
  // calls refetch() after every save: without it, that refetch would blank
  // `teardown` while in flight, hit the `loading` guard below, and unmount
  // the whole Accordion — which resets it to its uncontrolled defaultValue
  // and collapses whichever section + part row the user just had open, right
  // after they saved something in it. Keeping the previous tree mounted
  // during a background refetch is the same fix ReportsPage already uses.
  const {
    data: teardown,
    loading,
    error,
    refetch,
  } = useApi(({ signal }) => api.products.teardown(id, { signal }), [id], {
    keepPreviousData: true,
  });

  // The cost report. Fetched independently so a report failure degrades the
  // money columns rather than blanking the structural view, which is still
  // completely usable without them.
  const { data: costReport, error: costError } = useApi(
    ({ signal }) => api.reports.get(id, PERSONAS.COST_ENGINEER, { signal }),
    [id],
  );

  // The design report feeds the Excel export's "Total Weight" column (per
  // part, plus the totals row) — nowhere else on this page. Its failure
  // blanks that one column rather than blocking the export, unlike the cost
  // report, which the export can't proceed without.
  const { data: designReport } = useApi(
    ({ signal }) => api.reports.get(id, PERSONAS.DESIGN_ENGINEER, { signal }),
    [id],
  );

  // The executive report feeds the PowerPoint export's title-slide headline
  // figures and its own authored key-point sentences (the "top-line insight"
  // — copy the server already wrote, not something composed here).
  const { data: executiveReport } = useApi(
    ({ signal }) => api.reports.get(id, PERSONAS.EXECUTIVE, { signal }),
    [id],
  );

  // The PowerPoint comparison slide is optional — only fetched, and only
  // included, when there's actually something to compare against. This
  // product is always first in the id list, so the compare endpoint treats
  // it as the baseline, matching what "this product's export" should mean.
  const { data: allProducts } = useApi(({ signal }) => api.products.list({ signal }), []);
  const otherProductIds = (allProducts ?? [])
    .map((p) => p.id)
    .filter((otherId) => String(otherId) !== String(id));
  const compareIds = otherProductIds.length > 0 ? [Number(id), ...otherProductIds].slice(0, 5) : [];
  const compareIdsKey = compareIds.join(',');

  const { data: comparison } = useApi(
    ({ signal }) => api.reports.compare(compareIdsKey.split(',').map(Number), { signal }),
    [compareIdsKey],
    { enabled: compareIds.length >= 2 },
  );

  const navigate = useNavigate();
  const [expandedParts, setExpandedParts] = useState(() => new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // ---- which view of the BOM -------------------------------------------
  // Held in the URL rather than in component state so "show me the Engineering
  // BOM" is a link that can be sent, bookmarked, and survives a refresh
  // mid-demo — and so the browser back button steps between the two views.
  // Teardown stays the default, so every existing link behaves exactly as before.
  const [searchParams, setSearchParams] = useSearchParams();
  const bomView = searchParams.get('view') === 'bom';
  const setBomView = (wantBom) => {
    const next = new URLSearchParams(searchParams);
    if (wantBom) next.set('view', 'bom');
    else next.delete('view');
    // replace: true — toggling a view is not a navigation step worth stacking up
    // in history, but the resulting URL is still shareable.
    setSearchParams(next, { replace: true });
  };

  // ---- BOM authoring: destructive actions -------------------------------
  // Held on the page rather than inside the row/module components so a single
  // error banner and a single refetch cover both, and so the confirm prompt lives
  // next to the refetch it triggers.
  const [authoringError, setAuthoringError] = useState(null);
  const [deletingModuleId, setDeletingModuleId] = useState(null);

  const deleteModule = async (sub) => {
    setAuthoringError(null);
    // Only reachable on an empty module (the button is hidden otherwise) and the
    // server refuses a populated one, so this confirm is about the module itself.
    if (!window.confirm(`Delete the module "${sub.name}"?`)) return;
    setDeletingModuleId(sub.id);
    try {
      await api.modules.remove(sub.id);
      refetch();
    } catch (err) {
      setAuthoringError(err.message);
    } finally {
      setDeletingModuleId(null);
    }
  };

  const deletePart = async (part) => {
    setAuthoringError(null);
    // Named in the prompt, and the cascade is spelled out: deleting a part takes
    // its captured measurements and cost with it, which is not obvious.
    if (
      !window.confirm(
        `Delete the part "${part.name}"? Its captured measurements and cost will go with it.`,
      )
    ) {
      return;
    }
    try {
      await api.parts.remove(part.id);
      // Drop it from the expanded set too, or the id lingers and a future part
      // reusing that id would render pre-expanded.
      setExpandedParts((prev) => {
        const next = new Set(prev);
        next.delete(part.id);
        return next;
      });
      refetch();
    } catch (err) {
      setAuthoringError(err.message);
    }
  };

  const togglePart = (partId) =>
    setExpandedParts((prev) => {
      // A new Set, not a mutation: React compares by identity, and mutating the
      // existing Set would leave the reference unchanged and skip the re-render.
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });

  /**
   * Index the report's per-part figures by partId, so each row is an O(1)
   * lookup instead of a linear scan through 43 entries per render.
   */
  const costingByPart = useMemo(() => {
    const byPart = costReport?.payload?.byPart;
    if (!byPart) return null;
    return new Map(byPart.map((row) => [row.partId, { ...row, currency: costReport.payload.currency }]));
  }, [costReport]);

  /** Sub-assembly subtotals, also straight from the report. */
  const subtotalBySubAssembly = useMemo(() => {
    const rows = costReport?.payload?.bySubAssembly;
    if (!rows) return null;
    return new Map(rows.map((row) => [row.subAssemblyId, row]));
  }, [costReport]);

  const costsUnavailable = Boolean(costError) || !costingByPart;

  // Cost data is mandatory — unit cost, extended cost and the breakdown
  // columns all come from it, so an export without it would either be blank
  // where the whole point of the sheet is the cost columns, or would have to
  // fall back to recomputing them here, which is exactly what this page's
  // header comment says not to do.
  const canExport = Boolean(teardown) && !costsUnavailable && (teardown?.subAssemblies?.length ?? 0) > 0;

  const handleExport = () => {
    if (!canExport) return;
    exportBomToExcel(teardown, costReport.payload, designReport?.payload ?? null);
  };

  // The deck needs cost + executive data; the comparison slide is added only
  // when it's actually available (see the compareIds/comparison fetch above),
  // so its absence degrades one slide rather than blocking the whole export.
  const canExportPptx = canExport && Boolean(executiveReport);

  const handleExportPptx = () => {
    if (!canExportPptx) return;
    exportBenchmarkToPowerPoint(
      teardown,
      executiveReport.payload,
      costReport.payload,
      comparison ?? null,
    );
  };

  // `&& !teardown` — a background refetch (geometry save, "Regenerate", etc.)
  // still has the previous tree to show via keepPreviousData; only a bare
  // first load with nothing yet should show the full-page skeleton.
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
          {error.isNetworkError && (
            <p className="text-sm">
              Start the backend with <code className="font-mono">npm run dev</code> in{' '}
              <code className="font-mono">backend/</code>.
            </p>
          )}
          <div className="flex gap-2">
            {error.status !== 404 && (
              <Button variant="outline" size="sm" onClick={refetch}>
                Try again
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/products">Back to products</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const subAssemblies = teardown.subAssemblies ?? [];
  const totalCost = costReport?.payload?.totals?.totalCost;
  const currency = costReport?.payload?.currency;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/products">
            <ArrowLeft className="mr-1 size-4" />
            All products
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">{teardown.name}</h2>
            <p className="text-sm text-muted-foreground">
              {teardown.brand} · {teardown.category}
            </p>
            {/* Provenance sits next to the model number, where anyone reading the
                figures below will see it. */}
            <ProductSourceBadge product={teardown} withDate />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!canExport}
              title={
                canExport
                  ? undefined
                  : 'Cost figures are unavailable, or this teardown has no parts yet.'
              }
            >
              <FileSpreadsheet className="mr-1.5 size-4" />
              Export to Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPptx}
              disabled={!canExportPptx}
              title={
                canExportPptx
                  ? undefined
                  : 'Cost or executive-summary figures are unavailable, or this teardown has no parts yet.'
              }
            >
              <Presentation className="mr-1.5 size-4" />
              Export to PowerPoint
            </Button>
            {/* Deliberately last and ghost-styled: it belongs here — this is the
                page that knows what the product contains — but it should not
                compete with the exports for attention. */}
            {!confirmingDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="mr-1.5 size-4" />
                Delete product
              </Button>
            )}
          </div>
        </div>

        {confirmingDelete && (
          <DeleteProductPanel
            product={teardown}
            teardown={teardown}
            onCancel={() => setConfirmingDelete(false)}
            // Nothing left to show once it's gone, so leave for the repository.
            onDeleted={() => navigate('/products')}
          />
        )}

        {teardown.notes && <p className="max-w-2xl text-sm text-muted-foreground">{teardown.notes}</p>}

        <ProductSubNav productId={id} />
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-6 sm:grid-cols-5">
          {/* Counts come from the server's `counts` block, not from walking the
              tree here — same single-source-of-truth reason as the costs. */}
          <SummaryStat label="Sub-assemblies" value={formatCount(teardown.counts.subAssemblies)} />
          <SummaryStat label="Part lines" value={formatCount(teardown.counts.partLines)} />
          <SummaryStat label="Part units" value={formatCount(teardown.counts.partUnits)} />
          <SummaryStat label="Captures" value={formatCount(teardown.counts.measurements)} />
          <SummaryStat
            label="Total cost"
            value={costsUnavailable ? '—' : formatCurrency(totalCost, currency)}
          />
        </CardContent>
      </Card>

      {costError && (
        <Alert>
          <AlertTitle>Cost figures unavailable</AlertTitle>
          <AlertDescription>
            {costError.message} — the teardown structure below is still accurate.
          </AlertDescription>
        </Alert>
      )}

      {/* Empty state: a product row with no sub-assemblies is a real case
          (created but not yet torn down), and it should read as "nothing here
          yet" rather than as a broken page. */}
      {/* ---- view toggle ----
          Two genuinely different jobs over the same data: the accordion is built
          for editing one module at a time, the grid for reviewing a whole BOM at
          once. Neither replaces the other, so this is a switch and not a
          migration — the accordion is untouched and remains the default. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-md border p-0.5"
          role="group"
          aria-label="BOM view"
        >
          <Button
            size="sm"
            variant={bomView ? 'ghost' : 'default'}
            onClick={() => setBomView(false)}
            aria-pressed={!bomView}
          >
            <Rows3 className="mr-1.5 size-4" />
            Teardown View
          </Button>
          <Button
            size="sm"
            variant={bomView ? 'default' : 'ghost'}
            onClick={() => setBomView(true)}
            aria-pressed={bomView}
          >
            <Table2 className="mr-1.5 size-4" />
            Engineering BOM View
          </Button>
        </div>

        {/* Add Module belongs to the tree — it acts on the module structure the
            accordion shows, and there is nothing module-shaped to add to in a
            flat grid. */}
        {!bomView && (
          <AddModuleForm
            productId={teardown.id}
            existingNames={subAssemblies.map((s) => s.name)}
            onCreated={refetch}
          />
        )}
      </div>

      {authoringError && bomView && (
        <Alert variant="destructive">
          <AlertDescription>{authoringError}</AlertDescription>
        </Alert>
      )}

      {bomView ? (
        <EngineeringBomTable
          teardown={teardown}
          costingByPart={costingByPart}
          costsUnavailable={costsUnavailable}
          // The SAME expanded set the accordion uses, so a part opened in one view
          // is already open in the other and switching views keeps your place.
          // Note it's a set of part IDS, not of visible rows: in the teardown view
          // the part's MODULE also has to be open for the detail to be on screen,
          // since the accordion only opens the first section by default.
          expandedParts={expandedParts}
          onTogglePart={togglePart}
          onPartUpdated={refetch}
          onPartDeleted={deletePart}
          currency={currency}
        />
      ) : subAssemblies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">No teardown data yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              This product has no modules recorded yet. Use <strong>Add Module</strong> above to
              start building the BOM by hand, import a CEDARS export from the repository, or run{' '}
              <code className="font-mono">npm run seed</code> in{' '}
              <code className="font-mono">backend/</code> to load the sample data.
            </p>
            <Button variant="outline" size="sm" onClick={refetch}>
              Refresh
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Accordion
          type="multiple"
          // Open the first sub-assembly by default: an accordion that is
          // entirely collapsed on arrival looks like a page that failed to load.
          defaultValue={[String(subAssemblies[0].id)]}
          className="space-y-3"
        >
          {subAssemblies.map((sub) => {
            const subtotal = subtotalBySubAssembly?.get(sub.id);
            const parts = sub.parts ?? [];

            return (
              <AccordionItem
                key={sub.id}
                value={String(sub.id)}
                className="rounded-lg border px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-1 items-center justify-between gap-4 pr-3">
                    <div className="text-left">
                      <p className="font-medium">{sub.name}</p>
                      {sub.description && (
                        <p className="text-xs font-normal text-muted-foreground">
                          {sub.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">
                        {parts.length} {parts.length === 1 ? 'part' : 'parts'}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {costsUnavailable ? '—' : formatCurrency(subtotal?.cost, currency)}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="space-y-3">
                  {/* Authoring controls per module. "Delete module" is only
                      offered while the module is EMPTY — the server refuses a
                      populated one anyway (deleting it would cascade through its
                      parts, costs and captures), so offering the button would be
                      offering a guaranteed error. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <AddPartForm
                      subAssemblyId={sub.id}
                      moduleName={sub.name}
                      onCreated={refetch}
                    />
                    {parts.length === 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => deleteModule(sub)}
                        disabled={deletingModuleId === sub.id}
                      >
                        <Trash2 className="mr-1 size-4" />
                        {deletingModuleId === sub.id ? 'Removing…' : 'Delete module'}
                      </Button>
                    )}
                  </div>

                  {authoringError && (
                    <Alert variant="destructive">
                      <AlertDescription>{authoringError}</AlertDescription>
                    </Alert>
                  )}

                  {parts.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">
                      No parts in this module yet — use <strong>Add Part</strong> above.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>Part</TableHead>
                          <TableHead>Material</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Weight</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Captures</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parts.map((part) => (
                          <PartRow
                            key={part.id}
                            part={part}
                            costing={costingByPart?.get(part.id)}
                            costsUnavailable={costsUnavailable}
                            expanded={expandedParts.has(part.id)}
                            onToggle={() => togglePart(part.id)}
                            onPartUpdated={refetch}
                            onPartDeleted={deletePart}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {subAssemblies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Photos</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every photo captured against this teardown, across all parts. Stored in this
              browser only — upload from a part's detail view below.
            </p>
          </CardHeader>
          <CardContent>
            <ProductPhotoGallery subAssemblies={subAssemblies} />
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        Click any part to see its dimensions, capture history and photos.
      </p>
    </div>
  );
}