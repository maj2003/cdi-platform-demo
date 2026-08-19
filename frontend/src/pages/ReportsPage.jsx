// ---------------------------------------------------------------------------
// src/pages/ReportsPage.jsx — route /products/:id/reports
//
// Three persona views over one product, behind tabs.
//
// ---------------------------------------------------------------------------
// THE CACHING STORY, made visible
//
// GET /api/reports/:id/:persona serves the last stored snapshot and only
// computes when none exists. That's fast, and it means a report has a real
// "generated at" — but it also means the numbers on screen can predate an edit
// to the teardown.
//
// Rather than hide that, the header states it: a Cached/Fresh badge and the
// generation timestamp, with a Regenerate button beside them. When someone
// disputes a number mid-demo, "is that stale?" is the first question, and the
// answer should be on screen rather than guessed at.
// ---------------------------------------------------------------------------

import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';

import api, { PERSONAS, PERSONA_LABELS } from '@/lib/api';
import { useApi, useApiAction } from '@/lib/useApi';
import ProductSubNav from '@/components/ProductSubNav';
import CostEngineerReport from '@/components/reports/CostEngineerReport';
import DesignEngineerReport from '@/components/reports/DesignEngineerReport';
import ExecutiveReport from '@/components/reports/ExecutiveReport';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';

const PERSONA_ORDER = [PERSONAS.COST_ENGINEER, PERSONAS.DESIGN_ENGINEER, PERSONAS.EXECUTIVE];

const PANELS = {
  [PERSONAS.COST_ENGINEER]: CostEngineerReport,
  [PERSONAS.DESIGN_ENGINEER]: DesignEngineerReport,
  [PERSONAS.EXECUTIVE]: ExecutiveReport,
};

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

export default function ReportsPage() {
  const { id } = useParams();

  // Persona lives in the URL, not in component state.
  //
  // Three reasons, all of which matter for a demo: the back button works, a tab
  // survives a page refresh, and you can paste someone a link straight to the
  // executive view instead of saying "now click the third tab".
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('persona');
  const persona = PERSONA_ORDER.includes(requested) ? requested : PERSONAS.COST_ENGINEER;

  const setPersona = (next) =>
    // replace: true — switching tabs shouldn't stack history entries, or Back
    // walks you through every tab you touched instead of leaving the page.
    setSearchParams({ persona: next }, { replace: true });

  const { data, loading, error, refetch } = useApi(
    ({ signal }) => api.reports.get(id, persona, { signal }),
    [id, persona],
    // keepPreviousData: the panel holds the outgoing persona's content while the
    // next one loads, so switching tabs doesn't flash an empty page. The charts
    // swap in place, which reads as instant even when it isn't.
    { keepPreviousData: true },
  );

  // POST, so it belongs to useApiAction — it must fire on click, never on render.
  const regenerate = useApiAction(async () => {
    await api.reports.generate(id, persona);
    refetch();
  });

  /**
   * Click handler for Regenerate.
   *
   * The `.catch()` is required, not defensive. useApiAction deliberately
   * rethrows so callers can sequence follow-up work — but a fire-and-forget
   * onClick has no `await` to receive that rejection, so it surfaces as an
   * unhandled promise rejection in the console (and a crash under a test
   * runner). The failure is already captured in `regenerate.error` and rendered
   * below; this just acknowledges it so the runtime doesn't complain.
   */
  const handleRegenerate = () => {
    regenerate.run().catch(() => {});
  };

  const payload = data?.payload;

  // ---------------------------------------------------------------------------
  // Pick the panel from the PAYLOAD's persona, not the selected tab.
  //
  // This is the subtle half of keepPreviousData, and getting it wrong is a hard
  // crash rather than a cosmetic glitch. During a tab switch the selected
  // persona updates immediately while `data` still holds the OUTGOING persona's
  // payload. Keying off `persona` would hand a design-engineer payload to
  // ExecutiveReport, which reads payload.headline.totalCost and throws on
  // undefined — the page goes blank mid-switch.
  //
  // Every payload carries its own `persona`, so that field is the honest source
  // of truth for which component can render it. Panel and payload then flip
  // together when the new data lands, which is exactly what "keep the previous
  // view" is supposed to mean.
  // ---------------------------------------------------------------------------
  const Panel = PANELS[payload?.persona] ?? PANELS[persona];

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
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {payload?.productName ?? 'Benchmarking report'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {payload ? `${payload.brand} · ${payload.category}` : 'Loading report…'}
            </p>
          </div>

          {data && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <Badge variant={data.cached ? 'secondary' : 'default'}>
                  {data.cached ? 'Cached' : 'Fresh'}
                </Badge>
                <p className="mt-1 text-xs text-muted-foreground">
                  Generated {formatDateTime(data.report.generatedAt)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={regenerate.loading}
              >
                <RefreshCw
                  className={`mr-1 size-4 ${regenerate.loading ? 'animate-spin' : ''}`}
                />
                {regenerate.loading ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          )}
        </div>

        <ProductSubNav productId={id} />
      </div>

      <Tabs value={persona} onValueChange={setPersona}>
        <TabsList>
          {PERSONA_ORDER.map((key) => (
            <TabsTrigger key={key} value={key}>
              {PERSONA_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* The panel is rendered outside <Tabs> on purpose. TabsContent mounts all
          three panels and hides two; here each persona is a separate fetch, so
          mounting all three would fire three requests and render two invisible
          chart trees. One panel, one request. */}

      {regenerate.error && (
        <Alert variant="destructive">
          <AlertTitle>Could not regenerate</AlertTitle>
          <AlertDescription>{regenerate.error.message}</AlertDescription>
        </Alert>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {error.status === 404
              ? 'Product not found'
              : error.isNetworkError
                ? 'Cannot reach the API'
                : 'Could not load report'}
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
                <Link to={error.status === 404 ? '/products' : `/products/${id}`}>
                  {error.status === 404 ? 'All products' : 'Back to teardown'}
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : loading && !payload ? (
        // `&& !payload` — with keepPreviousData the previous persona's content is
        // still in hand during a tab switch, and replacing it with a skeleton
        // would defeat the point of keeping it.
        <ReportSkeleton />
      ) : !payload ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">No report available</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing has been generated for this persona yet.
            </p>
            <Button variant="outline" size="sm" onClick={handleRegenerate}>
              Generate now
            </Button>
          </CardContent>
        </Card>
      ) : (
        // Dim during a background refetch so a stale panel is visibly stale
        // rather than silently so.
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <Panel payload={payload} />
        </div>
      )}
    </div>
  );
}