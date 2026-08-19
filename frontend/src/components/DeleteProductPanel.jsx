// ---------------------------------------------------------------------------
// src/components/DeleteProductPanel.jsx
//
// Confirming the removal of a whole product — and showing what that costs before
// it happens.
//
// ---------------------------------------------------------------------------
// WHY AN INLINE PANEL RATHER THAN window.confirm
//
// The rest of the app confirms deletions with a browser dialog, and for one part or
// one empty module that is proportionate. A product is not: the imported Bosch
// teardown is 124 parts, 8 modules and 84 cost rows, and every one of them goes.
// A browser dialog cannot show those numbers, so it asks the same question with the
// same weight whether you are discarding one row or four hundred.
//
// It also cannot say whether the deletion is REVERSIBLE, which here depends entirely
// on provenance:
//
//   seeded   -> `npm run seed` puts it back, identically (it upserts on brand+name)
//   imported -> gone unless you still have the workbook
//   in-app   -> gone; it was typed in by hand
//
// Telling someone "this cannot be undone" when in fact one command restores it is
// as unhelpful as the reverse. So the panel states the actual position.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

import api from '@/lib/api';
import * as photoStore from '@/lib/photoStore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';

/** What `npm run seed` can and cannot bring back. */
const RECOVERABILITY = Object.freeze({
  seed: {
    tone: 'default',
    text: 'This is seeded demo data — running `npm run seed` in backend/ recreates it exactly.',
  },
  import: {
    tone: 'destructive',
    text: 'This was imported from a workbook. Deleting it is permanent unless you still have that file.',
  },
  manual: {
    tone: 'destructive',
    text: 'This was built by hand in the app. Deleting it is permanent — there is no file to re-import.',
  },
});

/**
 * Count exactly what the cascade will take, from the teardown already on screen.
 *
 * Computed from the tree rather than asked of the server: the caller is a page that
 * has the teardown loaded, and a second round trip to count rows the user is
 * looking at would be wasted. `costRecords` counts cost ROWS, which is not the same
 * as the part count — an uncosted part has none, and the imported BOMs have dozens.
 */
function countCascade(teardown) {
  const parts = (teardown?.subAssemblies ?? []).flatMap((s) => s.parts ?? []);
  return {
    modules: teardown?.subAssemblies?.length ?? 0,
    parts: parts.length,
    costRecords: parts.reduce((n, p) => n + (p.costs?.length ?? 0), 0),
    measurements: parts.reduce((n, p) => n + (p.measurements?.length ?? 0), 0),
    partIds: parts.map((p) => p.id),
  };
}

/**
 * @param {object}   props
 * @param {object}   props.product   needs id, brand, name, source
 * @param {object}   [props.teardown]  the loaded tree, for exact counts
 * @param {Function} props.onCancel
 * @param {Function} props.onDeleted  called after a successful delete
 */
export default function DeleteProductPanel({ product, teardown, onCancel, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const counts = countCascade(teardown);
  const recovery = RECOVERABILITY[product?.source] ?? RECOVERABILITY.manual;

  const onConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.products.remove(product.id);

      // The server cascade cannot reach browser-local photos — they're keyed by
      // part id in IndexedDB. Done AFTER the delete succeeds, and failing to purge
      // them is not allowed to fail the deletion: the product is already gone by
      // then, so reporting an error would be reporting the wrong thing. PUI view
      // slots are deliberately left alone (see photoStore.removeByParts).
      try {
        await photoStore.removeByParts(counts.partIds);
      } catch {
        /* orphaned photos are housekeeping, not correctness — see above */
      }

      onDeleted?.(product);
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  return (
    <Alert variant="destructive" className="text-left">
      <AlertTriangle className="size-4" />
      <AlertTitle>
        Delete {product.brand} {product.name}?
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm">This permanently removes:</p>
          <ul className="list-disc pl-4 text-sm tabular-nums">
            <li>
              {formatCount(counts.modules)} {counts.modules === 1 ? 'module' : 'modules'}
            </li>
            <li>
              {formatCount(counts.parts)} {counts.parts === 1 ? 'part' : 'parts'}
            </li>
            <li>
              {formatCount(counts.costRecords)} cost{' '}
              {counts.costRecords === 1 ? 'record' : 'records'}
            </li>
            <li>
              {formatCount(counts.measurements)}{' '}
              {counts.measurements === 1 ? 'measurement' : 'measurements'} captured
            </li>
            <li>any cached persona reports, and photos stored in this browser</li>
          </ul>
        </div>

        <p className="text-sm font-medium">{recovery.text}</p>

        {error && <p className="text-sm font-medium">Could not delete: {error}</p>}

        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={deleting}>
            <Trash2 className="mr-1.5 size-4" />
            {deleting ? 'Deleting…' : 'Delete product'}
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
