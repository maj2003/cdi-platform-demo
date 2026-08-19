// ---------------------------------------------------------------------------
// src/components/reports/ExportReportPackButton.jsx
//
// "Export report pack" — the four report pages as one .pptx.
//
// ---------------------------------------------------------------------------
// IT FETCHES THE SAME PAYLOADS THE PAGES RENDER
//
// The deck is assembled here from the Best-of-Best service and the commodity
// roll-up — the same two sources the Best-of-Best and Material pages read — so an
// exported slide and the screen it came from cannot disagree. Nothing is recomputed
// for the export.
//
// Fetching happens on the BUTTON, not on mount: the report pages already load what
// they need, and a second set of requests firing on every page view so that a button
// nobody pressed is ready would be waste. The cost is a second of "Building deck…"
// on a deliberate action, which is the right place to spend it.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertTriangle, Presentation } from 'lucide-react';

import api, { PERSONAS } from '@/lib/api';
import { COMMODITY_GROUPS, rollUpByCommodity } from '@/lib/commodityGroups';
import { formatCurrency } from '@/lib/format';
import {
  ideaTotals,
  OPTIMISATION_IDEAS,
  POLYMER_GRADES,
  POLYMER_OPPORTUNITY,
  SAVING_PER_PRODUCT_USD,
} from '@/lib/reportSampleData';
import { designLabel } from '@/lib/reportSelection';
import { exportReportPack } from '@/lib/exportReportDeck';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function ExportReportPackButton({ ids, products }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    if (!ids?.length) return;
    setError(null);
    setBusy(true);
    try {
      const selected = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean);
      const designs = selected.map(designLabel);

      const [bob, perDesign] = await Promise.all([
        ids.length >= 2 ? api.reports.bestOfBest(ids) : Promise.resolve(null),
        Promise.all(ids.map(async (id) => {
          const [teardown, cost] = await Promise.all([
            api.products.teardown(id),
            api.reports.get(id, PERSONAS.COST_ENGINEER).catch(() => null),
          ]);
          const parts = (teardown?.subAssemblies ?? []).flatMap((s) => s.parts);
          const costByPartId = new Map(
            (cost?.payload?.byPart ?? [])
              .filter((r) => r.costed !== false)
              .map((r) => [r.partId, r.extendedCost]),
          );
          return { id, ...rollUpByCommodity(parts, costByPartId) };
        })),
      ]);

      const currency = bob?.currency ?? 'USD';

      // ---- Best-of-Best (cost) ----
      let bestOfBest = null;
      if (bob) {
        const rows = (bob.moduleLeaders ?? []).map((m) => {
          const byProduct = new Map((m.entries ?? []).map((e) => [e.productId, e.cost]));
          const present = ids.map((id) => byProduct.get(id)).filter((v) => v != null);
          const sorted = [...present].sort((a, b) => a - b);
          const best = sorted[0];
          const gap = sorted.length > 1 ? sorted[1] - best : null;
          return {
            module: m.module,
            values: ids.map((id) => {
              const v = byProduct.get(id);
              return v == null
                ? { text: '—', win: false }
                : { text: formatCurrency(v, currency), win: v === best };
            }),
            bob: formatCurrency(best, currency),
            gap: gap == null ? '—' : formatCurrency(gap, currency),
          };
        });
        const dearest = Math.max(...(bob.products ?? []).map((p) => p.totalCost));
        const saving = Number.isFinite(dearest) && bob.composite
          ? dearest - bob.composite.totalCost
          : 0;
        bestOfBest = {
          designs,
          rows,
          headline: formatCurrency(saving, currency),
          body: `Taking the cheapest version of every module gives a composite BOM of `
            + `${formatCurrency(bob.composite?.totalCost ?? 0, currency)} at `
            + `${(bob.composite?.totalWeightKg ?? 0).toFixed(1)} kg across `
            + `${bob.composite?.moduleCount ?? 0} modules.`,
        };
      }

      // ---- Material & Commodity ----
      const grandCost = perDesign.reduce((s, d) => s + d.totals.cost, 0);
      const material = {
        designs,
        rows: COMMODITY_GROUPS.map((g, gi) => {
          const per = perDesign.map((d) => d.rows[gi]);
          const costs = per.map((r) => r.cost).filter((c) => c > 0);
          const cheapest = costs.length ? Math.min(...costs) : null;
          const groupCost = per.reduce((s, r) => s + r.cost, 0);
          return {
            label: g.label,
            cells: per.flatMap((r) => ([
              { text: r.parts ? String(r.parts) : '—', win: false },
              { text: r.weightG ? (r.weightG / 1000).toFixed(1) : '—', win: false },
              {
                text: r.cost > 0 ? formatCurrency(r.cost, currency) : '—',
                win: r.cost > 0 && r.cost === cheapest,
              },
            ])),
            share: grandCost > 0 ? `${((groupCost / grandCost) * 100).toFixed(0)}%` : '0%',
          };
        }),
        totals: perDesign.flatMap((d) => ([
          String(d.totals.parts),
          (d.totals.weightG / 1000).toFixed(1),
          formatCurrency(d.totals.cost, currency),
        ])),
        headline: formatCurrency(
          Math.max(...perDesign.map((d) => d.totals.cost))
            - Math.min(...perDesign.map((d) => d.totals.cost)),
          currency,
        ),
        body: 'BOM cost spread across the compared designs. The largest commodity is the '
          + 'primary lever for material substitution and design simplification.',
      };

      await exportReportPack({
        context: { designs },
        executive: {
          totals: ideaTotals(),
          ideas: OPTIMISATION_IDEAS,
          savingPerProduct: SAVING_PER_PRODUCT_USD,
        },
        bestOfBest,
        material,
        polymer: {
          grades: POLYMER_GRADES,
          from: POLYMER_OPPORTUNITY.from.grade,
          to: POLYMER_OPPORTUNITY.to.grade,
          saving: `~$${(POLYMER_OPPORTUNITY.annualSavingUsd / 1000).toFixed(0)}K / year`,
          rationale: POLYMER_OPPORTUNITY.rationale,
          body: `Switching ${POLYMER_OPPORTUNITY.from.grade} to ${POLYMER_OPPORTUNITY.to.grade} on `
            + `high-volume plastic parts unlocks `
            + `~$${(POLYMER_OPPORTUNITY.annualSavingUsd / 1000).toFixed(0)}K / year with no `
            + 'performance trade-off.',
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button size="sm" onClick={run} disabled={busy || !ids?.length} data-testid="export-pack">
        <Presentation className="mr-1.5 size-4" />
        {busy ? 'Building deck…' : 'Export report pack (PPT)'}
      </Button>
    </div>
  );
}
