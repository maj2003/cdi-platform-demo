// ---------------------------------------------------------------------------
// src/pages/IntelligencePage.jsx — route /intelligence
//
// Section 3 of 3: How To Use → New Project → Competitive Intelligence Engine.
//
// The hub for everything analytical. This page adds NO new analysis — it groups
// four capabilities that already existed as four separate top-level nav items
// (Products, Compare, Best-of-Best, Reports) into one section, so the app reads
// as one platform rather than four tools.
//
// ---------------------------------------------------------------------------
// WHAT THIS PAGE DELIBERATELY DOESN'T DO
//
// It does not re-render the repository, the comparison or the leaderboards. Those
// pages are untouched and still live at their original routes, which keeps every
// existing bookmark, deep link and verification suite working. This is a hub over
// them plus the shared sub-navigation, not a replacement for them.
//
// The headline numbers below come from /reports/compare — the same endpoint the
// products page uses for its card totals, so the figures here cannot disagree
// with the figures there. They degrade to "—" rather than blocking the page: a
// hub that fails to render because a stat didn't load is worse than a hub with a
// missing stat.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Boxes, FileText, Search, Sparkles, Trophy } from 'lucide-react';

import api from '@/lib/api';
import DeckExportPanel from '@/components/DeckExportPanel';
import { filterProducts } from '@/lib/productSearch';
import { useApi } from '@/lib/useApi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ICON_WRAPPER_CLASS, STATUS_BADGE_VARIANT, STATUS_LABEL } from '@/lib/buildStatus';
import { formatCount, formatCurrency, formatWeight } from '@/lib/format';

/** The backend caps comparison at five products; mirror it. */
const MAX_COMPARE = 5;

/**
 * The capabilities this section owns.
 *
 * Reports is product-scoped, so its link needs a product id — resolved from the
 * first product in the repository, the same convention the workflow map uses.
 */
const CAPABILITIES = [
  {
    key: 'repository',
    icon: Boxes,
    title: 'Product Benchmark Repository',
    status: 'live',
    description:
      'Every teardown in the set, with its total cost, mass and part count. The entry point to a single product — its module tree, part detail, geometry and BOM metadata, plus Excel and PowerPoint export.',
    to: () => '/products',
    actionLabel: 'Open repository',
  },
  {
    key: 'compare',
    icon: BarChart3,
    title: 'Product Comparison',
    status: 'live',
    description:
      'Two to five products side by side against a baseline. Cost and weight are indexed to the baseline so their divergence is visible on one scale rather than buried in two differently-scaled bar charts.',
    to: () => '/compare',
    actionLabel: 'Open comparison',
  },
  {
    key: 'best-of-best',
    icon: Trophy,
    title: 'Best-of-Best',
    status: 'live',
    description:
      'Per-metric and per-module winners across the set, plus the composite target you would hit by taking the cheapest version of every module from whichever competitor builds it best.',
    to: () => '/best-of-best',
    actionLabel: 'Open Best-of-Best',
  },
  {
    key: 'reports',
    icon: FileText,
    title: 'Persona Reports',
    status: 'live',
    description:
      'Cost Engineer, Design Engineer and Executive views of one product, each a stored snapshot with a freshness badge and an explicit regenerate action.',
    to: (id) => (id === null ? null : `/products/${id}/reports`),
    actionLabel: 'Open reports',
  },
  {
    key: 'ai-prompt',
    icon: Sparkles,
    title: 'Ask the Competitive Intelligence Engine',
    status: 'live',
    description:
      'Ask a question in plain English — cheapest product, lightest product, compare two brands, which unit has the best blower, the best-of-best target, or an executive summary.',
    note: 'Deterministic, not a language model: questions are matched by rules and every figure is read from the live benchmark data, so the same question always returns the same answer and an unrecognised one is declined rather than guessed at. Swapping in Azure OpenAI replaces only the language layer.',
    to: () => '/intelligence/ask',
    actionLabel: 'Ask a question',
    future: ['Azure OpenAI'],
  },
];

/** One headline figure. `value` is already formatted. */
function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default function IntelligencePage() {
  const navigate = useNavigate();
  // Search on the hub as well as the catalog. The brief listed Search as one of
  // this section's capabilities, and an analysis section you can only enter by
  // scrolling a list of five is a section that stops working at fifty. Same
  // filterProducts the catalog uses, so the two cannot disagree about a match.
  const [query, setQuery] = useState('');

  const {
    data: products,
    loading: productsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useApi(({ signal }) => api.products.list({ signal }), []);

  const ids = (products ?? []).map((p) => p.id).slice(0, MAX_COMPARE);
  // A string, not the array — an array literal changes identity every render and
  // would loop the effect forever. Same trap as ProductsPage.
  const idsKey = ids.join(',');

  const { data: comparison, loading: statsLoading } = useApi(
    ({ signal }) => api.reports.compare(idsKey.split(',').map(Number), { signal }),
    [idsKey],
    { enabled: ids.length >= 2, keepPreviousData: true },
  );

  const firstProductId = products?.[0]?.id ?? null;

  const trimmed = query.trim();
  const matches = useMemo(
    () => (trimmed ? filterProducts(products ?? [], { query: trimmed }) : []),
    [products, trimmed],
  );

  // Totals across the set, read off the same payload the product cards use.
  const totals = comparison
    ? {
        currency: comparison.products[0]?.currency ?? 'USD',
        products: comparison.products.length,
        cheapest: [...comparison.products].sort((a, b) => a.totalCost - b.totalCost)[0],
        lightest: [...comparison.products].sort((a, b) => a.totalWeightKg - b.totalWeightKg)[0],
        partLines: comparison.products.reduce((sum, p) => sum + p.partLines, 0),
      }
    : null;

  const header = (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">Competitive Intelligence Engine</h2>
      <p className="text-sm text-muted-foreground">
        Analysis, benchmarking, comparison and reporting across every teardown in the repository.
      </p>
    </div>
  );

  if (productsError) {
    return (
      <div className="space-y-4">
        {header}
        <Alert variant="destructive">
          <AlertTitle>
            {productsError.isNetworkError ? 'Cannot reach the API' : 'Could not load the repository'}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{productsError.message}</p>
            {productsError.isNetworkError && (
              <p className="text-sm">
                Start the backend with <code className="font-mono">npm run dev</code> in{' '}
                <code className="font-mono">backend/</code>.
              </p>
            )}
            <Button variant="outline" size="sm" onClick={refetchProducts}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/* ---- search ----
          Straight to a teardown by brand, model or category. Enter with no exact
          pick hands off to the catalog with the query intact, which is also how a
          search gets shared. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : '/products');
        }}
      >
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teardowns — brand, model or category"
            aria-label="Search teardowns"
            className="h-11 pl-9"
          />
        </div>
        {trimmed !== '' && (
          <ul className="mt-2 divide-y overflow-hidden rounded-lg border bg-card">
            {matches.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                Nothing matches “{trimmed}”.
              </li>
            ) : (
              matches.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/products/${p.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-accent/10"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {p.brand} {p.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.category}
                      </span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))
            )}
          </ul>
        )}
      </form>

      {/* ---- headline figures across the set ---- */}
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Repository at a glance</CardTitle>
        </CardHeader>
        <CardContent>
          {productsLoading || (statsLoading && !comparison) ? (
            <div className="grid gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-4">
              <Stat label="Teardowns" value={formatCount(products?.length ?? 0)} />
              <Stat label="Part lines" value={totals ? formatCount(totals.partLines) : '—'} />
              <Stat
                label="Lowest total cost"
                value={
                  totals ? formatCurrency(totals.cheapest.totalCost, totals.currency) : '—'
                }
              />
              <Stat
                label="Lowest total weight"
                value={totals ? formatWeight(totals.lightest.totalWeightKg) : '—'}
              />
            </dl>
          )}
          {totals && (
            <p className="mt-3 text-xs text-muted-foreground">
              Cheapest is {totals.cheapest.brand} {totals.cheapest.productName}; lightest is{' '}
              {totals.lightest.brand} {totals.lightest.productName}. Figures are read from the same
              comparison payload the repository cards use.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- PPT export ----
          The deck was previously reachable only from a product's own page, so the
          section that owns reporting could not produce the one artefact that
          leaves the building. Same builder, same payloads — see DeckExportPanel. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Export a benchmark deck</CardTitle>
        </CardHeader>
        <CardContent>
          {productsLoading && !products ? (
            <Skeleton className="h-16" />
          ) : (
            <DeckExportPanel products={products ?? []} comparisonIds={ids} />
          )}
        </CardContent>
      </Card>

      {/* ---- the capabilities ---- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Capabilities</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            const href = cap.to(firstProductId);
            return (
              <Card key={cap.key} className="flex flex-col">
                <CardContent className="flex flex-1 gap-4 py-5">
                  <span
                    aria-hidden
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${ICON_WRAPPER_CLASS}`}
                  >
                    <Icon className="size-4" />
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-sm font-semibold">{cap.title}</h4>
                      <Badge variant={STATUS_BADGE_VARIANT[cap.status]} className="shrink-0">
                        {STATUS_LABEL[cap.status]}
                      </Badge>
                    </div>

                    <p className="flex-1 text-sm text-muted-foreground">{cap.description}</p>
                    {cap.note && <p className="text-xs text-muted-foreground">{cap.note}</p>}

                    <div className="flex flex-wrap items-center gap-2">
                      {href && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={href}>{cap.actionLabel}</Link>
                        </Button>
                      )}
                      {cap.future?.map((name) => (
                        <Badge key={name} variant="outline" className="border-dashed font-normal">
                          Future integration: {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Comparison needs two products; say so rather than letting the links
          lead to an empty state. */}
      {products && products.length < 2 && (
        <Alert>
          <AlertTitle>Comparison needs at least two teardowns</AlertTitle>
          <AlertDescription className="text-sm">
            Product Comparison and Best-of-Best both rank products against each other, so they need
            a second teardown before they have anything to say. Import one from{' '}
            <Link to="/new-project" className="underline">
              New Project
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
