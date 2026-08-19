// ---------------------------------------------------------------------------
// src/lib/useCaptureOptions.js — the capture station's display preferences.
//
// Two settings, both DISPLAY-ONLY. Neither changes a stored value:
//
//   unitSystem          metric | imperial — mm/g or in/lb, converted at the edge
//   hidePaintThickness  withholds the paint-thickness INPUTS for a demo
//
// Persisted in localStorage because re-picking them on every part would make them
// useless — an engineer working in inches is working in inches all afternoon.
//
// Deliberately NOT in the URL, unlike the Engineering BOM view's `?view=bom`. That
// one is a thing you send someone ("show me the BOM"); these are a property of the
// person at the bench, and putting them in the URL would mean a shared capture link
// silently imposed one engineer's units on another.
//
// ---------------------------------------------------------------------------
// WHY hidePaintThickness HIDES INPUTS AND NOTHING ELSE
//
// It was asked for so paint thickness can be kept off screen during a demo. It
// must therefore not touch data: the columns stay, any recorded values stay, and
// turning it back on shows them again. A "hide" that discarded values would be a
// destructive setting wearing a cosmetic name.
// ---------------------------------------------------------------------------

import { useCallback, useState } from 'react';

import { UNIT_SYSTEMS } from '@/lib/units';

const STORAGE_KEY = 'daikin.capture.options';

const DEFAULTS = Object.freeze({
  unitSystem: UNIT_SYSTEMS.METRIC,
  hidePaintThickness: false,
});

/** Read once, tolerating anything: a corrupt value must not break the station. */
function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      unitSystem: Object.values(UNIT_SYSTEMS).includes(parsed?.unitSystem)
        ? parsed.unitSystem
        : DEFAULTS.unitSystem,
      hidePaintThickness: parsed?.hidePaintThickness === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function write(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode, or storage full. The setting still applies for this session —
    // failing to persist a display preference is not worth surfacing an error for.
  }
}

/**
 * @returns {{
 *   options: {unitSystem: string, hidePaintThickness: boolean},
 *   setUnitSystem: (system: string) => void,
 *   setHidePaintThickness: (hide: boolean) => void,
 * }}
 */
export function useCaptureOptions() {
  // Lazy initialiser, so localStorage is read once on mount rather than on every
  // render — and never inside an effect, which would flash the default first.
  const [options, setOptions] = useState(read);

  const update = useCallback((patch) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      write(next);
      return next;
    });
  }, []);

  return {
    options,
    setUnitSystem: useCallback((unitSystem) => update({ unitSystem }), [update]),
    setHidePaintThickness: useCallback(
      (hidePaintThickness) => update({ hidePaintThickness }),
      [update],
    ),
  };
}
