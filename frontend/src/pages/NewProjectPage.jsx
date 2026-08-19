// ---------------------------------------------------------------------------
// src/pages/NewProjectPage.jsx — route /new-project
//
// The guided teardown workflow, one level at a time:
//
//     Category  ->  Model  ->  Module  ->  Part
//
//   1. New Project   name it
//   2. Category      AHU, Air Conditioners, Heat Pumps, …
//   3. Add Model     create one, import its BOM, or pick one already torn down
//   4. Modules       the 17 standard HVAC modules per model, with their parts
//
// ---------------------------------------------------------------------------
// THE VOCABULARY IS MODEL, NOT PRODUCT
//
// A teardown compares MODELS — FJ5ANXC48L against 5TEMCB02 — inside one product
// category. "Product" is the right word for the category level and the wrong one
// for the thing on the bench, and using it for both made the hierarchy read as two
// levels of the same noun. The table is still Product and the routes are still
// /products/:id; the translation is here, in the UI, the same way "module" has
// always been the teardown's word for a SubAssembly row.
//
// ---------------------------------------------------------------------------
// NOTHING IS OPEN THAT DOES NOT NEED TO BE
//
// The review's complaint was that too much was visible at once. So each level
// reveals only the next: future steps are faded, one model's modules open at a
// time, one module's parts open at a time. Everything else stays collapsed until
// it is selected.
//
// ---------------------------------------------------------------------------
// WHY IT REPLACED THE OLD STEP LIST
//
// This page used to be a static map of eight steps, each with a status badge and a
// link to wherever the real work happened. That was honest but inert: it described
// the workflow instead of being it, and every step still required the reader to
// know which model they were working on and what a module was.
//
// The links-out-to-real-pages principle is KEPT, and it is the reason this page is
// not a reimplementation of anything. Import still opens the real importer, part
// capture still opens the real capture station, and a new competitor is still
// created through the real POST /api/products. The wizard adds sequence and
// context, not a parallel set of features.
//
// ---------------------------------------------------------------------------
// WHY FUTURE STEPS ARE FADED AND NOT HIDDEN
//
// The brief asked for faded. It is also the right call: a step that appears out of
// nowhere gives no sense of how much is left, and someone being walked through this
// in a demo needs to see the shape of the whole flow on the first screen. Faded
// steps are dimmed AND inert — `aria-disabled` plus no controls rendered — so the
// affordance matches the state rather than dimming something still clickable.
//
// ---------------------------------------------------------------------------
// WHERE THE PROJECT LIVES
//
// In localStorage, not the database — an explicit decision, reasoned through in
// lib/projectSession.js. Everything the wizard PRODUCES is real server data; only
// the grouping of models into one evaluation is client-side. The page says
// so, once, rather than implying a persistence it does not have.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Info,
  Layers,
  ListTree,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import AhuSilhouette from '@/components/AhuSilhouette';
import CreateProjectForm from '@/components/CreateProjectForm';
import ImportBomPanel from '@/components/ImportBomPanel';
import ModuleList from '@/components/project/ModuleList';
import api from '@/lib/api';
import { categoryByKey, PRODUCT_CATEGORIES, productInCategory } from '@/lib/hvacModules';
import { useProjectSession } from '@/lib/projectSession';
import { useApi } from '@/lib/useApi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * One numbered step.
 *
 * `state` is 'done' | 'active' | 'future'. Future steps get 60% opacity and
 * `aria-disabled`, and render no children — see the header comment on why they are
 * faded rather than hidden, and why inert matters as much as dim.
 */
function Step({ n, title, blurb, state, children }) {
  const future = state === 'future';
  return (
    <section
      aria-disabled={future || undefined}
      className={`rounded-xl border bg-card p-5 transition-opacity ${
        future ? 'pointer-events-none opacity-55' : ''
      } ${state === 'active' ? 'border-accent shadow-sm' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            state === 'done'
              ? 'bg-accent/25 text-accent-foreground'
              : state === 'active'
                ? 'bg-primary text-primary-foreground'
                : 'border bg-muted text-muted-foreground'
          }`}
        >
          {state === 'done' ? <Check className="size-4" /> : n}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </div>
      </div>
      {!future && children && <div className="mt-4 pl-10">{children}</div>}
    </section>
  );
}

/**
 * A model card: schematic, brand, model number, description.
 *
 * `justImported` marks a model this session's import created. Without it, an import
 * that worked looks like nothing happened — the workbook is gone from the screen and
 * a new card has quietly appeared among four others. Saying so on the card is the
 * cheapest way to make the cause visible, and it fades from relevance on its own
 * because it only lasts as long as the page is open.
 */
function ModelCard({ model, selected, justImported, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(model.id)}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent/10' : 'hover:border-accent'
      } ${justImported ? 'ring-2 ring-accent/50' : ''}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {model.brand}
          </span>
          <span className="block truncate text-sm font-semibold">{model.name}</span>
        </span>
        <span
          aria-hidden
          className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
            selected ? 'border-accent bg-accent/30' : 'border-dashed'
          }`}
        >
          {selected ? <Check className="size-3" /> : ''}
        </span>
      </span>

      <span className="flex h-24 items-center justify-center rounded-md border bg-muted/40">
        <AhuSilhouette className="h-full w-auto py-2 text-muted-foreground/50" />
      </span>

      <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {model.notes?.trim() || model.category}
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        {justImported && (
          <Badge className="text-[10px] font-normal">
            <Sparkles className="mr-1 size-2.5" />
            Created by import
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] font-normal">
          {model.subAssemblyCount ?? 0} modules
        </Badge>
        {/* Provenance, same vocabulary as the catalog: an illustrative figure and a
            real imported one must never look identical. */}
        <Badge
          variant={model.source === 'import' ? 'default' : 'secondary'}
          className="text-[10px] font-normal capitalize"
        >
          {model.source ?? 'manual'}
        </Badge>
      </span>
    </button>
  );
}

export default function NewProjectPage() {
  const {
    project, started, hasCategory, hasModels,
    start, setCategory, toggleModel, addModel, openModel, openModule, reset,
  } = useProjectSession();

  const [nameDraft, setNameDraft] = useState('');
  const [importing, setImporting] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  /** Models this session's import created, so the cards can say so. */
  const [importedIds, setImportedIds] = useState([]);

  // Which model's modules are open. Read from the SESSION, not local state: Create
  // Part leaves for the capture station and comes back, and local state would not
  // survive that — the engineer would return to a collapsed step 4.
  const openModelId = project.openModelId;

  const { data: products, loading, refetch } = useApi(
    ({ signal }) => api.products.list({ signal }),
    [],
    { keepPreviousData: true },
  );

  const category = categoryByKey(project.categoryKey);
  const inCategory = useMemo(
    () => (products ?? []).filter((p) => productInCategory(p, category)),
    [products, category],
  );
  const chosen = useMemo(
    () => (products ?? []).filter((p) => project.productIds.includes(p.id)),
    [products, project.productIds],
  );

  // Loaded on demand for the ONE model whose modules are open, not for all five: a
  // teardown response carries every part of every module, so fetching five to
  // render one expanded list would be four wasted round trips of real weight.
  const { data: teardown, refetch: refetchTeardown } = useApi(
    ({ signal }) => api.products.teardown(openModelId, { signal }),
    [openModelId],
    { enabled: openModelId !== null, keepPreviousData: true },
  );

  // Both, after a write: the teardown feeds the module list, the product list feeds
  // the model cards' counts. Refetching one leaves the other stale.
  const refetchAll = async () => {
    await Promise.all([refetch(), refetchTeardown()]);
  };

  const stepState = (index) => {
    const reached = [true, started, hasCategory, hasModels][index];
    const nextReached = [started, hasCategory, hasModels, false][index];
    if (!reached) return 'future';
    return nextReached ? 'done' : 'active';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FolderPlus className="size-6 text-primary" />
            New Project
          </h1>
          <p className="text-sm text-muted-foreground">
            A benchmarking project: one product category, the competitors in it, and a BOM
            for each.
          </p>
        </div>
        {started && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="mr-1.5 size-4" />
            Start over
          </Button>
        )}
      </div>

      {/* ================= 1. NAME IT ================= */}
      <Step
        n={1}
        title="New Project"
        blurb="Name the evaluation. This is what the competitive set gets filed under."
        state={stepState(0)}
      >
        {started ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="text-sm">{project.name || 'Untitled project'}</Badge>
            <span className="text-xs text-muted-foreground">
              started {new Date(project.createdAt).toLocaleDateString()}
            </span>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); if (nameDraft.trim()) start(nameDraft); }}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">Project name</Label>
              <Input
                id="proj-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="FY27 Residential AHU benchmark"
                className="w-72"
              />
            </div>
            <Button type="submit" disabled={!nameDraft.trim()}>Create project</Button>
          </form>
        )}
      </Step>

      {/* ================= 2. CATEGORY ================= */}
      <Step
        n={2}
        title="Category"
        blurb="What kind of unit. Every model, module and part below is scoped to this."
        state={stepState(1)}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_CATEGORIES.map((c) => {
            const active = project.categoryKey === c.key;
            const available = (products ?? []).filter((p) => productInCategory(p, c)).length;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                aria-pressed={active}
                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                  active ? 'border-accent bg-accent/15' : 'hover:border-accent'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Building2 aria-hidden className="size-4 text-muted-foreground" />
                    {c.name}
                  </span>
                  {/* The demo's primary path, flagged from the data rather than by
                      position, so reordering the list cannot lose it. */}
                  {c.primary && (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      <Sparkles className="mr-1 size-2.5" />
                      Primary
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{c.blurb}</span>
                <span className="text-[11px] text-muted-foreground">
                  {available} in the repository
                </span>
              </button>
            );
          })}
        </div>
        {hasCategory && (
          <p className="mt-3 text-xs text-muted-foreground">
            Changing the category clears the model list — a set mixing air handlers and
            furnaces would not be comparable.
          </p>
        )}
      </Step>

      {/* ================= 3. MODELS =================
          Actions FIRST, cards second. The review asked for this order explicitly,
          and it is the right way round: on a category with nothing torn down yet,
          a grid of cards is empty and the only useful controls were below it. */}
      <Step
        n={3}
        title="Add Model"
        blurb={`The competitive set${category ? ` — ${category.fullName}` : ''}. Create a model, import its BOM, or pick one already torn down.`}
        state={stepState(2)}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={addingModel ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAddingModel((v) => !v)}
            >
              <Plus className="mr-1.5 size-4" />
              {addingModel ? 'Cancel' : 'Add New Model'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <ListTree className="mr-1.5 size-4" />
              Import BOM
            </Button>
          </div>

          {/* What Import BOM actually does, stated where the button is. It reads as
              a file-upload utility otherwise, when it is in fact the fastest way to
              create a model — the workbook brings the modules and the parts with
              it. */}
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Import BOM</strong> creates the model from a
            workbook, then loads the modules and parts it describes. Add New Model registers an
            empty one to capture by hand.
          </p>

          {/* The existing form. A new competitor is a real POST /api/products, so
              the fifth demo model is genuine data. `redirectToTeardown={false}`
              keeps the engineer here — the next step is the module list one section
              down, and navigating to the teardown would abandon the wizard. */}
          {addingModel && (
            <CreateProjectForm
              redirectToTeardown={false}
              onCreated={async (created) => {
                setAddingModel(false);
                await refetch();
                // Added AND opened, so a model you just registered is the one the
                // module list is showing rather than something to hunt for.
                if (created?.id) addModel(created.id, { open: true });
              }}
            />
          )}

          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Existing models
            </p>
            {loading && !products ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}
              </div>
            ) : inCategory.length === 0 ? (
              <Alert>
                <Info className="size-4" />
                <AlertTitle className="text-sm">
                  No {category?.fullName} in the repository yet
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Use Add New Model or Import BOM above — AHU is the category with teardown
                  data in this build.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {inCategory.map((p) => (
                  <ModelCard
                    key={p.id}
                    model={p}
                    selected={project.productIds.includes(p.id)}
                    justImported={importedIds.includes(p.id)}
                    onToggle={toggleModel}
                  />
                ))}
              </div>
            )}
            {hasModels && (
              <p className="text-xs text-muted-foreground">
                {project.productIds.length} model{project.productIds.length === 1 ? '' : 's'} in
                this project.
              </p>
            )}
          </div>
        </div>
      </Step>

      {/* ================= 4. MODULES AND PARTS =================
          COLLAPSED until a model is chosen, then one model open at a time, then one
          module open at a time. The review's complaint was that too much was
          visible at once; the fix is that each level of Category → Model → Module →
          Part reveals only the next one. */}
      <Step
        n={4}
        title="Modules and parts"
        blurb="The 17 standard HVAC modules, loaded automatically for every model. Open one to see its parts and add another."
        state={stepState(3)}
      >
        <div className="space-y-2">
          {chosen.map((p) => {
            const open = openModelId === p.id;
            return (
              <Card key={p.id} className={open ? 'border-accent' : ''}>
                <CardContent className="space-y-3 py-4">
                  {/* Header row: the toggle takes the whole width so opening a model
                      is one obvious click, and the teardown link sits OUTSIDE it —
                      an anchor nested inside a button is invalid HTML and the browser
                      resolves it in ways neither control expects. */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openModel(p.id)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      {open ? (
                        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{p.brand} {p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.subAssemblyCount ?? 0} module
                          {(p.subAssemblyCount ?? 0) === 1 ? '' : 's'} with parts
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Layers aria-hidden className="size-4" />
                        {open ? 'Hide modules' : 'Modules'}
                      </span>
                    </button>
                    {/* Kept from before the refinement: the full teardown page is the
                        way to costs, reports and export, and the wizard should not be
                        a dead end. */}
                    <Button asChild size="sm" variant="ghost" className="shrink-0">
                      <Link to={`/products/${p.id}`}>Teardown</Link>
                    </Button>
                  </div>

                  {open && (
                    // The teardown response puts the product's own fields at the
                    // TOP level (id, name, brand, …, subAssemblies) — there is no
                    // nested `product`. Checked against teardown.id, because
                    // keepPreviousData means the previous model's tree is still in
                    // hand while a newly-expanded one loads, and rendering
                    // Goodman's modules under Trane's heading would be worse than
                    // a skeleton.
                    teardown && teardown.id === p.id ? (
                      <ModuleList
                        model={p}
                        subAssemblies={teardown.subAssemblies}
                        openModuleKey={project.openModuleKey}
                        onOpenModule={openModule}
                        onChanged={refetchAll}
                      />
                    ) : (
                      <Skeleton className="h-64" />
                    )
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Step>

      {hasModels && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-4">
          <p className="flex-1 text-sm">
            <strong>Next:</strong> once the BOMs are in, compare the models.
          </p>
          <Button asChild size="sm">
            <Link to={`/compare?ids=${project.productIds.join(',')}`}>Compare this set</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to={`/best-of-best?ids=${project.productIds.join(',')}`}>Best-of-Best</Link>
          </Button>
        </div>
      )}

      {/* Stated once, plainly. See lib/projectSession.js for the full reasoning. */}
      <p className="text-xs text-muted-foreground">
        The project — its name, category and product list — is held in this browser, not the
        database. The products, modules, parts and measurements it creates are all real server
        data and survive independently.
      </p>

      {/* Import BOM is a MODEL-CREATION mechanism here, so what it creates has to
          land in the project: the models it made are added, the first is opened, and
          their cards say "Created by import". Otherwise the workbook disappears and
          a new card quietly appears among four others — the import looks like it did
          nothing, which was the review's complaint.

          The importer defers its refetch until the panel closes (see its own note),
          so this fires once, on close, with everything it created. */}
      {importing && (
        <ImportBomPanel
          navigateOnSingle={false}
          onClose={() => setImporting(false)}
          onImported={async (created = []) => {
            await refetch();
            const ids = created.map((m) => m?.id).filter(Boolean);
            setImportedIds(ids);
            ids.forEach((id, i) => addModel(id, { open: i === 0 }));
          }}
        />
      )}
    </div>
  );
}
