// ---------------------------------------------------------------------------
// src/components/ProductSearchPanel.jsx
//
// The search-and-select header for the Product Benchmark Repository: a free-text
// box that filters the catalog live, brand facets, match counts, and the
// comparison selection tray.
//
// Presentational — it holds no state. Query, brand facet and selection all live
// on ProductsPage (and in the URL), which is what lets a selection survive a
// round trip to /compare and back. Same contract ProductCatalogEntry keeps.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AT FIVE PRODUCTS
//
// Five teardowns fit on a screen. Hundreds will not, which is the case
// stakeholders actually made. So the affordances here are sized for the later
// problem rather than the current one: substring search across every field a
// user would recall a unit by, brand facets derived from the data, and an
// explicit match count so a filter can never silently hide something.
//
// The selection tray is deliberately NOT a modal or a separate page. Picking
// products to compare is part of browsing them — a CarMax-style persistent tray
// keeps the catalog visible while the set is assembled.
// ---------------------------------------------------------------------------

import { Link } from 'react-router-dom';
import { BarChart3, Search, Trophy, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * @param {object} props
 * @param {string} props.query
 * @param {(value: string) => void} props.onQueryChange
 * @param {string|null} props.brand                    active brand facet
 * @param {(brand: string|null) => void} props.onBrandChange
 * @param {Array<{brand: string, count: number}>} props.facets
 * @param {number} props.total                         products in the repository
 * @param {number} props.matching                      products after filtering
 * @param {() => void} props.onClear                   clears query AND facet
 * @param {Array<object>} props.selected               selected product records
 * @param {number} props.maxSelected
 * @param {(id: number) => void} props.onToggleSelect
 * @param {() => void} props.onClearSelection
 *
 * NOTE ON CHIP LABELS: chips show brand AND model, always — deliberately NOT via
 * lib/format's `makeProductLabeller`, which drops the model when a brand is
 * unique. That rule exists to keep chart legends short, and it's right there. A
 * selection tray is the opposite case: the user picked one specific unit, and a
 * chip reading just "Goodman" doesn't confirm which. There's room here, so it
 * says both.
 */
export default function ProductSearchPanel({
  query,
  onQueryChange,
  brand,
  onBrandChange,
  facets,
  total,
  matching,
  onClear,
  selected,
  maxSelected,
  onToggleSelect,
  onClearSelection,
}) {
  const filtering = Boolean(query.trim()) || Boolean(brand);
  const selectedIds = selected.map((p) => p.id);
  // Both destinations need a baseline and something to compare it against.
  const canCompare = selectedIds.length >= 2;
  const idsParam = selectedIds.join(',');

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        {/* ---- free-text search ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search by brand, model number, category or description…"
              aria-label="Search the benchmark repository"
              className="pl-8"
            />
          </div>
          {/* Only offered when there's something to clear — a permanently
              visible Clear on an empty search is a dead control. */}
          {filtering && (
            <Button variant="outline" size="sm" onClick={onClear}>
              <X className="mr-1 size-4" />
              Clear search
            </Button>
          )}
        </div>

        {/* ---- brand facets ---- */}
        {facets.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Brand</span>
            <button
              type="button"
              onClick={() => onBrandChange(null)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                brand === null
                  ? 'border-accent bg-accent/15 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/10'
              }`}
            >
              All ({total})
            </button>
            {facets.map((facet) => (
              <button
                key={facet.brand}
                type="button"
                onClick={() => onBrandChange(brand === facet.brand ? null : facet.brand)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  brand === facet.brand
                    ? 'border-accent bg-accent/15 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/10'
                }`}
              >
                {facet.brand} ({facet.count})
              </button>
            ))}
          </div>
        )}

        {/* ---- match count ---- */}
        {/* Always shown, filtering or not. A count that only appears once you
            filter leaves the reader guessing whether the list is complete. */}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filtering ? (
            <>
              Showing <span className="font-semibold text-foreground">{matching}</span> of{' '}
              <span className="font-semibold text-foreground">{total}</span>{' '}
              {total === 1 ? 'product' : 'products'}
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">{total}</span>{' '}
              {total === 1 ? 'product' : 'products'} in the repository
            </>
          )}
          {selectedIds.length > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-foreground">{selectedIds.length}</span> selected
            </>
          )}
        </p>

        {/* ---- selection tray ---- */}
        {selectedIds.length > 0 && (
          <div className="space-y-3 rounded-md border border-accent/60 bg-accent/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Selected for comparison
              </span>
              {selected.map((product) => (
                <Badge key={product.id} variant="secondary" className="gap-1 pr-1 font-normal">
                  <span className="text-muted-foreground">{product.brand}</span>
                  <span className="font-medium">{product.name}</span>
                  <button
                    type="button"
                    onClick={() => onToggleSelect(product.id)}
                    aria-label={`Remove ${product.brand} ${product.name} from the selection`}
                    className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Disabled rather than hidden below two, with the reason stated
                  beside them — a button that vanishes leaves the user unsure
                  whether the feature exists.

                  Two separate Buttons rather than one with `asChild={canCompare}`:
                  asChild needs exactly one child element, so the disabled branch
                  had to wrap its icon and label in a <span>. That span becomes
                  the button's only flex item, so the icon and text stopped being
                  laid out by the button's own inline-flex and visibly overlapped.
                  Rendering the children directly in each branch keeps the layout
                  identical whether the button is a link or not. */}
              {canCompare ? (
                <Button asChild size="sm">
                  <Link to={`/compare?ids=${idsParam}`}>
                    <BarChart3 className="mr-1 size-4" />
                    Compare selected
                  </Link>
                </Button>
              ) : (
                <Button size="sm" disabled>
                  <BarChart3 className="mr-1 size-4" />
                  Compare selected
                </Button>
              )}

              {canCompare ? (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/best-of-best?ids=${idsParam}`}>
                    <Trophy className="mr-1 size-4" />
                    Best-of-Best selected
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  <Trophy className="mr-1 size-4" />
                  Best-of-Best selected
                </Button>
              )}

              <Button variant="ghost" size="sm" onClick={onClearSelection}>
                Clear selection
              </Button>

              {!canCompare && (
                <span className="text-xs text-muted-foreground">
                  Select at least two products to compare.
                </span>
              )}
              {selectedIds.length >= maxSelected && (
                <span className="text-xs text-muted-foreground">
                  Maximum of {maxSelected} products — remove one to swap it out.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
