// ---------------------------------------------------------------------------
// src/components/DeckExportPanel.jsx
//
// Export the benchmark deck for one product, from the Competitive Intelligence
// hub rather than from that product's own page.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS SEPARATELY FROM THE BUTTON ON ProductDetailPage
//
// The deck builder (lib/exportPptx.js) needs three payloads: the teardown for
// structure, the executive report for the headline story, and the cost report for
// the money. A product's own page already has all three loaded, so its export
// button is a one-liner. The hub has none of them — it only holds the product list
// and a comparison summary.
//
// So this panel does the fetching. It is NOT a second deck builder: the same
// exportBenchmarkToPowerPoint is called with the same arguments, so a deck exported
// here and one exported from the product page are byte-for-byte the same document.
// Forking the deck for the sake of avoiding three requests would be the worst
// possible trade — two divergent versions of the artefact that leaves the building.
//
// ---------------------------------------------------------------------------
// WHY THE FETCH IS ON THE BUTTON AND NOT ON MOUNT
//
// Three report requests per product, five products, on a hub page nobody may
// export from — that is fifteen round trips to render a dropdown. The payloads are
// fetched when Export is pressed, for the ONE product chosen. The cost is a second
// or two of "Building deck…" on a deliberate action, which is the right place to
// spend it.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertTriangle, Presentation } from 'lucide-react';

import api, { PERSONAS } from '@/lib/api';
import { exportBenchmarkToPowerPoint } from '@/lib/exportPptx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/**
 * @param {object} props
 * @param {Array<{id: number, brand: string, name: string}>} props.products
 * @param {number[]} [props.comparisonIds]  included as the comparison slide when
 *   there are at least two — its absence degrades one slide, not the export
 */
export default function DeckExportPanel({ products = [], comparisonIds = [] }) {
  const [productId, setProductId] = useState(products[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    const id = Number(productId ?? products[0]?.id);
    if (!id) return;
    setError(null);
    setBusy(true);
    try {
      // Concurrent, not sequential: three independent GETs with no ordering
      // between them, and a deck that takes three times as long to build for no
      // reason is just a slower deck.
      const [teardown, executive, cost] = await Promise.all([
        api.products.teardown(id),
        api.reports.get(id, PERSONAS.EXECUTIVE),
        api.reports.get(id, PERSONAS.COST_ENGINEER),
      ]);
      const comparison =
        comparisonIds.length >= 2 ? await api.reports.compare(comparisonIds) : null;

      exportBenchmarkToPowerPoint(
        teardown,
        executive.payload,
        cost.payload,
        comparison,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (products.length === 0) return null;

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="deck-product" className="text-xs">Deck for</Label>
          <select
            id="deck-product"
            value={productId ?? ''}
            onChange={(e) => setProductId(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.brand} {p.name}</option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={run} disabled={busy}>
          <Presentation className="mr-1.5 size-4" />
          {busy ? 'Building deck…' : 'Export PowerPoint'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Executive summary, cost breakdown and the module story
        {comparisonIds.length >= 2 ? ', plus a comparison slide across the set' : ''}. Identical
        to the deck exported from the product page — same builder, same payloads.
      </p>
    </div>
  );
}
