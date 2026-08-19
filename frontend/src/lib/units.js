// ---------------------------------------------------------------------------
// src/lib/units.js — metric/imperial DISPLAY conversion for the capture station.
//
// ---------------------------------------------------------------------------
// THE DATABASE IS ALWAYS METRIC. THIS IS A DISPLAY LAYER.
//
// Every stored column is mm or grams, and stays that way — `weightG` is named for
// its unit precisely so a grams-vs-kilograms mix-up can't hide in a rollup, and the
// same logic applies tenfold to inches. So the toggle converts on the way OUT for
// display and on the way IN before saving, and nothing downstream (reports,
// exports, Best-of-Best, the importers) ever sees an imperial number.
//
// The consequence to be honest about: a value typed in inches is converted to mm
// and stored, so re-displaying it in inches is a round trip through a division.
// 1/16" entered as 0.0625 comes back as 0.063 at three decimals. That is inherent
// to storing one canonical unit, and the alternative — storing whichever unit was
// typed — is far worse: every sum would need to know the unit of every row.
// ---------------------------------------------------------------------------

/** Exact definitions, matching bomCells.js so the two can't disagree. */
export const MM_PER_INCH = 25.4;
export const GRAMS_PER_POUND = 453.59237;

export const UNIT_SYSTEMS = Object.freeze({ METRIC: 'metric', IMPERIAL: 'imperial' });

/**
 * How each stored unit is displayed in each system.
 *
 * Keyed by the STORED unit ('mm' | 'g'), because that is what the field
 * definitions carry — captureFields.js states the unit a column is stored in, and
 * this decides what the engineer sees.
 */
const DISPLAY = Object.freeze({
  mm: {
    metric: { label: 'mm', toDisplay: (v) => v, toStored: (v) => v, decimals: 2 },
    imperial: {
      label: 'in',
      toDisplay: (v) => v / MM_PER_INCH,
      toStored: (v) => v * MM_PER_INCH,
      // Three decimals: a thousandth of an inch is the usual shop tolerance, and
      // two would round 0.59mm sheet (0.023") to 0.02".
      decimals: 3,
    },
  },
  g: {
    metric: { label: 'g', toDisplay: (v) => v, toStored: (v) => v, decimals: 1 },
    imperial: {
      label: 'lb',
      toDisplay: (v) => v / GRAMS_PER_POUND,
      toStored: (v) => v * GRAMS_PER_POUND,
      decimals: 3,
    },
  },
});

/** @returns the conversion spec for a stored unit in a system, metric as fallback. */
export function unitSpec(storedUnit, system) {
  const forUnit = DISPLAY[storedUnit];
  if (!forUnit) return { label: storedUnit ?? '', toDisplay: (v) => v, toStored: (v) => v, decimals: 2 };
  return forUnit[system] ?? forUnit.metric;
}

/** The unit an engineer sees: 'mm' -> 'in', 'g' -> 'lb' under imperial. */
export function unitLabel(storedUnit, system) {
  return unitSpec(storedUnit, system).label;
}

/**
 * A stored value, formatted for display in the chosen system.
 *
 * @returns {string|null} null for a value that isn't there — never "0", which
 *   would assert a measurement of zero
 */
export function toDisplay(storedValue, storedUnit, system) {
  if (storedValue === null || storedValue === undefined || storedValue === '') return null;
  const n = Number(storedValue);
  if (!Number.isFinite(n)) return null;
  const spec = unitSpec(storedUnit, system);
  // trailing zeros trimmed: "1600.2" not "1600.20", "0.023" not "0.0230"
  return String(Number(spec.toDisplay(n).toFixed(spec.decimals)));
}

/**
 * A value the engineer typed, converted to what the column stores.
 *
 * @returns {number|null} null when the input isn't a finite number, so callers
 *   can reject it rather than storing NaN
 */
export function toStored(displayValue, storedUnit, system) {
  if (displayValue === null || displayValue === undefined || String(displayValue).trim() === '') {
    return null;
  }
  const n = Number(String(displayValue).trim());
  if (!Number.isFinite(n)) return null;
  return unitSpec(storedUnit, system).toStored(n);
}
