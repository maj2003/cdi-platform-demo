// ---------------------------------------------------------------------------
// src/lib/projectSession.js — the New Project wizard's state.
//
// A benchmarking project is a category plus the competitor products being compared
// under it. This holds that, in the browser.
//
// ---------------------------------------------------------------------------
// WHY THERE IS NO Project TABLE
//
// An explicit decision, not an omission. The wizard's job is to demonstrate the
// workflow, and everything it produces is already real: the products it adds are
// rows in Product, the modules are rows in SubAssembly, the parts and measurements
// go through the same endpoints the capture station uses. The ONLY thing that is
// client-side is the GROUPING — "these five products are one evaluation".
//
// Adding a Project model to hold that grouping would mean a migration, a
// repository, a service, routes, and a nullable projectId on Product (nullable, or
// the five seeded teardowns stop loading). That is a lot of schema to carry before
// anyone has agreed what a project is, and it is the kind of expansion this effort
// was explicitly told to stop doing. The honest trade is stated plainly in the UI:
// a project lives in this browser.
//
// The consequence to be honest about: clearing site data loses the grouping, and it
// does not follow you to another machine or another person. The products and BOMs
// survive all of that, because those are server-side. So the thing you lose is a
// list of ids — recoverable in under a minute by re-picking them.
//
// ---------------------------------------------------------------------------
// WHY localStorage AND NOT THE URL
//
// The capture station's display options made the opposite choice for the opposite
// reason (see useCaptureOptions.js). A project is a work-in-progress you come back
// to, not something you send someone: putting five product ids and a category in
// the query string would make every wizard link a different URL and turn the Back
// button into a step-by-step undo of the whole flow. The one thing worth sharing
// from here is a PRODUCT, and those already have their own URLs.
// ---------------------------------------------------------------------------

import { useCallback, useState } from 'react';

const STORAGE_KEY = 'daikin.project.session';

/**
 * `openModelId` and `openModuleKey` are the WIZARD'S PLACE, not just cosmetics.
 *
 * Creating a part leaves this page for the capture station and comes back. Without
 * remembering which model and which module were open, "return to the module view"
 * would land on a collapsed step 4 and the engineer would have to find their way
 * back down three levels to see the part they just made. They live alongside the
 * project rather than in component state precisely because they have to survive a
 * navigation away and back.
 *
 * @returns {{name: string, categoryKey: string|null, productIds: number[],
 *   createdAt: string|null, openModelId: number|null, openModuleKey: string|null}}
 */
function blank() {
  return {
    name: '',
    categoryKey: null,
    productIds: [],
    createdAt: null,
    openModelId: null,
    openModuleKey: null,
  };
}

/** Read once, tolerating anything — a corrupt value must not break the wizard. */
function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank();
    const p = JSON.parse(raw);
    return {
      name: typeof p?.name === 'string' ? p.name : '',
      categoryKey: typeof p?.categoryKey === 'string' ? p.categoryKey : null,
      // Coerced and filtered: an id that came back as a string would silently fail
      // every `===` comparison against a product id from the API.
      productIds: Array.isArray(p?.productIds)
        ? [...new Set(p.productIds.map(Number).filter(Number.isInteger))]
        : [],
      createdAt: typeof p?.createdAt === 'string' ? p.createdAt : null,
      openModelId: Number.isInteger(Number(p?.openModelId)) && p?.openModelId !== null
        ? Number(p.openModelId)
        : null,
      openModuleKey: typeof p?.openModuleKey === 'string' ? p.openModuleKey : null,
    };
  } catch {
    return blank();
  }
}

function write(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage full. The wizard still works for this session;
    // failing to persist is not worth blocking the flow over.
  }
}

/**
 * The wizard's state and the actions that advance it.
 *
 * Steps are DERIVED from the state rather than tracked as a counter. A counter can
 * disagree with the data behind it — "step 3" with no category selected — and the
 * whole point of a progressive flow is that a step is available exactly when its
 * prerequisite is satisfied.
 */
export function useProjectSession() {
  const [project, setProject] = useState(read);

  const update = useCallback((patch) => {
    setProject((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      write(next);
      return next;
    });
  }, []);

  const start = useCallback(
    (name) =>
      update({
        name: String(name ?? '').trim(),
        // Stamped at creation so the wizard can say when the project was started.
        // Date.now() is fine here — this is a browser, not a workflow script.
        createdAt: new Date().toISOString(),
      }),
    [update],
  );

  const setCategory = useCallback(
    (categoryKey) =>
      update((prev) =>
        // Changing category clears the model list. Keeping it would leave a
        // Gas Furnaces project holding air handlers, and silently mixing
        // categories is precisely what makes a competitive set meaningless.
        prev.categoryKey === categoryKey
          ? prev
          : { ...prev, categoryKey, productIds: [], openModelId: null, openModuleKey: null },
      ),
    [update],
  );

  const toggleModel = useCallback(
    (id) =>
      update((prev) => {
        const n = Number(id);
        const removing = prev.productIds.includes(n);
        return {
          ...prev,
          productIds: removing
            ? prev.productIds.filter((x) => x !== n)
            : [...prev.productIds, n],
          // Dropping the model that is currently open must close it, or step 4
          // would keep rendering modules for something no longer in the project.
          openModelId: removing && prev.openModelId === n ? null : prev.openModelId,
          openModuleKey: removing && prev.openModelId === n ? null : prev.openModuleKey,
        };
      }),
    [update],
  );

  /**
   * Add a model and open it in one step.
   *
   * Used by the importer: a model that has just been created by importing its BOM
   * should be in the project and highlighted, because otherwise the import appears
   * to have done nothing — the review's point that "the user should immediately
   * understand that the import created the model".
   */
  const addModel = useCallback(
    (id, { open = false } = {}) =>
      update((prev) => {
        const n = Number(id);
        return {
          ...prev,
          productIds: prev.productIds.includes(n) ? prev.productIds : [...prev.productIds, n],
          openModelId: open ? n : prev.openModelId,
          openModuleKey: open ? null : prev.openModuleKey,
        };
      }),
    [update],
  );

  /** Open a model's module list, or collapse it. One at a time. */
  const openModel = useCallback(
    (id) =>
      update((prev) => ({
        ...prev,
        openModelId: prev.openModelId === Number(id) ? null : Number(id),
        // Switching model closes whichever module was open under the old one —
        // a module key means nothing outside the model it was opened in.
        openModuleKey: null,
      })),
    [update],
  );

  /** Open one module's part list, or collapse it. One at a time. */
  const openModule = useCallback(
    (key) =>
      update((prev) => ({
        ...prev,
        openModuleKey: prev.openModuleKey === key ? null : key,
      })),
    [update],
  );

  const reset = useCallback(() => {
    const fresh = blank();
    write(fresh);
    setProject(fresh);
  }, []);

  return {
    project,
    started: Boolean(project.createdAt),
    hasCategory: Boolean(project.categoryKey),
    hasModels: project.productIds.length > 0,
    start,
    setCategory,
    toggleModel,
    addModel,
    openModel,
    openModule,
    reset,
  };
}
