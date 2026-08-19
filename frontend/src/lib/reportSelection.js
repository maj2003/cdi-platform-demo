// ---------------------------------------------------------------------------
// src/lib/reportSelection.js
//
// Which designs a report is about.
//
// Every report in this section compares the same set, so the set is chosen once and
// read from the URL (`?ids=14,15,17`) exactly the way /compare and /best-of-best
// already do. That means a report link carries its own comparison — the thing an
// executive actually forwards — and switching between the four report tabs keeps the
// selection instead of silently re-picking a default on each one.
//
// Defaults to the first MAX products by id when no ids are given, which is the same
// convention the Competitive Intelligence overview uses for its headline figures, so
// a freshly-opened report and the overview above it describe the same set.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The backend caps comparison at five; mirror it rather than discovering it in a 400. */
export const MAX_DESIGNS = 5;

/**
 * @param {Array<{id: number}>|null} products  the repository list, once loaded
 * @returns {{ids: number[], selected: object[], setIds: (ids: number[]) => void, isDefault: boolean}}
 */
export function useReportSelection(products) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('ids');

  const ids = useMemo(() => {
    const list = (products ?? []).map((p) => p.id);
    if (!raw) return list.slice(0, MAX_DESIGNS);
    const wanted = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    // Filtered against what exists: a stale link naming a deleted product should
    // narrow the set, not produce a 404 report or a column of dashes.
    const known = wanted.filter((id) => list.includes(id));
    return (known.length ? known : list).slice(0, MAX_DESIGNS);
  }, [raw, products]);

  const selected = useMemo(
    () => ids.map((id) => (products ?? []).find((p) => p.id === id)).filter(Boolean),
    [ids, products],
  );

  const setIds = (next) => {
    const p = new URLSearchParams(params);
    if (next?.length) p.set('ids', next.join(','));
    else p.delete('ids');
    // `replace`, so flipping designs on and off does not fill the Back button with
    // every intermediate selection.
    setParams(p, { replace: true });
  };

  return { ids, selected, setIds, isDefault: !raw };
}

/** "Goodman AMST48CU300" — the column heading for a design. */
export function designLabel(product) {
  if (!product) return '—';
  return `${product.brand} ${product.name}`;
}
