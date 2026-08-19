// ---------------------------------------------------------------------------
// src/pages/ProductsPage.jsx — the Product Benchmark Repository (route /).
//
// A catalog of competitor teardowns: one full-width entry each, imagery on the
// left and the competitive detail on the right. It replaced a grid of small
// three-stat cards, which read as a database table with rounded corners rather
// than as a competitive-intelligence catalog.
//
// ---------------------------------------------------------------------------
// WHY TWO REQUESTS
//
// GET /api/products returns name, brand, category, notes and subAssemblyCount. It
// does NOT return total cost or part count, because those are computed figures —
// the products table stores no totals, and a denormalised cost column that could
// drift from the parts it summarises would be worse than a second request.
//
// So: fetch the list, then fetch the computed metrics. The list renders
// immediately and the numbers fill in — which is also better UX than holding a
// blank page until the slower call returns.
//
// The metrics call uses /api/reports/compare, which returns totals for up to five
// products in ONE request.
//
// ---------------------------------------------------------------------------
// THE SUPERLATIVE BADGES ARE ORDERING, NOT ARITHMETIC
//
// "Lowest cost in set", "Lightest in set" and friends are picked by ranking the
// figures /reports/compare already computed — a min/max over server-provided
// numbers, not a second implementation of any total. That matters because it's
// the same operation on the same values that /reports/best-of-best performs, so
// the badges here cannot disagree with the Best-of-Best leaderboard. See
// computeSuperlatives for the one case where they're suppressed rather than
// risked.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import api, { PERSONAS } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import DeleteProductPanel from '@/components/DeleteProductPanel';
import ImportBomPanel from '@/components/ImportBomPanel';
import ProductCatalogEntry from '@/components/ProductCatalogEntry';
import ProductSearchPanel from '@/components/ProductSearchPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { brandFacets, filterProducts } from '@/lib/productSearch';

/** Mirrors the backend's comparison cap — for metrics chunking AND selection. */
const MAX_COMPARE = 5;

/**
 * Reshape a /reports/compare row into what a catalog entry needs.
 *
 * Keeps more than the old card did — costPerKg, distinctMaterials and the
 * per-module cost breakdown all feed the differentiator badges. `costBySubAssembly`
 * arrives already sorted by cost descending, so [0] is the dominant cost block
 * and no sorting happens here.
 */
const fromCompareRow = (row) => ({
  totalCost: row.totalCost,
  partUnits: row.partUnits,
  partLines: row.partLines,
  totalWeightKg: row.totalWeightKg,
  costPerKg: row.costPerKg,
  distinctMaterials: row.distinctMaterials,
  costBySubAssembly: row.costBySubAssembly,
  currency: row.currency,
});

/**
 * Load totals for every product, keyed by product id.
 *
 * /reports/compare takes 2–5 ids, so this chunks by five and falls back to a
 * single executive report when a chunk has only one id (compare needs at least
 * two). With five seeded products that is exactly one request; the chunking
 * exists so the page doesn't quietly break the day someone seeds a sixth.
 *
 * The single-product fallback returns a THINNER row — the executive headline has
 * no part-line count, cost/kg or module breakdown. Callers must treat those as
 * optional, which is why every differentiator below is individually guarded.
 */
async function loadMetrics(ids, signal) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += MAX_COMPARE) chunks.push(ids.slice(i, i + MAX_COMPARE));

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.length === 1) {
        const { payload } = await api.reports.get(chunk[0], PERSONAS.EXECUTIVE, { signal });
        return [
          [
            chunk[0],
            {
              totalCost: payload.headline.totalCost,
              partUnits: payload.headline.partUnits,
              totalWeightKg: payload.headline.totalWeightKg,
              currency: payload.currency,
            },
          ],
        ];
      }
      const comparison = await api.reports.compare(chunk, { signal });
      return comparison.products.map((row) => [row.productId, fromCompareRow(row)]);
    }),
  );

  return Object.fromEntries(results.flat());
}

/**
 * The cross-product rankings, in the order they should appear on an entry.
 *
 * Both directions are listed for cost, weight and part count on purpose: a
 * catalog that only advertised the wins would be marketing, and this is meant to
 * be a competitive-intelligence tool. `costPerKg` has no "highest" entry because a
 * high cost/kg means a light premium design, not a bad one — calling it out as a
 * negative would misrepresent it (the same caveat the Best-of-Best view carries).
 */
const SUPERLATIVE_RULES = [
  { key: 'totalCost', dir: 'min', label: 'Lowest cost in set', tone: 'best' },
  { key: 'totalWeightKg', dir: 'min', label: 'Lightest in set', tone: 'best' },
  { key: 'partLines', dir: 'min', label: 'Fewest part lines', tone: 'best' },
  { key: 'costPerKg', dir: 'min', label: 'Best cost per kg', tone: 'best' },
  { key: 'totalCost', dir: 'max', label: 'Highest cost in set', tone: 'high' },
  { key: 'totalWeightKg', dir: 'max', label: 'Heaviest in set', tone: 'high' },
  { key: 'partLines', dir: 'max', label: 'Most part lines', tone: 'high' },
];

/**
 * Award each product the superlatives it actually holds.
 *
 * @returns {Map<number, Array<{label: string, tone: string}>>}
 *
 * THREE THINGS IT REFUSES TO DO, each because the alternative would be a
 * confidently wrong badge:
 *   - Nothing is awarded with fewer than two products. "Lowest cost in set" is
 *     vacuous when the set is one.
 *   - Nothing is awarded past MAX_COMPARE products. Beyond five, loadMetrics
 *     splits into chunks and the trailing chunk falls back to the thinner
 *     executive payload, so the products would be ranked on unequal data.
 *   - Nothing is awarded on a tie. If two products share the lowest cost,
 *     neither is "the lowest", and silently handing it to whichever sorted first
 *     would be arbitrary.
 */
function computeSuperlatives(ids, metrics) {
  const byId = new Map(ids.map((id) => [id, []]));
  if (ids.length < 2 || ids.length > MAX_COMPARE || !metrics) return byId;

  for (const rule of SUPERLATIVE_RULES) {
    const entries = ids
      .map((id) => ({ id, value: metrics[id]?.[rule.key] }))
      .filter((e) => typeof e.value === 'number' && Number.isFinite(e.value));
    if (entries.length < 2) continue;

    const winner = entries.reduce((acc, e) =>
      rule.dir === 'min' ? (e.value < acc.value ? e : acc) : e.value > acc.value ? e : acc,
    );
    if (entries.filter((e) => e.value === winner.value).length > 1) continue;

    byId.get(winner.id)?.push({ label: rule.label, tone: rule.tone });
  }

  return byId;
}

/** Placeholder entries matching the real layout, so nothing jumps when data lands. */
function LoadingList() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="grid gap-6 py-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <div className="space-y-3">
              <Skeleton className="aspect-4/3 w-full md:aspect-square" />
              <Skeleton className="h-10 w-40" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-12 w-full" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((j) => (
                  <Skeleton key={j} className="h-12" />
                ))}
              </div>
              <Skeleton className="h-8 w-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ProductsPage() {
  const [importing, setImporting] = useState(false);

  /**
   * Search, brand facet and selection all live in the URL.
   *
   * Selection especially: the whole point of the tray is to assemble a set and
   * open it in Compare, and a user who then hits Back would otherwise find their
   * selection gone. In the URL it survives the round trip, and the state is
   * shareable. Same convention ComparePage already uses for `?ids=`.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const brand = searchParams.get('brand') || null;

  /**
   * Mutate the query string, dropping keys that became empty so the URL doesn't
   * accumulate `?q=&brand=`.
   *
   * `replace` defaults to true because this is called on every keystroke —
   * pushing a history entry per character would make the Back button useless.
   */
  const updateParams = (mutate, { replace = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    for (const key of ['q', 'brand', 'sel']) {
      if (!next.get(key)) next.delete(key);
    }
    setSearchParams(next, { replace });
  };

  const {
    data: products,
    loading,
    error,
    refetch,
  } = useApi(({ signal }) => api.products.list({ signal }), []);

  // Memoised so it has a stable identity across renders. Several hooks below
  // depend on it, and an array literal rebuilt every render would either loop
  // them or force a dishonest dependency list — the React Compiler rejects the
  // latter outright rather than letting the memoisation quietly break.
  const ids = useMemo(() => products?.map((p) => p.id) ?? [], [products]);

  // `idsKey` is a STRING, not the array. An array literal has a new identity
  // every render, so passing `[ids]` as deps would re-run the effect forever.
  // This is the single most common way to hang a page with this hook.
  const idsKey = ids.join(',');

  const { data: metrics, loading: metricsLoading, error: metricsError } = useApi(
    ({ signal }) => loadMetrics(idsKey.split(',').map(Number), signal),
    [idsKey],
    { enabled: ids.length > 0, keepPreviousData: true },
  );

  // Computed over the WHOLE repository, never the filtered subset. "Lowest cost
  // in set" has to mean the benchmark set — recomputing it per filter would let
  // a search for one brand crown that brand cheapest, which is exactly the kind
  // of confidently wrong badge the Best-of-Best view is careful to avoid.
  const superlatives = useMemo(
    () => computeSuperlatives(idsKey ? idsKey.split(',').map(Number) : [], metrics),
    [idsKey, metrics],
  );

  // ---- deletion ----------------------------------------------------------
  // The page owns which product is pending confirmation, so only one confirmation
  // can be open at a time and the catalog entry stays presentational.
  const [deleteTarget, setDeleteTarget] = useState(null);

  // The confirmation quotes exact counts, and the catalog list doesn't carry them —
  // it has no parts, modules or cost rows. So the target's teardown is fetched on
  // demand, only while a confirmation is open. `enabled` keeps this from firing for
  // every product on the page.
  const { data: deleteTeardown } = useApi(
    ({ signal }) => api.products.teardown(deleteTarget.id, { signal }),
    [deleteTarget?.id],
    { enabled: Boolean(deleteTarget) },
  );

  // ---- search + selection ------------------------------------------------
  const facets = useMemo(() => brandFacets(products ?? []), [products]);
  const visible = useMemo(() => filterProducts(products ?? [], { query, brand }), [products, query, brand]);

  // Stale ids from a shared or bookmarked URL are dropped rather than rendered
  // as empty chips.
  const selectedIds = useMemo(() => {
    const requested = new Set(
      (searchParams.get('sel') ?? '')
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
    return ids.filter((id) => requested.has(id));
  }, [searchParams, ids]);

  // Derived from ALL products, not the filtered list: a product selected before
  // a search was typed stays selected and stays visible as a chip, even when the
  // current filter hides its card.
  const selected = (products ?? []).filter((p) => selectedIds.includes(p.id));

  const toggleSelect = (id) => {
    updateParams(
      (next) => {
        const set = new Set(selectedIds);
        if (set.has(id)) set.delete(id);
        else if (set.size < MAX_COMPARE) set.add(id);
        // Written back in ID order, not click order, so the first id — which
        // Compare and Best-of-Best both treat as the baseline — is always the
        // lowest-id product. That keeps the documented baseline convention
        // instead of making it depend on which card was clicked first.
        next.set('sel', ids.filter((x) => set.has(x)).join(','));
      },
      { replace: false },
    );
  };

  // ---- error state -------------------------------------------------------
  // The product list failing means there is nothing to show. A metrics failure
  // does not — that's handled far more gently, below.
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {error.isNetworkError ? 'Cannot reach the API' : 'Could not load products'}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error.message}</p>
          {error.isNetworkError && (
            <p className="text-sm">
              Start the backend with <code className="font-mono">npm run dev</code> in{' '}
              <code className="font-mono">backend/</code>.
            </p>
          )}
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // ---- loading state -----------------------------------------------------
  if (loading) return <LoadingList />;

  // ---- empty state -------------------------------------------------------
  // Distinct from loading and from error, and it names the fix. An empty grid
  // with no explanation reads as a broken page.
  if (!products?.length) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">No teardowns yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The database is empty. Run <code className="font-mono">npm run seed</code> in{' '}
              <code className="font-mono">backend/</code> to load the sample teardowns, or import a
              CEDARS BOM export.
            </p>
            <div className="flex items-center gap-2">
              {/* An empty database is exactly when someone wants to import, so the
                  button is offered here too rather than only on the loaded view. */}
              {!importing && (
                <Button size="sm" onClick={() => setImporting(true)}>
                  Import BOM
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={refetch}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {importing && (
          <ImportBomPanel onClose={() => setImporting(false)} onImported={refetch} />
        )}
      </div>
    );
  }

  // ---- loaded ------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Product Benchmark Repository</h2>
          <p className="text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? 'teardown' : 'teardowns'} — every competitor
            unit costed, weighed and broken down by module.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Comparison needs a baseline and something to compare it to, so the
              link is hidden rather than disabled when there's only one product —
              a dead control invites clicking and explains nothing. */}
          {products.length >= 2 && (
            <Button asChild size="sm" variant="outline">
              <Link to="/compare">Compare all</Link>
            </Button>
          )}
          {!importing && (
            <Button size="sm" onClick={() => setImporting(true)}>
              Import BOM
            </Button>
          )}
        </div>
      </div>

      {importing && <ImportBomPanel onClose={() => setImporting(false)} onImported={refetch} />}

      {/* Stated once rather than on every entry: the imagery and manufacturer
          marks are placeholders. Saying it here keeps it honest without
          repeating a disclaimer five times down the page — and the per-product
          "illustrative data" badge, which is about the FIGURES, stays on each
          entry where the figures are. */}
      <p className="text-xs text-muted-foreground">
        Product imagery is a generic illustration and manufacturer marks are shown as monograms —
        no product photography or brand logos are bundled in this build.
      </p>

      {/* A metrics failure degrades rather than blanks the page: entries still
          show model, brand, description and module count, and the figures read
          "—". You lose the numbers, not the screen. */}
      {metricsError && (
        <Alert>
          <AlertTitle>Benchmarking figures unavailable</AlertTitle>
          <AlertDescription>
            {metricsError.message} — product details below are still accurate.
          </AlertDescription>
        </Alert>
      )}

      <ProductSearchPanel
        query={query}
        onQueryChange={(value) => updateParams((next) => next.set('q', value))}
        brand={brand}
        onBrandChange={(value) => updateParams((next) => next.set('brand', value ?? ''))}
        facets={facets}
        total={products.length}
        matching={visible.length}
        onClear={() =>
          updateParams(
            (next) => {
              next.set('q', '');
              next.set('brand', '');
            },
            { replace: false },
          )
        }
        selected={selected}
        maxSelected={MAX_COMPARE}
        onToggleSelect={toggleSelect}
        onClearSelection={() => updateParams((next) => next.set('sel', ''), { replace: false })}
      />

      {/* ---- no results ---- */}
      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">No matching products found.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Try searching by brand, model, or category.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateParams(
                  (next) => {
                    next.set('q', '');
                    next.set('brand', '');
                  },
                  { replace: false },
                )
              }
            >
              Clear search
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((product) => (
            <div key={product.id} className="space-y-2">
              <ProductCatalogEntry
                product={product}
                metrics={metrics?.[product.id]}
                metricsLoading={metricsLoading}
                superlatives={superlatives.get(product.id) ?? []}
                selected={selectedIds.includes(product.id)}
                selectDisabled={
                  !selectedIds.includes(product.id) && selectedIds.length >= MAX_COMPARE
                }
                onToggleSelect={toggleSelect}
                onDelete={setDeleteTarget}
              />
              {/* The confirmation appears directly beneath the entry it applies
                  to. With eight near-identically-shaped products on screen, a
                  dialog that names a model somewhere else on the page is exactly
                  how the wrong teardown gets deleted. */}
              {deleteTarget?.id === product.id && (
                <DeleteProductPanel
                  product={product}
                  teardown={deleteTeardown}
                  onCancel={() => setDeleteTarget(null)}
                  onDeleted={() => {
                    setDeleteTarget(null);
                    // The comparison selection needs no clearing: `selectedIds` is
                    // derived from the live product list, so a deleted id drops out
                    // of it by itself once this refetch lands.
                    refetch();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
