// ---------------------------------------------------------------------------
// src/lib/useApi.js — data fetching for components.
//
// Wraps the api client with the four things every page needs and everyone
// re-implements slightly differently: loading state, error state, cancellation
// on unmount, and protection against out-of-order responses.
//
// USAGE:
//   const { data: products, loading, error, refetch } = useApi(
//     ({ signal }) => api.products.list({ signal }),
//     [],
//   );
//
// ---------------------------------------------------------------------------
// ⚠ THE TWO RULES, because both fail in ways that look like something else:
//
// 1. Pass the signal through. Your fetcher receives `{ signal }` and must hand
//    it to the api client. Skip it and the request can't be cancelled — the
//    hook still discards the result, but the network call runs to completion
//    and a slow one can pile up on every keystroke.
//
// 2. `deps` must be PRIMITIVES — numbers, strings, booleans. An inline array or
//    object (`[[1,2,3]]`, `[{id}]`) gets a fresh identity every render, so the
//    effect re-runs forever: fetch, setState, re-render, fetch. The page looks
//    frozen and devtools shows an endless request stream. For a list of ids,
//    pass `ids.join(',')` and split it inside the fetcher.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async API call and track its lifecycle.
 *
 * @param {(ctx: {signal: AbortSignal}) => Promise<any>} fetcher
 * @param {Array<string|number|boolean|null|undefined>} deps  primitives only
 * @param {object}  [options]
 * @param {boolean} [options.enabled=true]           false = don't fetch yet
 * @param {any}     [options.initialData=null]
 * @param {boolean} [options.keepPreviousData=false] hold old data during refetch
 * @returns {{data: any, error: Error|null, loading: boolean, refetch: () => void}}
 */
export function useApi(fetcher, deps = [], options = {}) {
  const { enabled = true, initialData = null, keepPreviousData = false } = options;

  // Hold the fetcher in a ref and refresh it on every render.
  //
  // WHY: callers pass an inline arrow, which is a new function object each
  // render. If the effect depended on it, the effect would re-run every render
  // — an infinite fetch loop. The ref means the effect always calls the LATEST
  // fetcher (so it closes over fresh props) while re-running only when `deps`
  // actually change. This indirection is the whole trick of the hook.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [state, setState] = useState({
    data: initialData,
    error: null,
    loading: enabled,
  });

  // Bumping this re-runs the effect without changing deps — that's refetch().
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return undefined;
    }

    const controller = new AbortController();

    // Per-run flag. Each effect invocation closes over its own `cancelled`,
    // which its own cleanup sets. A superseded run therefore knows not to
    // write state even if its request already resolved — this is what stops an
    // older, slower response from overwriting a newer one when deps change
    // quickly (clicking through products fast, typing in a filter).
    //
    // The abort below handles the well-behaved case; this flag is the backstop
    // for a fetcher that ignores the signal, and for the gap between a promise
    // resolving and its .then running.
    let cancelled = false;

    setState((prev) => ({
      data: keepPreviousData ? prev.data : initialData,
      error: null,
      loading: true,
    }));

    (async () => {
      try {
        const result = await fetcherRef.current({ signal: controller.signal });
        if (cancelled) return;
        setState({ data: result, error: null, loading: false });
      } catch (err) {
        // -------------------------------------------------------------------
        // THE STRICTMODE CASE — the reason this branch is first.
        //
        // In development React 18+ mounts every component, unmounts it, and
        // mounts it again to surface missing cleanup. So the first effect run
        // is torn down immediately, its controller aborts, and its request
        // rejects with an AbortError — every single time, for every fetch on
        // the page, in dev only.
        //
        // That is correct behaviour, not a failure. Swallow it silently:
        // rendering it would put an error banner under every panel in dev and
        // nowhere in production, which is a maddening thing to chase.
        //
        // The same branch covers unmount-mid-request (navigating away), where
        // setting state would warn about updating an unmounted component.
        // -------------------------------------------------------------------
        if (cancelled || err.name === 'AbortError') return;

        setState((prev) => ({
          data: keepPreviousData ? prev.data : initialData,
          error: err,
          loading: false,
        }));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // deps is spread so callers control re-fetching. Its LENGTH must be stable
    // across renders — React requires that of every dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, reloadToken]);

  /** Re-run the fetch, e.g. after a mutation or from a Retry button. */
  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { ...state, refetch };
}

/**
 * The companion for writes — POST/PATCH/DELETE, triggered by a click rather
 * than by rendering.
 *
 * Separate from useApi on purpose: useApi fires when its deps change, which is
 * exactly wrong for "Run benchmarking" or "Delete product". Those must fire
 * when the user says so, and never on mount.
 *
 * USAGE:
 *   const generate = useApiAction((id) => api.reports.generateAll(id));
 *   <Button disabled={generate.loading} onClick={() => generate.run(productId)}>
 *     {generate.loading ? 'Running…' : 'Run benchmarking'}
 *   </Button>
 *   {generate.error && <Alert>{generate.error.message}</Alert>}
 *
 * @param {(...args: any[]) => Promise<any>} action
 * @returns {{run: Function, reset: Function, loading: boolean, error: Error|null, data: any}}
 */
export function useApiAction(action) {
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });

  const [state, setState] = useState({ loading: false, error: null, data: null });

  // Writes are not cancelled on unmount — aborting a half-sent POST is worse
  // than letting it finish. But the component may be gone by the time it
  // returns, so track mounted-ness and skip the state write instead.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    setState({ loading: true, error: null, data: null });
    try {
      const result = await actionRef.current(...args);
      if (mounted.current) setState({ loading: false, error: null, data: result });
      return result;
    } catch (err) {
      if (mounted.current) setState({ loading: false, error: err, data: null });
      // Rethrow so the caller can sequence follow-up work:
      //   await generate.run(id); refetchReport();
      // Swallowing here would make that silently run after a failure.
      throw err;
    }
  }, []);

  const reset = useCallback(() => setState({ loading: false, error: null, data: null }), []);

  return { ...state, run, reset };
}

export default useApi;