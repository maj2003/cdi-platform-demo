// ---------------------------------------------------------------------------
// src/pages/ComparePage.jsx — route /compare
//
// Product-vs-product benchmarking across the whole seeded set.
//
// ---------------------------------------------------------------------------
// THE STORY THIS PAGE EXISTS TO TELL
//
// Across the three teardowns, cost rises roughly three times faster than mass.
// That is the single most interesting thing in the dataset, and absolute bar
// charts bury it — $84 vs $178 and 5.7 kg vs 7.5 kg both just look like "bigger",
// and the eye can't compare the two rates across differently-scaled axes.
//
// So the lead chart is INDEXED: every metric starts at 100 for the baseline
// product, and each other product is plotted as its percentage of that. Cost
// and weight then share one axis and one scale, and the divergence is the whole
// point of the picture rather than something you have to work out.
//
// Crucially those index values are not recomputed here. The backend already
// returns deltaPct for every metric against the baseline, so index = 100 +
// deltaPct — server arithmetic, re-expressed. The one genuinely derived number
// on this page is the cost/weight divergence ratio, and it is plainly labelled
// as a ratio of the two reported deltas.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import api from '@/lib/api';
import { useApi } from '@/lib/useApi';
import ChartCard from '@/components/reports/ChartCard';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { colorAt } from '@/lib/chartData';
import {
  formatCount,
  formatCurrency,
  formatWeight,
  makeProductLabeller,
} from '@/lib/format';

/** The backend caps comparison at five products; mirror it so the UI can't ask for six. */
const MAX_COMPARE = 5;

/** Signed percentage, e.g. "+50.1%" / "−17.1%". */
function formatDelta(pct) {
  if (pct === null || pct === undefined) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct)}%`;
}

/**
 * Salmon for more, green for less — cost-engineer convention, not stoplight
 * decoration. This is the one and only place `text-warning` (Daikin salmon)
 * is used in the whole app: an "over-budget" cost delta, exactly the rare,
 * meaning-only signal it's reserved for. Everyday errors still use
 * `text-destructive`, kept deliberately separate (see index.css).
 */
function deltaClass(pct) {
  if (!pct) return 'text-muted-foreground';
  return pct > 0 ? 'text-warning' : 'text-emerald-600';
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-80" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    data: products,
    loading: productsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useApi(({ signal }) => api.products.list({ signal }), []);

  /**
   * Colour per product, assigned from the FULL product list sorted by id.
   *
   * Deliberately not assigned from the compared subset: if colours were indexed
   * by position in the comparison, deselecting Vertex would silently repaint
   * Meridian in Vertex's colour. A reader who glanced away would read the new
   * chart with the old colour mapping. Anchoring to the full list means a
   * product's colour never changes, whatever else is on screen.
   */
  /**
   * Label products by brand, falling back to "Brand Model" where a brand
   * appears twice in the set. Built from the FULL product list rather than the
   * selected subset, for the same reason colours are: the label for a given
   * product shouldn't change depending on what else happens to be selected.
   */
  const productLabel = useMemo(() => makeProductLabeller(products ?? []), [products]);

  const colorByProductId = useMemo(() => {
    const map = new Map();
    [...(products ?? [])]
      .sort((a, b) => a.id - b.id)
      .forEach((p, i) => map.set(p.id, colorAt(i)));
    return map;
  }, [products]);

  // Selection lives in the URL so a comparison is linkable and survives refresh.
  const allIds = (products ?? []).map((p) => p.id);
  const requestedIds = (searchParams.get('ids') ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  const selectedIds = requestedIds.length
    ? requestedIds.filter((id) => allIds.includes(id)).slice(0, MAX_COMPARE)
    : allIds.slice(0, MAX_COMPARE);

  const idsKey = selectedIds.join(',');

  const toggleProduct = (id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id].slice(0, MAX_COMPARE);
    setSearchParams(next.length ? { ids: next.join(',') } : {}, { replace: true });
  };

  const {
    data: comparison,
    loading,
    error,
    refetch,
  } = useApi(
    // idsKey is a string — an array literal here would give the effect a new
    // identity every render and loop forever.
    ({ signal }) => api.reports.compare(idsKey.split(',').map(Number), { signal }),
    [idsKey],
    { enabled: selectedIds.length >= 2, keepPreviousData: true },
  );

  const rows = comparison?.products ?? [];
  const baseline = rows[0];
  const currency = baseline?.currency;

  /** Look up a product's delta block; the baseline itself has none. */
  const deltasFor = (productId) =>
    comparison?.comparisons?.find((c) => c.productId === productId)?.deltas ?? null;

  /**
   * The indexed chart: one group per metric, one bar per product, baseline = 100.
   *
   * index = 100 + deltaPct, so these are the backend's own comparison figures
   * re-expressed rather than recalculated here.
   */
  const indexData = useMemo(() => {
    if (!baseline) return [];
    const metrics = [
      ['Cost', 'totalCost'],
      ['Weight', 'totalWeightKg'],
      ['Part units', 'partUnits'],
      ['Cost / kg', 'costPerKg'],
    ];

    return metrics.map(([label, key]) => {
      const point = { metric: label };
      rows.forEach((row) => {
        if (row.productId === baseline.productId) {
          point[`p${row.productId}`] = 100;
        } else {
          const d = deltasFor(row.productId)?.[key];
          point[`p${row.productId}`] = d?.deltaPct === null || d === undefined ? null : 100 + d.deltaPct;
        }
      });
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison]);

  /**
   * How much faster cost is climbing than mass, per product.
   *
   * THE ONE DERIVED FIGURE ON THIS PAGE: a ratio of two deltas the backend
   * reported. Guarded against a zero or negative weight delta, where "N times
   * faster" stops meaning anything and is better left unsaid than printed as
   * Infinity.
   */
  const divergence = useMemo(
    () =>
      rows
        .filter((row) => row.productId !== baseline?.productId)
        .map((row) => {
          const d = deltasFor(row.productId);
          const costPct = d?.totalCost?.deltaPct;
          const weightPct = d?.totalWeightKg?.deltaPct;
          const ratio =
            costPct && weightPct && weightPct > 0 ? Number((costPct / weightPct).toFixed(1)) : null;
          return { ...row, costPct, weightPct, ratio };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparison],
  );

  // ---- page-level states -------------------------------------------------

  if (productsError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {productsError.isNetworkError ? 'Cannot reach the API' : 'Could not load products'}
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
    );
  }

  if (productsLoading) return <LoadingState />;

  // Fewer than two teardowns in the database at all — a different problem from
  // "you deselected too many", so it gets a different message.
  if ((products?.length ?? 0) < 2) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="font-medium">Not enough teardowns to compare</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Comparison needs at least two products. Run{' '}
            <code className="font-mono">npm run seed</code> in{' '}
            <code className="font-mono">backend/</code> to load the sample set.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/products">Back to products</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/products">
            <ArrowLeft className="mr-1 size-4" />
            All products
          </Link>
        </Button>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Product comparison</h2>
            <p className="text-sm text-muted-foreground">
              {baseline
                ? `${baseline.brand} is the baseline — every delta is stated against it.`
                : 'Select at least two products to compare.'}
            </p>
          </div>
          {/* Hands the current selection straight over, so the two views stay in
              sync rather than each having its own idea of what's being compared.
              Hidden below two products for the same reason "Compare all" is on
              the products page: best-of-best needs something to rank. */}
          {selectedIds.length >= 2 && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/best-of-best?ids=${selectedIds.join(',')}`}>Best-of-Best →</Link>
            </Button>
          )}
        </div>

        {/* Selection chips. Each carries its product's fixed colour, so the
            legend for every chart below is really this row. */}
        <div className="flex flex-wrap gap-2">
          {products.map((product) => {
            const active = selectedIds.includes(product.id);
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => toggleProduct(product.id)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
                  active ? 'border-foreground/30 bg-muted' : 'text-muted-foreground'
                }`}
              >
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor: colorByProductId.get(product.id),
                    opacity: active ? 1 : 0.3,
                  }}
                />
                {productLabel(product)}
                {selectedIds[0] === product.id && (
                  <Badge variant="secondary" className="ml-1">
                    baseline
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedIds.length < 2 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">Select at least two products</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              A comparison needs a baseline and something to compare it against.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchParams({}, { replace: true })}
            >
              Compare all
            </Button>
          </CardContent>
        </Card>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {error.isNetworkError ? 'Cannot reach the API' : 'Could not load comparison'}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading && !comparison ? (
        <LoadingState />
      ) : !comparison ? null : (
        <div className={loading ? 'space-y-6 opacity-60' : 'space-y-6'}>
          {/* ---- the headline ------------------------------------------- */}
          <ChartCard
            title="Cost vs weight, indexed to baseline"
            description={`${baseline.brand} = 100 on every metric. Bars above 100 are higher than baseline — the gap between the Cost group and the Weight group is the story.`}
            height={320}
            isEmpty={indexData.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={indexData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <XAxis dataKey="metric" fontSize={12} />
                <YAxis fontSize={11} width={44} tickFormatter={(v) => `${v}`} />
                <Tooltip formatter={(v) => (v === null ? '—' : `${v.toFixed(1)} (baseline = 100)`)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* The 100 line makes "above/below baseline" readable at a glance
                    without reading tick labels. */}
                <ReferenceLine y={100} stroke="currentColor" strokeDasharray="4 4" opacity={0.4} />
                {rows.map((row) => (
                  <Bar
                    key={row.productId}
                    dataKey={`p${row.productId}`}
                    name={productLabel(row)}
                    fill={colorByProductId.get(row.productId)}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {divergence.some((d) => d.ratio) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Cost is outpacing mass</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Cost delta ÷ weight delta, both measured against {baseline.brand}
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {divergence.map((row) => (
                  <div key={row.productId} className="flex items-baseline gap-3">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorByProductId.get(row.productId) }}
                    />
                    <div>
                      <p className="text-sm font-medium">{productLabel(row)}</p>
                      <p className="text-sm text-muted-foreground">
                        costs{' '}
                        <span className="font-semibold text-foreground">
                          {formatDelta(row.costPct)}
                        </span>{' '}
                        but weighs only{' '}
                        <span className="font-semibold text-foreground">
                          {formatDelta(row.weightPct)}
                        </span>{' '}
                        —{' '}
                        {row.ratio ? (
                          <span className="font-semibold text-foreground">
                            {row.ratio}× faster on cost
                          </span>
                        ) : (
                          'no meaningful ratio'
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ---- absolutes ---------------------------------------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            {[
              {
                title: 'Total cost',
                key: 'totalCost',
                fmt: (v) => formatCurrency(v, currency),
              },
              { title: 'Total weight', key: 'totalWeightKg', fmt: (v) => formatWeight(v) },
              { title: 'Part units', key: 'partUnits', fmt: (v) => formatCount(v) },
              { title: 'Cost per kg', key: 'costPerKg', fmt: (v) => formatCurrency(v, currency) },
            ].map(({ title, key, fmt }) => {
              const data = rows.map((row) => ({
                productId: row.productId,
                name: productLabel(row),
                value: row[key],
              }));
              return (
                <ChartCard key={key} title={title} height={240} isEmpty={data.length === 0}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <XAxis dataKey="name" fontSize={11} interval={0} />
                      <YAxis fontSize={11} width={60} tickFormatter={fmt} />
                      <Tooltip formatter={fmt} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {/* Cells rather than a single fill — same colour per
                            product as every other chart on the page. */}
                        {data.map((d) => (
                          <Cell key={d.productId} fill={colorByProductId.get(d.productId)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              );
            })}
          </div>

          {/* ---- the numbers -------------------------------------------- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Deltas against {baseline.brand}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Cost / kg</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const d = deltasFor(row.productId);
                    const isBaseline = row.productId === baseline.productId;
                    return (
                      <TableRow key={row.productId}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: colorByProductId.get(row.productId) }}
                            />
                            <Link to={`/products/${row.productId}`} className="hover:underline">
                              {productLabel(row)}
                            </Link>
                            {isBaseline && (
                              <Badge variant="secondary" className="ml-1">
                                baseline
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.totalCost, currency)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deltaClass(d?.totalCost?.deltaPct)}`}
                        >
                          {isBaseline ? '—' : formatDelta(d?.totalCost?.deltaPct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatWeight(row.totalWeightKg)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deltaClass(d?.totalWeightKg?.deltaPct)}`}
                        >
                          {isBaseline ? '—' : formatDelta(d?.totalWeightKg?.deltaPct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.partLines}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.partUnits}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.costPerKg, currency)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deltaClass(d?.costPerKg?.deltaPct)}`}
                        >
                          {isBaseline ? '—' : formatDelta(d?.costPerKg?.deltaPct)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}