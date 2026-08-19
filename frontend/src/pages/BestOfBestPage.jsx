// ---------------------------------------------------------------------------
// src/pages/BestOfBestPage.jsx — route /best-of-best
//
// The Competitive Intelligence Engine's executive scorecard: who wins what, and
// what the theoretical best-in-class unit would cost.
//
// ---------------------------------------------------------------------------
// THE ONE THING THIS PAGE MUST NOT GET WRONG
//
// The composite target spans every module seen on ANY product — including
// Electric Heater Assm, which only two of the four teardowns carry. So the raw
// composite total ($286.27 on the seeded set) is HIGHER than the cheapest real
// product's total ($250.18 for the Goodman, which has no heater). Put those two
// numbers side by side unlabelled and the page appears to say the
// best-of-best target is worse than a product you can already buy.
//
// So every product-vs-target comparison on this page uses the backend's
// LIKE-FOR-LIKE composite — the target recomputed over only the modules that
// product actually has. On that basis the Goodman's target is $246.87 and its
// headroom is a genuine +1.3%. The full composite is still shown, explicitly
// labelled as a fully-featured spec, because it is the real answer to "what
// should we be aiming at".
//
// ---------------------------------------------------------------------------
// NOTHING HERE IS RECOMPUTED
//
// Every figure comes from GET /api/reports/best-of-best, which builds on the
// same buildCostEngineerView / buildDesignEngineerView the persona reports and
// the compare view use. benchmarkService stays the only place a total is
// defined. The only arithmetic in this file is bar widths.
//
// COLOUR: --accent (Maya light blue) marks winners and fills the target portion
// of every bar, following the app's "accent is the ambient selected/best state"
// rule; --primary (cerulean) is used only where white text sits on it (the badge
// on the headline card). Icons stay muted-line per the no-coloured-icons rule.
// text-warning (salmon) marks cost/weight sitting ABOVE target — the same
// "over" signal it already carries for over-baseline deltas on the compare view.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Award, Layers, Target, TrendingDown } from 'lucide-react';

import api from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatCount,
  formatCurrency,
  formatWeight,
  makeProductLabeller,
} from '@/lib/format';

/** Mirrors the backend's cap — best-of-best takes 2–5 products. */
const MAX_PRODUCTS = 5;

/** One value, formatted for whichever unit the backend said the metric is in. */
function formatMetric(value, unit, currency) {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case 'currency':
      return formatCurrency(value, currency);
    case 'kg':
      return formatWeight(value);
    case 'count':
      return formatCount(value);
    case 'currencyPerKg':
      return `${formatCurrency(value, currency)}/kg`;
    default:
      return String(value);
  }
}

/** Grams as kg, for module weights that arrive in grams. */
const kg = (grams) => (grams === null || grams === undefined ? null : grams / 1000);

// Product labelling (brand, plus the model where a brand appears twice) lives in
// lib/format.js — ComparePage needs exactly the same rule, and two copies of it
// would be two things to keep in step.

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * THE HEADLINE — the composite target.
 *
 * Big numbers in ink rather than brand blue: cerulean on white measures about
 * 2.8:1, which is an accepted pairing for a badge carrying white text but not
 * for the one number the whole page exists to communicate. The brand shows up as
 * the left rule, the badge, and the bars below.
 */
function CompositeHeadline({ composite, currency, productCount, brandLabel }) {
  const stats = [
    { label: 'Target BOM cost', value: formatCurrency(composite.totalCost, currency) },
    { label: 'Target weight', value: formatWeight(composite.totalWeightKg) },
    { label: 'Target cost per kg', value: `${formatCurrency(composite.costPerKg, currency)}/kg` },
  ];

  return (
    <Card className="overflow-hidden border-l-4 border-l-primary">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Best-of-best target</Badge>
          <span className="text-xs text-muted-foreground">
            cheapest version of each of {composite.moduleCount} modules, across {productCount}{' '}
            teardowns
          </span>
        </div>
        <CardTitle className="text-base">The number to beat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {/* Where each module's target comes from — the sourcing story in one line. */}
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs text-muted-foreground">Cheapest module sourced from</p>
          <div className="flex flex-wrap gap-1.5">
            {composite.modules.map((m) => (
              <Badge key={m.module} variant="outline" className="font-normal">
                {m.module.replace(/ Assm.*$/, '')}
                <span className="ml-1 font-medium">{brandLabel(m.costFrom)}</span>
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Product-level leaderboard — one card per metric, winner first. */
function ProductLeaderboard({ productLeaders, overall, currency, brandLabel }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Award className="size-4 text-muted-foreground" aria-hidden />
          Product leaderboard
        </h3>
        {overall && (
          <Badge variant={overall.outright ? 'default' : 'outline'}>
            {overall.outright
              ? `${brandLabel(overall)} leads ${overall.metricsWon} of ${overall.metricsTotal} metrics`
              : `No outright leader — best is ${overall.metricsWon} of ${overall.metricsTotal}`}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {productLeaders.map((leader) => (
          <Card key={leader.key} className="border-accent/60 bg-accent/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {leader.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-lg font-semibold leading-tight">{leader.winner?.brand ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{leader.winner?.productName}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatMetric(leader.winner?.value, leader.unit, currency)}
                </p>
              </div>

              {leader.runnerUp && (
                <p className="border-t pt-2 text-xs text-muted-foreground">
                  next: {leader.runnerUp.brand}{' '}
                  <span className="tabular-nums">
                    {formatMetric(leader.runnerUp.value, leader.unit, currency)}
                  </span>
                  {leader.gapToRunnerUpPct !== null && (
                    <span className="text-warning"> (+{leader.gapToRunnerUpPct}%)</span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* The cost/kg metric is genuinely easy to misread, so the caveat the
          backend ships with it is shown rather than dropped. */}
      <p className="text-xs text-muted-foreground">
        {productLeaders.find((l) => l.key === 'costPerKg')?.note}
      </p>
    </section>
  );
}

/** Module-level leaderboard — cheapest and lightest per module, plus the spread. */
function ModuleLeaderboard({ moduleLeaders, currency, brandLabel }) {
  // Widest spread across all modules, so every bar is on one comparable scale.
  const maxSpread = Math.max(...moduleLeaders.map((m) => m.costSpreadPct ?? 0), 1);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Layers className="size-4 text-muted-foreground" aria-hidden />
        Module leaderboard
      </h3>

      <div className="grid gap-3 lg:grid-cols-2">
        {moduleLeaders.map((m) => (
          <Card key={m.module}>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{m.module}</p>
                {/* Only shown when it matters: a winner among 2 of 4 products is
                    a weaker claim than one among all 4, and the reader should be
                    able to see which they're looking at. */}
                {m.productCount < m.productTotal && (
                  <Badge variant="outline" className="text-warning">
                    only {m.productCount} of {m.productTotal} have this module
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-accent/10 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Cheapest</p>
                  <p className="text-sm font-semibold">{m.cheapest?.brand ?? '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.cheapest?.productName ?? ''}
                  </p>
                  <p className="text-base font-semibold tabular-nums">
                    {formatCurrency(m.cheapest?.cost, currency)}
                  </p>
                </div>
                <div className="rounded-md bg-accent/10 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Lightest</p>
                  <p className="text-sm font-semibold">{m.lightest?.brand ?? '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.lightest?.productName ?? ''}
                  </p>
                  <p className="text-base font-semibold tabular-nums">
                    {formatWeight(kg(m.lightest?.weightG))}
                  </p>
                </div>
              </div>

              {m.costSpreadPct !== null && m.dearest && (
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Cost spread</span>
                    <span className="tabular-nums">
                      <span className="text-warning">+{m.costSpreadPct}%</span>{' '}
                      <span className="text-muted-foreground">
                        to {brandLabel(m.dearest)} {formatCurrency(m.dearest.cost, currency)}
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(2, (m.costSpreadPct / maxSpread) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * Headroom — every real product against its like-for-like target.
 *
 * The bar is scaled across products so the lengths are comparable: the accent
 * portion is the best-in-class target, the salmon portion is what sits above it.
 */
function HeadroomVsTarget({ vsProducts, currency }) {
  const maxCost = Math.max(...vsProducts.map((v) => v.totalCost), 1);
  const ranked = [...vsProducts].sort((a, b) => a.headroomCostPct - b.headroomCostPct);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <TrendingDown className="size-4 text-muted-foreground" aria-hidden />
        Cost above best-in-class, module by module
      </h3>

      <Card>
        <CardContent className="space-y-5 py-5">
          {ranked.map((v) => {
            const targetPct = (v.likeForLikeCompositeCost / maxCost) * 100;
            const headroomPct = (Math.max(0, v.headroomCost) / maxCost) * 100;
            return (
              <div key={v.productId} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <Link
                      to={`/products/${v.productId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {v.brand}
                    </Link>
                    <span className="text-xs text-muted-foreground">{v.productName}</span>
                    {v.missingModules.length > 0 && (
                      <Badge variant="outline" className="font-normal">
                        no {v.missingModules.map((m) => m.replace(/ Assm.*$/, '')).join(', ')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(v.totalCost, currency)} vs target{' '}
                    {formatCurrency(v.likeForLikeCompositeCost, currency)} ·{' '}
                    <span className="font-medium text-warning">
                      +{formatCurrency(v.headroomCost, currency)} ({v.headroomCostPct}%)
                    </span>
                  </p>
                </div>

                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-accent" style={{ width: `${targetPct}%` }} />
                  <div className="h-full bg-warning" style={{ width: `${headroomPct}%` }} />
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full bg-accent" />
              best-in-class target for that product&apos;s modules
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full bg-warning" />
              cost above target
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function BestOfBestPage() {
  const [searchParams] = useSearchParams();

  const {
    data: products,
    loading: productsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useApi(({ signal }) => api.products.list({ signal }), []);

  /**
   * Which products to rank.
   *
   * Defaults to everything (capped at the backend's five), because this is an
   * "across the whole competitive set" view rather than a pairwise one. A
   * ?ids= param still wins, so the compare view can hand its current selection
   * straight over.
   */
  const ids = useMemo(() => {
    const requested = (searchParams.get('ids') ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    const available = (products ?? []).map((p) => p.id);
    const chosen = requested.length ? requested.filter((id) => available.includes(id)) : available;
    return chosen.slice(0, MAX_PRODUCTS);
  }, [searchParams, products]);

  // A string, not the array — an array literal has a new identity every render
  // and would re-run the fetch forever. Same trap as ProductsPage.
  const idsKey = ids.join(',');

  const {
    data: bob,
    loading,
    error,
    refetch,
  } = useApi(
    ({ signal }) => api.reports.bestOfBest(idsKey.split(',').map(Number), { signal }),
    [idsKey],
    { enabled: ids.length >= 2, keepPreviousData: true },
  );

  const header = (
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Target className="size-5 text-muted-foreground" aria-hidden />
        Best-of-Best
      </h2>
      <p className="text-sm text-muted-foreground">
        Per-metric and per-module winners across the competitive set, and the composite target they
        imply.
      </p>
    </div>
  );

  // ---- product list failed: nothing to rank ------------------------------
  if (productsError) {
    return (
      <div className="space-y-4">
        {header}
        <Alert variant="destructive">
          <AlertTitle>
            {productsError.isNetworkError ? 'Cannot reach the API' : 'Could not load products'}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{productsError.message}</p>
            <Button variant="outline" size="sm" onClick={refetchProducts}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (productsLoading) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingState />
      </div>
    );
  }

  // ---- fewer than two products: a leaderboard of one is not a leaderboard --
  if (ids.length < 2) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">Not enough teardowns to rank</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Best-of-best needs at least two products to compare. Run{' '}
              <code className="font-mono">npm run seed</code> in{' '}
              <code className="font-mono">backend/</code>, or import a CEDARS BOM.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/products">Back to products</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <Alert variant="destructive">
          <AlertTitle>Could not build the leaderboard</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Gated on `loading && !bob` so a refetch doesn't flash the whole page through
  // the skeleton — same pattern as ReportsPage and ProductDetailPage.
  if (loading && !bob) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingState />
      </div>
    );
  }

  if (!bob) return null;

  const { currency, composite, productLeaders, overall, moduleLeaders, products: ranked } = bob;

  // Adds the model number to a brand only where two products share the brand.
  const brandLabel = makeProductLabeller(ranked);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {header}
        <Button asChild variant="outline" size="sm">
          <Link to={`/compare?ids=${idsKey}`}>Open in Compare</Link>
        </Button>
      </div>

      <CompositeHeadline
        composite={composite}
        currency={currency}
        productCount={ranked.length}
        brandLabel={brandLabel}
      />

      <ProductLeaderboard
        productLeaders={productLeaders}
        overall={overall}
        currency={currency}
        brandLabel={brandLabel}
      />

      <HeadroomVsTarget vsProducts={composite.vsProducts} currency={currency} />

      <ModuleLeaderboard
        moduleLeaders={moduleLeaders}
        currency={currency}
        brandLabel={brandLabel}
      />

      {/* The caveats ride along in the payload precisely so this can't render
          the composite as if it were a quotable number. Coverage gaps are
          appended because they're the reason the raw composite total sits above
          the cheapest real product. */}
      <Alert>
        <AlertTitle>How to read the target</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {composite.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
            {composite.moduleCoverage.map((c) => (
              <li key={c.module}>
                <strong>{c.module}</strong> exists on only {c.productCount} of {c.productTotal}{' '}
                teardowns, so the {formatCurrency(composite.totalCost, currency)} composite
                describes a fully-featured unit. Every per-product comparison above is made against
                a like-for-like target covering only that product&apos;s own modules.
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
