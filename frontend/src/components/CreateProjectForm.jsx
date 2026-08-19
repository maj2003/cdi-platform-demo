// ---------------------------------------------------------------------------
// src/components/CreateProjectForm.jsx — "Create New Project" (a product).
//
// The first step of authoring a BOM in-app: register the competitor unit, then
// go straight to its (empty) teardown page to add modules and parts.
//
// A BOM cannot exist without a product to hang it on, so without this the
// workbench would still depend on the seed script or a CEDARS import to bring a
// product into existence — and "create an entire BOM from scratch inside the
// platform" would not be true.
//
// POST /api/products already existed and is unchanged; this is the UI that was
// missing. It returns 409 on a duplicate (brand, name), which is surfaced as-is
// rather than pre-empted: the natural key belongs to the server.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, X } from 'lucide-react';

import api from '@/lib/api';
import { useApiAction } from '@/lib/useApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const BLANK = {
  brand: '',
  name: '',
  category: 'Residential Air Handling Unit',
  notes: '',
};

/**
 * @param {object} props
 * @param {(model: object) => void} [props.onCreated]  receives the created row
 * @param {boolean} [props.redirectToTeardown=true]  go to the new (empty) teardown
 *   afterwards. The New Project wizard turns this OFF: there, the next step is the
 *   module list one section down, and navigating away would abandon the flow the
 *   wizard exists to hold together. Default stays true so nothing else changes.
 */
export default function CreateProjectForm({ onCreated, redirectToTeardown = true }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(BLANK);

  const create = useApiAction((body) => api.products.create(body));
  const set = (key) => (e) => setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const canSubmit =
    values.brand.trim() && values.name.trim() && values.category.trim() && !create.loading;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      const product = await create.run({
        brand: values.brand.trim(),
        name: values.name.trim(),
        category: values.category.trim(),
        notes: values.notes.trim() || null,
      });
      onCreated?.(product);
      // Straight to the empty teardown, which is where Add Module lives — the
      // next thing you have to do, without making anyone go and find it.
      if (redirectToTeardown) navigate(`/products/${product.id}`);
      else setOpen(false);
    } catch {
      // create.error renders below.
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        onClick={() => {
          setValues(BLANK);
          create.reset();
          setOpen(true);
        }}
      >
        <FolderPlus className="mr-1 size-4" />
        Create project
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="py-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">New benchmark project</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                create.reset();
              }}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-project-brand">Brand</Label>
              <Input
                id="new-project-brand"
                value={values.brand}
                onChange={set('brand')}
                placeholder="e.g. Goodman"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-project-name">Model / name</Label>
              <Input
                id="new-project-name"
                value={values.name}
                onChange={set('name')}
                placeholder="e.g. AMST48CU300"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-project-category">Category</Label>
              <Input
                id="new-project-category"
                value={values.category}
                onChange={set('category')}
                placeholder="e.g. Residential Air Handling Unit"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-project-notes">Notes (optional)</Label>
            <Textarea
              id="new-project-notes"
              value={values.notes}
              onChange={set('notes')}
              placeholder="Capacity, headline features, teardown date…"
              rows={2}
            />
          </div>

          {create.error && (
            <Alert variant="destructive">
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {create.loading ? 'Creating…' : 'Create and open'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Opens the new teardown so you can add modules and parts straight away.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
