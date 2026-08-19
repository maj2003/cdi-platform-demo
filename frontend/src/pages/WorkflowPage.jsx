// ---------------------------------------------------------------------------
// src/pages/WorkflowPage.jsx — route /workflow
//
// A map of the end-to-end teardown process, not a new capability of its own.
// Every "Open" button below points at a page that already exists elsewhere in
// this app; this page's only job is to show how those pages chain together,
// and to be honest about which stages are live today, which are stubbed for
// the demo, and which are still just a named integration point.
//
// STATUS MEANINGS (this is the one thing worth getting right):
//   live    — real, working, backed by a real endpoint or database rows.
//   stubbed — the UI and call shape are real; the computation behind it is
//             canned (aiService.parseBOM) on purpose, per CONTEXT.md.
//   planned — nothing built yet. Either a schema column with no UI
//             (Measurement.imageUrl), or an external system this build
//             deliberately does not talk to (see CONTEXT.md 3a).
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Calculator,
  Camera,
  FileText,
  ListTree,
  PackagePlus,
  Ruler,
  Sparkles,
} from 'lucide-react';

import api from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ICON_WRAPPER_CLASS, STATUS_BADGE_VARIANT, STATUS_LABEL } from '@/lib/buildStatus';

/**
 * The eight stages, in process order.
 *
 * `to` is a function of productId because five of the eight stages are
 * product-scoped pages — the picker below resolves which product's id that
 * function receives. Stages with no working destination (`to: null`) render
 * as a status card with no button rather than a dead link.
 */
const STAGES = [
  {
    key: 'intake',
    icon: PackagePlus,
    title: 'Product Intake',
    status: 'live',
    description:
      'Register a competitor product — brand, category, notes — before the physical teardown starts.',
    note: 'The product list and record are fully live. New products are loaded via the seed script today; an in-app "new product" form is a natural next step, not yet built.',
    to: () => '/products',
    actionLabel: 'View products',
    future: [],
  },
  {
    key: 'photo',
    icon: Camera,
    title: 'Photo Capture',
    status: 'partial',
    description: 'Attach one or more reference photos to each part as it is torn down.',
    note: 'Upload and thumbnails are real (Product Detail → a part → Photos), but storage is this browser\'s IndexedDB only — nothing is uploaded anywhere, and nothing is shared across devices or teammates.',
    to: (id) => `/products/${id}`,
    actionLabel: 'View photos',
    future: ['SharePoint / Blob storage'],
  },
  {
    key: 'measurements',
    icon: Ruler,
    title: 'Measurements',
    status: 'live',
    description:
      'Capture length, width, height and weight per part via the HID keyboard-input flow — focus-locked, auto-advancing.',
    note: null,
    to: (id) => `/products/${id}/capture`,
    actionLabel: 'Open capture',
    future: [],
  },
  {
    key: 'bom',
    icon: ListTree,
    title: 'BOM Creation',
    status: 'partial',
    description:
      'Structure the teardown into sub-assemblies and parts — the bill of materials the rest of the pipeline runs on.',
    note: 'The BOM tree is fully viewable on the teardown page. Building one interactively, rather than via the seed script, is not yet exposed as an API or a form.',
    to: (id) => `/products/${id}`,
    actionLabel: 'View BOM',
    future: [],
  },
  {
    key: 'ai',
    icon: Sparkles,
    title: 'AI Classification',
    status: 'stubbed',
    description:
      'Classify a raw parts list into named parts with material, category and a confidence score.',
    note: 'Canned, realistic results today (aiService.parseBOM) — the same call shape a real model request will use, so only the function body changes later.',
    to: (id) => `/products/${id}/ai-parse`,
    actionLabel: 'Open AI BOM parse',
    future: ['Azure OpenAI'],
  },
  {
    key: 'benchmarking',
    icon: Calculator,
    title: 'Benchmarking',
    status: 'live',
    description:
      'Roll up cost, weight and material figures for one teardown and compute deltas against another.',
    note: null,
    to: (id) => `/products/${id}/reports`,
    actionLabel: 'Run benchmarking',
    future: [],
  },
  {
    key: 'reports',
    icon: FileText,
    title: 'Reports',
    status: 'live',
    description:
      'Persona views — Cost Engineer, Design Engineer, Executive — each with charts, generated from the benchmarking output.',
    note: null,
    to: (id) => `/products/${id}/reports`,
    actionLabel: 'View reports',
    future: [],
  },
  {
    key: 'enterprise',
    icon: Building2,
    title: 'Enterprise Integration',
    status: 'planned',
    description:
      'Push benchmarking results and BOM data out to the systems of record the rest of the org runs on.',
    note: 'Deliberately out of scope for this pre-integration build (see CONTEXT.md 3a) — everything here runs on local SQLite with no cloud connection. backend/src/data/ is the seam this swap goes through.',
    to: null,
    actionLabel: null,
    future: ['Azure SQL / Snowflake', 'ERP', 'PDM', 'PLM'],
  },
];

// STATUS_LABEL / STATUS_BADGE_VARIANT / ICON_WRAPPER_CLASS moved to
// lib/buildStatus.js when the three workflow-section pages (How To Use, New
// Project, Competitive Intelligence Engine) started needing the same
// vocabulary. The status meanings themselves are documented there. Imported at
// the top of this file.

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-9 w-64" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}

export default function WorkflowPage() {
  const {
    data: products,
    loading,
    error,
    refetch,
  } = useApi(({ signal }) => api.products.list({ signal }), []);

  const [selectedId, setSelectedId] = useState(null);
  const productId = selectedId ?? products?.[0]?.id ?? null;

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {error.isNetworkError ? 'Cannot reach the API' : 'Could not load products'}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Teardown workflow</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The end-to-end process this app demonstrates, from intake to enterprise reporting.
          "Open" buttons below jump straight into the real page for each stage — this page adds no
          functionality of its own, only the map of how they connect.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
          <span className="flex items-center gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT.live}>Live</Badge>
            <span className="text-muted-foreground">working end-to-end</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT.stubbed}>Stubbed</Badge>
            <span className="text-muted-foreground">real UI, canned computation</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT.planned}>Planned</Badge>
            <span className="text-muted-foreground">not built yet</span>
          </span>
        </div>
      </div>

      {products?.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="workflow-product" className="text-muted-foreground">
            Follow this workflow for:
          </label>
          <select
            id="workflow-product"
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={productId ?? ''}
            onChange={(e) => setSelectedId(Number(e.target.value))}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} — {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        {STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const isLast = i === STAGES.length - 1;
          const href = stage.to && productId ? stage.to(productId) : null;

          return (
            <div key={stage.key} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${ICON_WRAPPER_CLASS}`}
                >
                  <Icon className="size-4" />
                </div>
                {/* Light-blue accent, not the neutral border color — this
                    line is the one visual thread tying the eight stages
                    into a single flow, and the plain border grey read as
                    barely there. */}
                {!isLast && <div className="w-0.5 flex-1 bg-accent/60" />}
              </div>

              <Card className="mb-4 flex-1">
                <CardContent className="space-y-2 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {i + 1}. {stage.title}
                      </p>
                      <p className="text-sm text-muted-foreground">{stage.description}</p>
                    </div>
                    <Badge variant={STATUS_BADGE_VARIANT[stage.status]} className="shrink-0">
                      {STATUS_LABEL[stage.status]}
                    </Badge>
                  </div>

                  {stage.note && <p className="text-xs text-muted-foreground">{stage.note}</p>}

                  {stage.future.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs text-muted-foreground">Future integration:</span>
                      {stage.future.map((name) => (
                        <Badge key={name} variant="outline" className="border-dashed">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {href && (
                    <div className="pt-1">
                      <Button asChild variant="outline" size="sm">
                        <Link to={href}>{stage.actionLabel}</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
