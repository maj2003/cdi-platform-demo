// ---------------------------------------------------------------------------
// src/components/capture/BomStructureTree.jsx
//
// The level-wise BOM tree along the bottom of the capture workstation, as the
// reference dashboards show it — and, more importantly, as the way to MOVE around
// a teardown while capturing.
//
// ---------------------------------------------------------------------------
// WHY A TREE AND NOT THE "JUMP TO PART" DROPDOWN IT REPLACES
//
// The existing Capture page navigates with a native <select> of every part. That
// is fine for the seeded products at 16-25 parts and useless at 124: a flat list
// of "Cabinet Assm — 18 — WRAPPER, AIR HANDLER" strings, scrolled blind, with no
// sense of where you are in the unit. A teardown is physically hierarchical — a
// module comes off, then its parts come out of it — so the navigator should be
// too. Modules collapse, the current part stays highlighted and scrolled into
// view, and each row carries the figures that tell you whether it has been
// captured yet.
//
// It is a NAVIGATOR, not an editor. Clicking a row moves the workstation to that
// part; nothing here writes.
// ---------------------------------------------------------------------------

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Circle, CircleCheck, CircleDot } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatGrams } from '@/lib/format';

/**
 * How completely a part has been captured — the only judgement this tree makes.
 *
 * Deliberately three states rather than a percentage: "63% captured" invites the
 * question "which 63%", and the answer an engineer wants at a glance is just
 * whether they still need to pick this part up.
 */
function captureState(part) {
  const dims = [part.lengthMm, part.widthMm, part.heightMm, part.thicknessMm, part.diameterOuterMm];
  const anyDim = dims.some((v) => v !== null && v !== undefined);
  const hasWeight = part.weightG !== null && part.weightG !== undefined;
  if (anyDim && hasWeight) return 'done';
  if (anyDim || hasWeight || part.photoId) return 'partial';
  return 'empty';
}

const STATE_ICON = {
  done: CircleCheck,
  partial: CircleDot,
  empty: Circle,
};

const STATE_TITLE = {
  done: 'Dimensions and weight captured',
  partial: 'Partly captured',
  empty: 'Nothing captured yet',
};

/**
 * @param {object}   props
 * @param {object}   props.teardown
 * @param {number}   props.currentPartId
 * @param {Function} props.onSelectPart      (partId) => void
 * @param {Map|null} [props.costingByPart]   per-part figures from the cost report
 * @param {string}   [props.currency]
 */
export default function BomStructureTree({
  teardown,
  currentPartId,
  onSelectPart,
  costingByPart,
  currency = 'USD',
}) {
  // Memoised because the ?? [] fallback would otherwise be a fresh array on every
  // render, invalidating the currentModuleId memo below on every render with it.
  const modules = useMemo(() => teardown?.subAssemblies ?? [], [teardown]);

  // Open the module containing the current part; leave the rest closed. With
  // eight modules and 124 parts, everything open is a wall of rows.
  const currentModuleId = useMemo(
    () => modules.find((m) => (m.parts ?? []).some((p) => p.id === currentPartId))?.id ?? null,
    [modules, currentPartId],
  );

  const [openIds, setOpenIds] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(false);

  // The module holding the current part is ALWAYS treated as open, rather than
  // being pushed into state by an effect. Walking to the next part crosses a
  // module boundary every few parts, and a setState-in-effect there would fight
  // the user's own collapsing (and is what React's compiler lint rejects).
  const isOpen = (moduleId) => moduleId === currentModuleId || openIds.has(moduleId);

  const toggle = (moduleId) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

  // Keep the current row visible as the operator walks the teardown — otherwise
  // the highlight scrolls out of the strip after a handful of parts.
  //
  // Scrolled BY HAND inside this tree's own container, not with scrollIntoView.
  // scrollIntoView walks every scrollable ancestor including the document, so
  // whenever this tree remounted it yanked the whole window down to itself — which
  // is what made selecting a geometry or entering a dimension "jump to the bottom
  // of the page". Setting scrollTop on the one container that should move cannot
  // affect the page at all.
  const rowRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => {
    const row = rowRef.current;
    const box = scrollRef.current;
    if (!row || !box) return;

    const rowTop = row.offsetTop - box.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < box.scrollTop) box.scrollTop = rowTop;
    else if (rowBottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = rowBottom - box.clientHeight;
    }
  }, [currentPartId]);

  const totalParts = modules.reduce((n, m) => n + (m.parts?.length ?? 0), 0);
  const capturedParts = modules.reduce(
    (n, m) => n + (m.parts ?? []).filter((p) => captureState(p) === 'done').length,
    0,
  );

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            BOM Structure
          </h2>
          <Badge variant="outline" className="font-normal tabular-nums">
            {capturedParts} of {totalParts} captured
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Click any part to capture it</p>
      </div>

      {!collapsed && (
        // Bounded height with its own scroll: the tree is a persistent navigator
        // along the bottom, so it must never push the three capture panes off
        // screen however many parts a teardown has.
        <div ref={scrollRef} className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-xs text-muted-foreground">
                <th className="w-8" />
                <th className="px-2 py-1.5 text-left font-medium">Component / Part</th>
                <th className="px-2 py-1.5 text-right font-medium">Level</th>
                <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                <th className="px-2 py-1.5 text-left font-medium">Material</th>
                <th className="px-2 py-1.5 text-right font-medium">Weight</th>
                <th className="px-2 py-1.5 text-right font-medium">Cost</th>
                <th className="px-2 py-1.5 text-left font-medium">Photo ID</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => {
                const parts = module.parts ?? [];
                const open = isOpen(module.id);
                return (
                  <Fragment key={module.id}>
                    <tr
                      className="cursor-pointer border-b bg-muted/40 hover:bg-muted/60"
                      onClick={() => toggle(module.id)}
                    >
                      <td className="pl-2">
                        {open ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-medium">{module.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">1</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {parts.length}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">—</td>
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5" />
                    </tr>

                    {open &&
                      parts.map((part) => {
                        const isCurrent = part.id === currentPartId;
                        const state = captureState(part);
                        const Icon = STATE_ICON[state];
                        const costing = costingByPart?.get(part.id);
                        return (
                          <tr
                            key={part.id}
                            ref={isCurrent ? rowRef : undefined}
                            onClick={() => onSelectPart(part.id)}
                            className={`cursor-pointer border-b ${
                              isCurrent ? 'bg-accent/20 font-medium' : 'hover:bg-accent/10'
                            }`}
                          >
                            <td className="pl-2">
                              <Icon
                                className={`size-3.5 ${
                                  state === 'done'
                                    ? 'text-accent-foreground'
                                    : 'text-muted-foreground'
                                }`}
                                title={STATE_TITLE[state]}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="pl-4">{part.name}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {part.assemblyLevel ?? 2}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{part.quantity}</td>
                            <td className="max-w-40 truncate px-2 py-1.5 text-muted-foreground">
                              {part.material ?? '—'}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                              {formatGrams(part.weightG)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                              {/* From the cost report, never recomputed here — the
                                  same rule the rest of the app follows. */}
                              {costing?.costed
                                ? formatCurrency(costing.extendedCost, currency)
                                : '—'}
                            </td>
                            <td className="px-2 py-1.5">
                              {part.photoId ? (
                                <Badge variant="secondary" className="font-mono text-[11px]">
                                  {part.photoId}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
