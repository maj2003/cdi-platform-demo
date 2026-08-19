// ---------------------------------------------------------------------------
// src/components/ProductCatalogEntry.jsx
//
// One teardown as a full-width catalog entry: imagery on the left, the
// competitive detail on the right. Replaces the small three-stat ProductCard so
// the Benchmark Repository reads as a product catalog rather than a table with
// rounded corners.
//
// Presentational only, same contract the old card kept: it fetches nothing and
// knows nothing about the API. Every figure — including the superlative badges —
// arrives as a prop, so a catalog entry can never trigger its own request and
// can never disagree with the page that rendered it.
//
// ---------------------------------------------------------------------------
// TWO PLACEHOLDERS, BOTH DELIBERATE
//
// 1. THE PRODUCT IMAGE is an inline SVG line drawing of a generic air handler,
//    not a photo. There are no product photos in this build (part photos exist,
//    but they live per-part in IndexedDB and fetching them here would mean one
//    extra request per product on a list page). Drawn rather than shipped as an
//    asset so it inherits `currentColor` and themes correctly in dark mode, and
//    so it reads unmistakably as a placeholder instead of implying a real
//    teardown photo exists.
//
// 2. THE MANUFACTURER LOGO is a monogram tile — the brand's initials set in the
//    app's own type, NOT the real Goodman/Carrier/Trane/Bosch marks. Those are
//    registered trademarks that this repo has no licence to bundle, and dropping
//    a real logo beside fabricated cost data is exactly the combination that
//    makes an illustrative screenshot look like published competitive
//    intelligence. ProductsPage states once, above the list, that imagery and
//    logos are placeholders.
// ---------------------------------------------------------------------------

import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, FileText , Trash2 } from 'lucide-react';

import ProductSourceBadge from '@/components/ProductSourceBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AhuSilhouette from '@/components/AhuSilhouette';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount, formatCurrency, formatWeight } from '@/lib/format';

/**
 * Brand monogram — first letter of each word, up to two.
 * "Goodman" -> "G", "Trane Technologies" -> "TT".
 */
function monogram(brand) {
  return String(brand ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/**
 * Pull the illustrative-data disclaimer out of `notes` so the rest reads as prose.
 *
 * The seed deliberately prefixes every product's notes with "ILLUSTRATIVE DATA —
 * figures are fabricated, not from a real teardown." so a screenshot carries its
 * own disclaimer (see PROGRESS.md). Splitting it into a badge keeps that warning
 * visible — arguably more visible than as the opening clause of a paragraph
 * people skim — while letting the actual product description stand on its own.
 *
 * Falls back to showing the whole string untouched if the prefix isn't there, so
 * changing the seed's wording degrades to "disclaimer still shown, just not
 * styled" rather than "disclaimer silently dropped".
 */
function splitNotes(notes) {
  if (!notes) return { illustrative: false, description: null };
  const match = /^ILLUSTRATIVE DATA\s*—\s*[^.]*\.\s*(.*)$/s.exec(notes);
  if (!match) return { illustrative: false, description: notes };
  return { illustrative: true, description: match[1].trim() || null };
}

/** One headline figure. Skeleton while the metrics request is still in flight. */
function Stat({ label, value, loading }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        // A plausible-looking zero is worse than a blank: nobody questions
        // "$0.00", so it silently becomes the wrong answer on screen. format*
        // returns an em-dash for null, which reads as "not computed".
        <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      )}
    </div>
  );
}

/** Tone → badge treatment for a superlative. See ProductsPage for how these are picked. */
const TONE_CLASS = {
  best: 'border-accent bg-accent/15 text-foreground',
  high: 'border-warning/50 text-warning',
  neutral: '',
};

/**
 * @param {object}   props
 * @param {object}   props.product           from GET /api/products
 * @param {object}   [props.metrics]         reshaped /reports/compare row
 * @param {boolean}  [props.metricsLoading]
 * @param {Array<{label: string, tone: 'best'|'high'|'neutral'}>} [props.superlatives]
 *   cross-product rankings, computed once by the page rather than per card
 * @param {boolean} [props.selected]        selected for comparison
 * @param {boolean} [props.selectDisabled]  at the selection limit and not selected
 * @param {Function} [props.onDelete]  omit to hide the delete control entirely
 * @param {(id: number) => void} [props.onToggleSelect]  omit to hide the control
 *   entirely — an entry rendered outside a selection context shouldn't offer one
 */
export default function ProductCatalogEntry({
  product,
  metrics,
  metricsLoading = false,
  superlatives = [],
  selected = false,
  selectDisabled = false,
  onToggleSelect,
  onDelete,
}) {
  const { illustrative, description } = splitNotes(product.notes);
  const topCostBlock = metrics?.costBySubAssembly?.[0]?.label ?? null;
  const checkboxId = `select-product-${product.id}`;

  return (
    // hover:border-accent preserved from the card this replaces — the "accent is
    // the ambient hover/selected colour" rule from the palette pass. A selected
    // entry keeps that accent border permanently plus a faint tint, so the
    // selection is visible while scanning the page, not only in the chip row.
    <Card
      data-selected={selected ? 'true' : undefined}
      className={`overflow-hidden transition-colors ${
        selected ? 'border-accent bg-accent/5' : 'hover:border-accent'
      }`}
    >
      <CardContent className="grid gap-6 py-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {/* ---------------- left: imagery ---------------- */}
        <div className="space-y-3">
          {/* Selection sits at the top of the imagery column so the checkboxes
              line up as one scannable column down the page — the affordance a
              catalog needs when the list runs to hundreds. */}
          {onToggleSelect && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={selected}
                disabled={selectDisabled}
                onCheckedChange={() => onToggleSelect(product.id)}
              />
              <Label
                htmlFor={checkboxId}
                className={`cursor-pointer text-xs font-medium ${
                  selectDisabled ? 'cursor-not-allowed text-muted-foreground/60' : ''
                }`}
              >
                {selected ? 'Selected' : 'Select to compare'}
              </Label>
            </div>
          )}

          <div className="flex aspect-4/3 items-center justify-center rounded-lg border bg-muted/40 md:aspect-square">
            <AhuSilhouette className="h-4/5 w-auto text-muted-foreground/50" />
          </div>

          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-card text-sm font-semibold tracking-tight text-muted-foreground"
            >
              {monogram(product.brand)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{product.brand}</p>
              <p className="text-xs text-muted-foreground">Manufacturer</p>
            </div>
          </div>

          {/* Provenance. This is the screen where it matters most: it's the one
              place fabricated seed figures sit in a list beside real imported
              ones, looking identical. */}
          <div className="mt-3">
            <ProductSourceBadge product={product} withDate />
          </div>
        </div>

        {/* ---------------- right: the competitive detail ---------------- */}
        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-normal">
                {product.category}
              </Badge>
              {illustrative && (
                <Badge variant="outline" className="border-warning/50 font-normal text-warning">
                  Illustrative data — figures fabricated
                </Badge>
              )}
            </div>

            <h3 className="text-lg font-semibold leading-tight tracking-tight">
              {/* Only the model number carries the link affordance. A card-wide
                  <a> would swallow the action buttons below it. */}
              <Link to={`/products/${product.id}`} className="hover:underline">
                {product.name}
              </Link>
            </h3>

            {description && (
              <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>

          {/* ---- the four headline figures ---- */}
          <dl className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
            <Stat
              label="Total cost"
              loading={metricsLoading}
              value={formatCurrency(metrics?.totalCost, metrics?.currency)}
            />
            <Stat
              label="Total weight"
              loading={metricsLoading}
              value={formatWeight(metrics?.totalWeightKg)}
            />
            <Stat
              label="Part lines"
              loading={metricsLoading}
              value={formatCount(metrics?.partLines ?? metrics?.partUnits)}
            />
            {/* Module count comes from the product list itself, not the metrics
                request — so it renders immediately instead of behind a skeleton. */}
            <Stat label="Modules" value={formatCount(product.subAssemblyCount)} />
          </dl>

          {/* ---- key differentiators ---- */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Key differentiators
            </p>
            {metricsLoading ? (
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-6 w-40" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {superlatives.map((s) => (
                  <Badge key={s.label} variant="outline" className={`font-normal ${TONE_CLASS[s.tone]}`}>
                    {s.label}
                  </Badge>
                ))}
                {topCostBlock && (
                  <Badge variant="outline" className="font-normal">
                    Top cost block: {topCostBlock}
                  </Badge>
                )}
                {metrics?.costPerKg !== null && metrics?.costPerKg !== undefined && (
                  <Badge variant="outline" className="font-normal tabular-nums">
                    {formatCurrency(metrics.costPerKg, metrics.currency)}/kg
                  </Badge>
                )}
                {metrics?.distinctMaterials && (
                  <Badge variant="outline" className="font-normal">
                    {metrics.distinctMaterials} materials
                  </Badge>
                )}
                {/* Never render an empty row with a heading above it. */}
                {superlatives.length === 0 && !topCostBlock && !metrics && (
                  <span className="text-sm text-muted-foreground">
                    Unavailable until benchmarking figures load.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ---- actions ---- */}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button asChild size="sm">
              <Link to={`/products/${product.id}`}>
                Open teardown
                <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/products/${product.id}/reports`}>
                <FileText className="mr-1 size-4" />
                Reports
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/compare?ids=${product.id}`}>
                <BarChart3 className="mr-1 size-4" />
                Compare
              </Link>
            </Button>
            {/* Optional, and the PAGE owns the confirmation — an entry rendered
                without onDelete simply has no delete control, which keeps this
                component presentational. */}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(product)}
              >
                <Trash2 className="mr-1 size-4" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
