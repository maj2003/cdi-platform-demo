// ---------------------------------------------------------------------------
// src/db/seed.js — populate the local database with the Daikin AHU benchmark set.
//
// RUN:  npm run seed
//
// ---------------------------------------------------------------------------
// ⚠ REAL MODEL NUMBERS, INVENTED TEARDOWN NUMBERS. READ THIS BEFORE SCREENSHOTTING.
//
// The four products below are real competitor residential air handlers, named by
// their actual model numbers. EVERY dimension, weight, cost, part number and
// process below is FABRICATED to be plausible — none of it came from an actual
// teardown, a supplier quote, or a CEDARS export.
//
// This is a deliberate reversal of the previous seed's decision, which used
// fictional brands (Northwind/Vertex/Meridian) precisely so that nobody could
// mistake made-up figures for real competitive intelligence. Real model numbers
// were asked for so the demo reads as the actual benchmarking programme, and
// that's a reasonable call — but it removes the safety rail that fictional
// brands provided. Two things compensate, and both should stay:
//
//   1. Every product's `notes` field opens with "ILLUSTRATIVE DATA". That text
//      renders in the UI, on the product card and the teardown header — so a
//      screenshot carries its own disclaimer instead of relying on whoever
//      took it to remember.
//   2. This comment.
//
// When real teardown data arrives, replace the numbers AND delete the
// ILLUSTRATIVE DATA prefixes in the same commit. Leaving them on real data is
// as misleading as removing them from fake data.
// ---------------------------------------------------------------------------
//
// THE BENCHMARKING STORY THE NUMBERS TELL
//
// Five units, deliberately differentiated so the cost/weight/part-count views
// have something to say rather than showing five near-identical bars:
//
//   Goodman  AMST48CU300   4-ton    CHEAPEST, lowest cost/kg. Budget build:
//                                   0.75 mm cabinet steel, PSC motor (heavy and
//                                   cheap), fixed orifice instead of a TXV, no
//                                   electric heat. The baseline.
//   Carrier  FJ5ANXA18L    1.5-ton  Smallest unit; second cheapest and second
//                                   lightest. Same FJ5ANX family as the C48L
//                                   below, one tier down: constant-torque ECM,
//                                   TXV, 3 kW heat, single combined harness.
//   Bosch    BVA36WN1-M15  3-ton    LIGHTEST, highest cost/kg. Premium compact:
//                                   all-aluminium microchannel coil, composite
//                                   base pan and blower housing, inverter drive.
//                                   Buys weight down with money.
//   Carrier  FJ5ANXC48L    4-ton    The middle on cost and weight.
//                                   Constant-torque ECM, TXV, 5 kW heat.
//   Trane    5TEMCB02      4-ton    HEAVIEST, most expensive, most parts.
//                                   Over-engineered: 1.0 mm cabinet steel,
//                                   double-wall access door, corner posts, a
//                                   STAINLESS drain pan, variable-speed ECM,
//                                   8 kW heat.
//
// ⚠ CAPACITY CAVEAT, ON PURPOSE, AND IT GOT SHARPER WITH THE A18L: this set now
// spans 1.5, 3 and 4 tons. So "Bosch is lightest" is partly "Bosch is smaller",
// and the A18L is cheaper and lighter than three of the others largely because
// it moves a third of the air. cost/kg is the size-neutral comparison.
//
// This matters most for the Best-of-Best composite, which takes the cheapest
// version of each module regardless of the capacity it was designed for — its
// coil target now comes from a 1.5-ton unit, so it is NOT a valid coil target
// for a 4-ton design. The mismatch is real (these are the models specified) and
// the composite's caveats say so out loud rather than normalising it away.
//
// A18L IS DELIBERATELY *NOT* THE CHEAPEST OR LIGHTEST OVERALL. A 1.5-ton unit
// could plausibly have been costed below the Goodman and lighter than the Bosch,
// which would have quietly taken both documented crowns and rewritten the
// benchmarking story this set exists to tell. Instead it is positioned as a
// genuine step below the C48L while sitting ABOVE the Goodman on cost (its
// ECM + TXV + heat content justifies that against a 4-ton with a PSC motor and
// a fixed orifice) and ABOVE the Bosch on weight (heavy G90 steel cabinet
// against Bosch's composite-and-microchannel build). Both are defensible on
// content rather than size — but they were chosen, not stumbled into.
// ---------------------------------------------------------------------------
//
// MODULE STRUCTURE — the 8 Level-1 AHU modules
//
// Each module is BOTH a SubAssembly row (so it groups the tree and drives every
// per-module cost/weight rollup) AND the `moduleName` column on each part
// underneath it. Same string in both places, deliberately: the sub-assembly is
// what the reports group by, and `moduleName` is what a BOM export or a future
// cross-product pivot reads. `Electric Heater Assm` is optional and is absent on
// the Goodman and Bosch, which is a real product difference, not missing data.
// ---------------------------------------------------------------------------
//
// RE-RUNNABILITY (what "upsert" actually means here):
//   Product        — true upsert on the natural key (brand + name). The product
//                    row and its id survive every re-run.
//   Everything below — deleted and rebuilt. Sub-assemblies and parts have no
//                    natural key (two brackets can legitimately share a name),
//                    so there is nothing to upsert *on*. Deleting the product's
//                    sub-assemblies cascades through parts -> costs +
//                    measurements, and the tree is rebuilt from the catalog.
//
// Run it as many times as you like; the database always ends in exactly this
// state. Anything hand-entered through the UI for these four products is wiped —
// that is the tradeoff, and it is the right one for a seed.
// ---------------------------------------------------------------------------

import {
  products,
  subAssemblies,
  parts,
  costs,
  measurements,
  reports,
  MEASUREMENT_TYPES,
  PRODUCT_SOURCES,
  disconnect,
} from '../data/index.js';

/** Exact definition. Parts store weight in BOTH units — see fillDerived(). */
const LBS_PER_GRAM = 1 / 453.59237;

/**
 * The 8 Level-1 AHU modules, in teardown order.
 *
 * Exported-ish as a named constant rather than inlined so the catalog below can
 * only ever use one of these eight strings — a typo'd module name would
 * otherwise create a silent ninth sub-assembly that splits a rollup in two.
 */
const MODULES = Object.freeze({
  PACKAGING: 'Packaging Assm',
  CABINET: 'Cabinet Assm',
  COIL: 'Coil Assm - Evaporator',
  BLOWER: 'Blower Assm',
  ELECTRICAL: 'Electrical Assm',
  CONDENSATE: 'Condensate Mgmt Assm',
  FILTRATION: 'Air Filtration Assm',
  HEATER: 'Electric Heater Assm',
});

const MODULE_DESCRIPTIONS = Object.freeze({
  [MODULES.PACKAGING]: 'Shipping carton, foam protection and transit hardware.',
  [MODULES.CABINET]: 'Structural enclosure — wrapper, base pan, access door and insulation.',
  [MODULES.COIL]: 'Evaporator coil slab, refrigerant metering and coil supports.',
  [MODULES.BLOWER]: 'Blower housing, wheel, motor and mounts.',
  [MODULES.ELECTRICAL]: 'Control board, wiring harnesses and power termination.',
  [MODULES.CONDENSATE]: 'Drain pan, secondary containment and overflow protection.',
  [MODULES.FILTRATION]: 'Return air filter and filter retention.',
  [MODULES.HEATER]: 'Supplemental electric heat elements and safety limits.',
});

/**
 * Legacy products to remove on the next seed run.
 *
 * The previous seed's three fictional split-AC units. They have to go explicitly
 * because the seed upserts by (brand, name) — a product no longer in the catalog
 * is otherwise simply left behind, and the compare views would show seven
 * products across two unrelated categories.
 *
 * NAMED EXPLICITLY rather than "delete anything not in CATALOG", which would
 * also wipe any teardown imported through the CEDARS BOM importer. This list is
 * a one-time migration and can be deleted once every environment has run the
 * seed at least once past this commit.
 */
const RETIRED_PRODUCTS = Object.freeze([
  { brand: 'Northwind Climate', name: 'Breeze 9K (NW-B09)' },
  { brand: 'Vertex HVAC', name: 'Aurora 12K (VX-A12)' },
  { brand: 'Meridian Air', name: 'Elite 12K (MA-E12)' },
]);

// ---------------------------------------------------------------------------
// Deterministic jitter
//
// Measurements are generated from each part's dimensions with a small offset,
// because that is what a real capture looks like: the Part row holds the agreed
// value, the Measurement rows hold what the caliper actually read. Identical
// numbers in both tables would make the provenance split look pointless.
//
// The offset must be deterministic — Math.random() would mean every re-seed
// silently changes the data, and "the numbers moved" is a miserable thing to
// debug mid-demo. So: hash the part name into a seed, run a tiny PRNG.
// ---------------------------------------------------------------------------

/** FNV-1a — small, fast, good enough to turn a label into a stable seed. */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — 4-line PRNG, deterministic for a given seed. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nudge a value by up to ±`pct`, rounded to `dp` decimals. */
function jitter(rng, value, pct, dp = 1) {
  const factor = 1 + (rng() - 0.5) * 2 * pct;
  return Number((value * factor).toFixed(dp));
}

// ---------------------------------------------------------------------------
// The catalog
//
// Plain data, no logic. Each part carries its own `cost` block; the writer below
// pulls it out. partRepository.normalise() ignores unknown keys, so the nested
// cost object passes through the part insert harmlessly.
//
// CROSS-PRODUCT COMPARABILITY: `functionName` and `comparisonName` use the SAME
// strings for the equivalent part on every product ("Air Movement Drive" /
// "Blower Motor" on all four). That is what makes a like-for-like comparison —
// and a future best-of-best pick of the cheapest part per function — possible at
// all. If you add a part, reuse an existing pair unless the function is genuinely
// new. `similarFlag: false` marks the parts with no counterpart elsewhere in the
// set, which is a real signal and not a placeholder.
// ---------------------------------------------------------------------------

const CATALOG = [
  // =========================================================================
  // 1. GOODMAN — the budget baseline. Cheapest, lowest cost/kg, fewest parts.
  // =========================================================================
  {
    name: 'AMST48CU300',
    brand: 'Goodman',
    category: 'Residential Air Handling Unit',
    notes:
      'ILLUSTRATIVE DATA — figures are fabricated, not from a real teardown. ' +
      '4-ton multi-position air handler. Budget build: 0.75 mm cabinet steel, PSC blower motor, ' +
      'fixed-orifice metering, no electric heat. Baseline unit for cost comparison.',
    tornDownOn: '2026-07-28T09:10:00Z',
    capturedBy: 'Yuvaraj R.',
    modules: [
      {
        module: MODULES.PACKAGING,
        parts: [
          {
            name: 'Shipping Carton', description: 'Single-wall corrugated, printed, 1370 x 610 x 560 mm',
            material: 'Corrugated Board', finish: 'Printed',
            weightG: 2450, lengthMm: 1370, widthMm: 610, heightMm: 560, quantity: 1,
            cost: { materialCost: 3.20, processCost: 0.45, labourCost: 0.15 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'GMN-48-PKG-001', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Flexo Printing',
            surfaceFinish: 'Printed Kraft', geometryType: 'rectangular', thicknessMm: 4.5,
            functionName: 'Transit Protection', comparisonName: 'Shipping Carton',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Foam Corner Set', description: 'EPS moulded corner protectors, 4 per unit',
            material: 'EPS', finish: 'As-moulded',
            weightG: 95, lengthMm: 180, widthMm: 180, heightMm: 120, quantity: 4,
            cost: { materialCost: 0.42, processCost: 0.18, labourCost: 0.06 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'GMN-48-PKG-002', uom: 'EA', primaryProcess: 'Foam Moulding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom',
            functionName: 'Transit Protection', comparisonName: 'Foam Corner Set',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CABINET,
        parts: [
          {
            name: 'Cabinet Wrapper Panel', description: 'Wrap-around cabinet shell, 0.75 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 8600, lengthMm: 1345, widthMm: 546, heightMm: 546, quantity: 1,
            cost: { materialCost: 9.80, processCost: 4.20, labourCost: 1.10 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'GMN-48-CAB-001', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G60', geometryType: 'sheet_metal', thicknessMm: 0.75,
            unfoldedLengthMm: 1980, unfoldedWidthMm: 560, bends: 4, punches: 12, scrapRatePct: 8.5,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Wrapper Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Base Pan', description: 'Formed base with blower cutout, 1.0 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 3100, lengthMm: 546, widthMm: 520, heightMm: 62, quantity: 1,
            cost: { materialCost: 4.10, processCost: 2.20, labourCost: 0.60 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'GMN-48-CAB-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G60', geometryType: 'sheet_metal', thicknessMm: 1.0,
            unfoldedLengthMm: 640, unfoldedWidthMm: 600, bends: 6, punches: 9, scrapRatePct: 11.0,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Base Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Access Door Panel', description: 'Single-wall removable service door, 0.75 mm',
            material: 'Galvanised Steel', finish: 'Painted',
            weightG: 2450, lengthMm: 720, widthMm: 520, heightMm: 22, quantity: 1,
            cost: { materialCost: 3.20, processCost: 1.80, labourCost: 0.45 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'GMN-48-CAB-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Powder Coating',
            surfaceFinish: 'Powder Coated (Beige)', geometryType: 'sheet_metal', thicknessMm: 0.75,
            unfoldedLengthMm: 760, unfoldedWidthMm: 560, bends: 4, punches: 6, scrapRatePct: 9.0,
            functionName: 'Service Access', comparisonName: 'Access Door Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Insulation Liner', description: '12 mm fibreglass batt, unfaced',
            material: 'Fibreglass', finish: 'Unfaced',
            weightG: 1450, lengthMm: 1300, widthMm: 520, heightMm: 12, quantity: 1,
            cost: { materialCost: 2.60, processCost: 0.75, labourCost: 0.35 },
            makeOrBuy: 'Buy', productCategory: 'Insulation', commodity: 'Insulation',
            partNo: 'GMN-48-CAB-004', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: null,
            surfaceFinish: 'Unfaced', geometryType: 'custom', thicknessMm: 12,
            functionName: 'Thermal Insulation', comparisonName: 'Cabinet Insulation Liner',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.COIL,
        parts: [
          {
            name: 'Evaporator Coil Slab', description: '2-row A-coil, copper hairpin / aluminium fin, 12 FPI',
            material: 'Copper / Aluminium', finish: 'Bare',
            weightG: 11800, lengthMm: 610, widthMm: 495, heightMm: 460, quantity: 1,
            cost: { materialCost: 62.00, processCost: 18.50, labourCost: 6.20 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Coil',
            partNo: 'GMN-48-COI-001', uom: 'EA', primaryProcess: 'Tube Bending', secondaryProcess: 'Fin Stamping',
            surfaceFinish: 'Bare Aluminium', geometryType: 'circular',
            diameterOuterMm: 9.52, diameterInnerMm: 8.71, wallThicknessMm: 0.405, turns: 26, fpi: 12,
            functionName: 'Heat Transfer', comparisonName: 'Evaporator Coil Slab',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Refrigerant Distributor', description: 'Brass distributor, fixed orifice metering',
            material: 'Brass', finish: 'Bare',
            weightG: 185, lengthMm: 92, widthMm: 46, heightMm: 34, quantity: 1,
            cost: { materialCost: 4.20, processCost: 1.60, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'GMN-48-COI-002', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Brazing',
            surfaceFinish: 'Bare Brass', geometryType: 'circular',
            diameterOuterMm: 15.9, diameterInnerMm: 14.5, wallThicknessMm: 0.7,
            functionName: 'Refrigerant Distribution', comparisonName: 'Refrigerant Distributor',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Coil Support Rail', description: 'Formed coil end rail, galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 420, lengthMm: 500, widthMm: 48, heightMm: 34, quantity: 2,
            cost: { materialCost: 1.10, processCost: 0.60, labourCost: 0.22 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Bracket', commodity: 'Steel',
            partNo: 'GMN-48-COI-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: null,
            surfaceFinish: 'Galvanised G60', geometryType: 'sheet_metal', thicknessMm: 1.2,
            unfoldedLengthMm: 520, unfoldedWidthMm: 96, bends: 3, punches: 4, scrapRatePct: 7.0,
            functionName: 'Coil Support', comparisonName: 'Coil Support Rail',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.BLOWER,
        parts: [
          {
            name: 'Blower Housing Assembly', description: 'Galvanised scroll housing with inlet rings',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 4200, lengthMm: 400, widthMm: 380, heightMm: 300, quantity: 1,
            cost: { materialCost: 8.40, processCost: 4.60, labourCost: 1.40 },
            makeOrBuy: 'Make', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'GMN-48-BLW-001', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Spot Welding',
            surfaceFinish: 'Galvanised G60', geometryType: 'sheet_metal', thicknessMm: 0.9,
            unfoldedLengthMm: 1180, unfoldedWidthMm: 420, bends: 8, punches: 14, scrapRatePct: 13.5,
            functionName: 'Air Movement', comparisonName: 'Blower Housing',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Direct-Drive Blower Wheel', description: 'Forward-curved centrifugal wheel, 254 mm dia',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 2650, lengthMm: 254, widthMm: 254, heightMm: 232, quantity: 1,
            cost: { materialCost: 7.20, processCost: 3.40, labourCost: 0.95 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'GMN-48-BLW-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Riveting',
            surfaceFinish: 'Galvanised G60', geometryType: 'circular',
            diameterOuterMm: 254, diameterInnerMm: 196,
            functionName: 'Air Movement', comparisonName: 'Blower Wheel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'PSC Blower Motor', description: '1/2 HP permanent split capacitor, 4-speed tap',
            material: 'Steel / Copper', finish: 'Painted',
            weightG: 8900, lengthMm: 165, widthMm: 140, heightMm: 140, quantity: 1,
            // A PSC motor is the single biggest divergence from the other three
            // units: heavier and markedly cheaper than any ECM in the set, and
            // the reason this teardown wins on cost and loses on efficiency.
            cost: { materialCost: 38.00, processCost: 9.50, labourCost: 3.20 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Electrical',
            partNo: 'GMN-48-BLW-003', uom: 'EA', primaryProcess: 'Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Painted (Black Enamel)', geometryType: 'circular',
            diameterOuterMm: 140, turns: 320,
            functionName: 'Air Movement Drive', comparisonName: 'Blower Motor',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.ELECTRICAL,
        parts: [
          {
            name: 'Relay Control Board', description: 'Single-sided relay board, no communicating bus',
            material: 'FR-2 / Mixed', finish: 'HASL',
            weightG: 240, lengthMm: 168, widthMm: 112, heightMm: 32, quantity: 1,
            cost: { materialCost: 14.50, processCost: 3.60, labourCost: 1.20 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Electrical',
            partNo: 'GMN-48-ELE-001', uom: 'EA', primaryProcess: 'PCB Fabrication', secondaryProcess: 'THT Assembly',
            surfaceFinish: 'HASL', geometryType: 'rectangular', thicknessMm: 1.6,
            functionName: 'System Control', comparisonName: 'Control Board',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Line Voltage Wire Harness', description: '14 AWG line-side harness with quick-connects',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 320, lengthMm: 1150, widthMm: 26, heightMm: 18, quantity: 1,
            cost: { materialCost: 4.80, processCost: 1.40, labourCost: 0.90 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'GMN-48-ELE-002', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '14 AWG',
            functionName: 'Power Distribution', comparisonName: 'Line Voltage Harness',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CONDENSATE,
        parts: [
          {
            name: 'Condensate Drain Pan', description: 'Moulded polypropylene primary pan, dual outlet',
            material: 'PP', finish: 'As-moulded',
            weightG: 1250, lengthMm: 540, widthMm: 500, heightMm: 46, quantity: 1,
            cost: { materialCost: 6.40, processCost: 2.80, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Condensate Management', commodity: 'Misc',
            partNo: 'GMN-48-CND-001', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom', thicknessMm: 3.2,
            functionName: 'Condensate Collection', comparisonName: 'Condensate Drain Pan',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.FILTRATION,
        parts: [
          {
            name: 'Return Air Filter', description: 'Pleated MERV 8, 508 x 508 x 25 mm',
            material: 'Polyester Media', finish: 'Bare',
            weightG: 380, lengthMm: 508, widthMm: 508, heightMm: 25, quantity: 1,
            cost: { materialCost: 2.10, processCost: 0.60, labourCost: 0.20 },
            makeOrBuy: 'Buy', productCategory: 'Filtration', commodity: 'Misc',
            partNo: 'GMN-48-FIL-001', uom: 'EA', primaryProcess: 'Media Pleating', secondaryProcess: 'Frame Assembly',
            surfaceFinish: 'Bare', geometryType: 'rectangular', thicknessMm: 25,
            functionName: 'Air Filtration', comparisonName: 'Return Air Filter',
            isFastener: false, similarFlag: true,
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 2. CARRIER FJ5ANXA18L — the small one. 1.5-ton, second cheapest, second
  //    lightest. Same FJ5ANX family as the C48L further down, one tier below it.
  //
  //    Placed here rather than beside its C48L sibling ON PURPOSE: catalog order
  //    IS seed order IS the cost ramp (see productRepository.listProducts), and
  //    $275.67 belongs between the Goodman's $250.18 and the Bosch's $323.46.
  //    Grouping the two Carriers together would read better in this file and
  //    break the ordering the whole app depends on.
  //
  //    NOTE ON ITS ID: on an existing database this product is created after the
  //    other four, so it takes the next autoincrement id and therefore sorts
  //    LAST on the products page — the cost ramp only holds by id on a database
  //    seeded from empty. Goodman stays the lowest id, which is what the
  //    baseline-product convention actually needs.
  // =========================================================================
  {
    name: 'FJ5ANXA18L',
    brand: 'Carrier',
    category: 'Residential Air Handling Unit',
    notes:
      'ILLUSTRATIVE DATA — figures are fabricated, not from a real teardown. ' +
      '1.5-ton air handler with 3 kW electric heat, one tier below the FJ5ANXC48L in the same ' +
      'FJ5ANX family: constant-torque ECM, TXV metering, single combined wire harness, no ' +
      'secondary drain pan. Smallest unit in the set — it is cheaper and lighter than most of ' +
      'the others largely because it moves a third of the air, so compare cost/kg, not totals.',
    tornDownOn: '2026-08-03T09:20:00Z',
    capturedBy: 'Sathish K.',
    modules: [
      {
        module: MODULES.PACKAGING,
        parts: [
          {
            name: 'Shipping Carton', description: 'Single-wall corrugated, printed, 1150 x 480 x 460 mm',
            material: 'Corrugated Board', finish: 'Printed',
            weightG: 1950, lengthMm: 1150, widthMm: 480, heightMm: 460, quantity: 1,
            cost: { materialCost: 2.60, processCost: 0.36, labourCost: 0.12 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'CAR-18-PKG-001', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Flexo Printing',
            surfaceFinish: 'Printed Kraft', geometryType: 'rectangular', thicknessMm: 4.0,
            functionName: 'Transit Protection', comparisonName: 'Shipping Carton',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Foam Corner Set', description: 'EPS moulded corner protectors, 4 per unit',
            material: 'EPS', finish: 'As-moulded',
            weightG: 78, lengthMm: 155, widthMm: 155, heightMm: 105, quantity: 4,
            cost: { materialCost: 0.36, processCost: 0.15, labourCost: 0.05 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'CAR-18-PKG-002', uom: 'EA', primaryProcess: 'Foam Moulding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom',
            functionName: 'Transit Protection', comparisonName: 'Foam Corner Set',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CABINET,
        parts: [
          {
            name: 'Cabinet Wrapper Panel', description: 'Wrap-around cabinet shell, 0.90 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 7400, lengthMm: 1090, widthMm: 430, heightMm: 430, quantity: 1,
            cost: { materialCost: 9.20, processCost: 4.00, labourCost: 1.00 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'CAR-18-CAB-001', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 0.90,
            unfoldedLengthMm: 1580, unfoldedWidthMm: 445, bends: 4, punches: 10, scrapRatePct: 9.0,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Wrapper Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Base Pan', description: 'Formed base with blower cutout, 1.0 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 2600, lengthMm: 430, widthMm: 410, heightMm: 54, quantity: 1,
            cost: { materialCost: 3.40, processCost: 1.95, labourCost: 0.55 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'CAR-18-CAB-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.0,
            unfoldedLengthMm: 520, unfoldedWidthMm: 490, bends: 6, punches: 8, scrapRatePct: 11.5,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Base Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Access Door Panel', description: 'Single-wall removable service door, 0.90 mm',
            material: 'Galvanised Steel', finish: 'Painted',
            weightG: 2150, lengthMm: 580, widthMm: 410, heightMm: 20, quantity: 1,
            cost: { materialCost: 3.10, processCost: 1.65, labourCost: 0.45 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'CAR-18-CAB-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Powder Coating',
            surfaceFinish: 'Powder Coated (Grey)', geometryType: 'sheet_metal', thicknessMm: 0.90,
            unfoldedLengthMm: 615, unfoldedWidthMm: 448, bends: 4, punches: 5, scrapRatePct: 9.5,
            functionName: 'Service Access', comparisonName: 'Access Door Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Insulation Liner', description: '16 mm foil-faced fibreglass batt',
            material: 'Fibreglass', finish: 'Foil-faced',
            weightG: 1250, lengthMm: 1060, widthMm: 410, heightMm: 16, quantity: 1,
            cost: { materialCost: 2.40, processCost: 0.68, labourCost: 0.30 },
            makeOrBuy: 'Buy', productCategory: 'Insulation', commodity: 'Insulation',
            partNo: 'CAR-18-CAB-004', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Foil Lamination',
            surfaceFinish: 'Foil Faced (FSK)', geometryType: 'custom', thicknessMm: 16,
            functionName: 'Thermal Insulation', comparisonName: 'Cabinet Insulation Liner',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.COIL,
        parts: [
          {
            name: 'Evaporator Coil Slab', description: '2-row A-coil, copper hairpin / aluminium fin, 12 FPI',
            material: 'Copper / Aluminium', finish: 'Bare',
            // Copper-and-aluminium at 1.5 ton still comes out heavier than the
            // Bosch's 3-ton all-aluminium microchannel slab — construction
            // beating capacity, which is the point of having both in the set.
            weightG: 6700, lengthMm: 400, widthMm: 330, heightMm: 310, quantity: 1,
            cost: { materialCost: 32.00, processCost: 10.60, labourCost: 3.40 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Coil',
            partNo: 'CAR-18-COI-001', uom: 'EA', primaryProcess: 'Tube Bending', secondaryProcess: 'Fin Stamping',
            surfaceFinish: 'Bare Aluminium', geometryType: 'circular',
            diameterOuterMm: 9.52, diameterInnerMm: 8.71, wallThicknessMm: 0.405, turns: 18, fpi: 12,
            functionName: 'Heat Transfer', comparisonName: 'Evaporator Coil Slab',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Refrigerant Distributor', description: 'Brass distributor, 4 feeder tubes',
            material: 'Brass', finish: 'Bare',
            weightG: 145, lengthMm: 82, widthMm: 40, heightMm: 30, quantity: 1,
            cost: { materialCost: 4.00, processCost: 1.50, labourCost: 0.50 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'CAR-18-COI-002', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Brazing',
            surfaceFinish: 'Bare Brass', geometryType: 'circular',
            diameterOuterMm: 12.7, diameterInnerMm: 11.5, wallThicknessMm: 0.6,
            functionName: 'Refrigerant Distribution', comparisonName: 'Refrigerant Distributor',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Coil Support Rail', description: 'Formed coil end rail, galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 280, lengthMm: 330, widthMm: 40, heightMm: 28, quantity: 2,
            cost: { materialCost: 0.85, processCost: 0.48, labourCost: 0.18 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Bracket', commodity: 'Steel',
            partNo: 'CAR-18-COI-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: null,
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.2,
            unfoldedLengthMm: 345, unfoldedWidthMm: 76, bends: 3, punches: 4, scrapRatePct: 7.0,
            functionName: 'Coil Support', comparisonName: 'Coil Support Rail',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Thermostatic Expansion Valve', description: 'Externally equalised TXV, R-410A, 1.5-ton',
            material: 'Brass / Steel', finish: 'Bare',
            weightG: 215, lengthMm: 82, widthMm: 44, heightMm: 58, quantity: 1,
            cost: { materialCost: 16.00, processCost: 4.00, labourCost: 1.00 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'CAR-18-COI-004', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare Brass', geometryType: 'custom',
            functionName: 'Refrigerant Metering', comparisonName: 'Expansion Valve',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.BLOWER,
        parts: [
          {
            name: 'Blower Housing Assembly', description: 'Galvanised scroll housing with inlet ring',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 3100, lengthMm: 300, widthMm: 290, heightMm: 230, quantity: 1,
            cost: { materialCost: 6.60, processCost: 3.55, labourCost: 1.05 },
            makeOrBuy: 'Make', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'CAR-18-BLW-001', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Spot Welding',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 0.9,
            unfoldedLengthMm: 880, unfoldedWidthMm: 320, bends: 8, punches: 12, scrapRatePct: 13.0,
            functionName: 'Air Movement', comparisonName: 'Blower Housing',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Direct-Drive Blower Wheel', description: 'Forward-curved centrifugal wheel, 184 mm dia',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 1750, lengthMm: 184, widthMm: 184, heightMm: 170, quantity: 1,
            cost: { materialCost: 4.80, processCost: 2.30, labourCost: 0.68 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'CAR-18-BLW-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Riveting',
            surfaceFinish: 'Galvanised G90', geometryType: 'circular',
            diameterOuterMm: 184, diameterInnerMm: 142,
            functionName: 'Air Movement', comparisonName: 'Blower Wheel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'ECM Constant-Torque Motor', description: '1/3 HP constant-torque ECM, 5-tap',
            material: 'Steel / Copper / NdFeB', finish: 'Painted',
            weightG: 6100, lengthMm: 145, widthMm: 125, heightMm: 125, quantity: 1,
            cost: { materialCost: 48.00, processCost: 11.00, labourCost: 3.00 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Electrical',
            partNo: 'CAR-18-BLW-003', uom: 'EA', primaryProcess: 'Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Painted (Black Enamel)', geometryType: 'circular',
            diameterOuterMm: 125, turns: 260,
            functionName: 'Air Movement Drive', comparisonName: 'Blower Motor',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.ELECTRICAL,
        parts: [
          {
            name: 'Integrated Control Board', description: 'Double-sided board, ECM speed tap control',
            material: 'FR-4 / Mixed', finish: 'HASL',
            weightG: 260, lengthMm: 172, widthMm: 110, heightMm: 34, quantity: 1,
            cost: { materialCost: 24.00, processCost: 5.40, labourCost: 1.60 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Electrical',
            partNo: 'CAR-18-ELE-001', uom: 'EA', primaryProcess: 'PCB Fabrication', secondaryProcess: 'SMT Assembly',
            surfaceFinish: 'HASL', geometryType: 'rectangular', thicknessMm: 1.6,
            functionName: 'System Control', comparisonName: 'Control Board',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Wire Harness Assembly', description: 'Combined 14 AWG line and 18 AWG low-voltage harness',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            // One harness where the C48L and Trane use two. A real
            // simplification at this size, and the reason this product has 19
            // part lines rather than 20.
            weightG: 320, lengthMm: 980, widthMm: 24, heightMm: 16, quantity: 1,
            cost: { materialCost: 6.20, processCost: 1.85, labourCost: 1.20 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'CAR-18-ELE-002', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '14 / 18 AWG',
            functionName: 'Power Distribution', comparisonName: 'Line Voltage Harness',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CONDENSATE,
        parts: [
          {
            name: 'Condensate Drain Pan', description: 'Moulded polypropylene primary pan, dual outlet',
            material: 'PP', finish: 'As-moulded',
            weightG: 900, lengthMm: 425, widthMm: 395, heightMm: 38, quantity: 1,
            cost: { materialCost: 5.20, processCost: 2.30, labourCost: 0.48 },
            makeOrBuy: 'Buy', productCategory: 'Condensate Management', commodity: 'Misc',
            partNo: 'CAR-18-CND-001', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom', thicknessMm: 2.8,
            functionName: 'Condensate Collection', comparisonName: 'Condensate Drain Pan',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.FILTRATION,
        parts: [
          {
            name: 'Return Air Filter', description: 'Pleated MERV 11, 356 x 356 x 25 mm',
            material: 'Polyester Media', finish: 'Bare',
            weightG: 240, lengthMm: 356, widthMm: 356, heightMm: 25, quantity: 1,
            cost: { materialCost: 2.40, processCost: 0.60, labourCost: 0.20 },
            makeOrBuy: 'Buy', productCategory: 'Filtration', commodity: 'Misc',
            partNo: 'CAR-18-FIL-001', uom: 'EA', primaryProcess: 'Media Pleating', secondaryProcess: 'Frame Assembly',
            surfaceFinish: 'Bare', geometryType: 'rectangular', thicknessMm: 25,
            functionName: 'Air Filtration', comparisonName: 'Return Air Filter',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.HEATER,
        parts: [
          {
            name: 'Electric Heat Element Bank', description: '3 kW nichrome coil bank on ceramic insulators',
            material: 'Nichrome / Ceramic', finish: 'Bare',
            weightG: 1180, lengthMm: 400, widthMm: 230, heightMm: 75, quantity: 1,
            cost: { materialCost: 17.60, processCost: 5.60, labourCost: 1.80 },
            makeOrBuy: 'Buy', productCategory: 'Electric Heat', commodity: 'Electrical',
            partNo: 'CAR-18-HTR-001', uom: 'EA', primaryProcess: 'Coil Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare Nichrome', geometryType: 'custom',
            functionName: 'Supplemental Heating', comparisonName: 'Electric Heat Element Bank',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Heater Limit Switch', description: 'Manual-reset thermal limit, 2 per bank',
            material: 'Bakelite / Bimetal', finish: 'Bare',
            weightG: 52, lengthMm: 44, widthMm: 25, heightMm: 19, quantity: 2,
            cost: { materialCost: 3.00, processCost: 0.80, labourCost: 0.32 },
            makeOrBuy: 'Buy', productCategory: 'Electric Heat', commodity: 'Electrical',
            partNo: 'CAR-18-HTR-002', uom: 'EA', primaryProcess: 'Compression Molding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare', geometryType: 'custom',
            functionName: 'Thermal Safety Cutout', comparisonName: 'Heater Limit Switch',
            isFastener: false, similarFlag: true,
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 3. BOSCH — premium compact. LIGHTEST and highest cost/kg. 3-ton.
  //    Buys weight down with money: microchannel coil, composite structure.
  // =========================================================================
  {
    name: 'BVA36WN1-M15',
    brand: 'Bosch',
    category: 'Residential Air Handling Unit',
    notes:
      'ILLUSTRATIVE DATA — figures are fabricated, not from a real teardown. ' +
      '3-ton inverter-driven air handler. Lightest unit in the set and the highest cost per kg: ' +
      'all-aluminium microchannel coil, composite base pan and blower housing, closed-cell insulation. ' +
      'NOTE: 3-ton vs 4-ton on the other three — compare cost/kg, not absolute weight.',
    tornDownOn: '2026-07-29T10:25:00Z',
    capturedBy: 'Sathish K.',
    modules: [
      {
        module: MODULES.PACKAGING,
        parts: [
          {
            name: 'Shipping Carton', description: 'Single-wall corrugated, printed, 1240 x 560 x 520 mm',
            material: 'Corrugated Board', finish: 'Printed',
            weightG: 2150, lengthMm: 1240, widthMm: 560, heightMm: 520, quantity: 1,
            cost: { materialCost: 3.10, processCost: 0.42, labourCost: 0.15 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'BSH-36-PKG-001', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Flexo Printing',
            surfaceFinish: 'Printed Kraft', geometryType: 'rectangular', thicknessMm: 4.5,
            functionName: 'Transit Protection', comparisonName: 'Shipping Carton',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Foam End Cap Set', description: 'EPP moulded end caps, 2 per unit',
            material: 'EPP', finish: 'As-moulded',
            weightG: 180, lengthMm: 560, widthMm: 520, heightMm: 70, quantity: 2,
            cost: { materialCost: 0.95, processCost: 0.30, labourCost: 0.08 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'BSH-36-PKG-002', uom: 'EA', primaryProcess: 'Foam Moulding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom',
            functionName: 'Transit Protection', comparisonName: 'Foam Corner Set',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CABINET,
        parts: [
          {
            name: 'Cabinet Wrapper Panel', description: 'Wrap-around cabinet shell, 0.70 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 6900, lengthMm: 1215, widthMm: 496, heightMm: 496, quantity: 1,
            cost: { materialCost: 8.60, processCost: 3.90, labourCost: 1.05 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'BSH-36-CAB-001', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G60', geometryType: 'sheet_metal', thicknessMm: 0.70,
            unfoldedLengthMm: 1800, unfoldedWidthMm: 510, bends: 4, punches: 12, scrapRatePct: 8.0,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Wrapper Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Composite Cabinet Base Pan', description: '30% glass-filled PP structural base',
            material: 'PP + 30% GF', finish: 'As-moulded',
            // The lightweighting decision in miniature: 40% lighter than the
            // galvanised base pan the other three use, and materially dearer.
            weightG: 1850, lengthMm: 496, widthMm: 470, heightMm: 58, quantity: 1,
            cost: { materialCost: 5.40, processCost: 2.60, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Sheet Metal / Cabinet', commodity: 'Misc',
            partNo: 'BSH-36-CAB-002', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom', thicknessMm: 4.0,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Base Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Access Door Panel', description: 'Single-wall removable service door, 0.70 mm',
            material: 'Galvanised Steel', finish: 'Painted',
            weightG: 1980, lengthMm: 660, widthMm: 470, heightMm: 20, quantity: 1,
            cost: { materialCost: 2.90, processCost: 1.65, labourCost: 0.42 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'BSH-36-CAB-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Powder Coating',
            surfaceFinish: 'Powder Coated (Graphite)', geometryType: 'sheet_metal', thicknessMm: 0.70,
            unfoldedLengthMm: 700, unfoldedWidthMm: 510, bends: 4, punches: 6, scrapRatePct: 8.5,
            functionName: 'Service Access', comparisonName: 'Access Door Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Closed-Cell Foam Insulation', description: '19 mm EPP closed-cell liner, cleanable face',
            material: 'EPP Foam', finish: 'Skinned',
            weightG: 780, lengthMm: 1180, widthMm: 470, heightMm: 19, quantity: 1,
            cost: { materialCost: 4.20, processCost: 1.10, labourCost: 0.40 },
            makeOrBuy: 'Buy', productCategory: 'Insulation', commodity: 'Insulation',
            partNo: 'BSH-36-CAB-004', uom: 'EA', primaryProcess: 'Foam Moulding', secondaryProcess: 'Die Cutting',
            surfaceFinish: 'Moulded Skin', geometryType: 'custom', thicknessMm: 19,
            functionName: 'Thermal Insulation', comparisonName: 'Cabinet Insulation Liner',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.COIL,
        parts: [
          {
            name: 'Microchannel Evaporator Coil', description: 'All-aluminium microchannel slab, 16 FPI',
            material: 'Aluminium', finish: 'E-coated',
            // 42% lighter than the Goodman's copper/aluminium slab at a similar
            // material cost — the biggest single contributor to this unit being
            // the lightest in the set.
            weightG: 6800, lengthMm: 560, widthMm: 455, heightMm: 420, quantity: 1,
            cost: { materialCost: 54.00, processCost: 21.00, labourCost: 6.80 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Coil',
            partNo: 'BSH-36-COI-001', uom: 'EA', primaryProcess: 'Extrusion', secondaryProcess: 'Controlled Atmosphere Brazing',
            surfaceFinish: 'E-Coat (Epoxy)', geometryType: 'circular',
            diameterOuterMm: 7.94, diameterInnerMm: 7.20, wallThicknessMm: 0.37, turns: 22, fpi: 16,
            functionName: 'Heat Transfer', comparisonName: 'Evaporator Coil Slab',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Refrigerant Distributor', description: 'Brass distributor with electronic expansion feed',
            material: 'Brass', finish: 'Bare',
            weightG: 155, lengthMm: 86, widthMm: 42, heightMm: 32, quantity: 1,
            cost: { materialCost: 4.60, processCost: 1.70, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'BSH-36-COI-002', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Brazing',
            surfaceFinish: 'Bare Brass', geometryType: 'circular',
            diameterOuterMm: 15.9, diameterInnerMm: 14.5, wallThicknessMm: 0.7,
            functionName: 'Refrigerant Distribution', comparisonName: 'Refrigerant Distributor',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Coil Support Rail', description: 'Extruded aluminium coil end rail',
            material: 'Aluminium', finish: 'Mill',
            weightG: 240, lengthMm: 460, widthMm: 44, heightMm: 32, quantity: 2,
            cost: { materialCost: 1.60, processCost: 0.70, labourCost: 0.22 },
            makeOrBuy: 'Buy', productCategory: 'Sheet Metal / Bracket', commodity: 'Misc',
            partNo: 'BSH-36-COI-003', uom: 'EA', primaryProcess: 'Extrusion', secondaryProcess: 'Machining',
            surfaceFinish: 'Mill Finish', geometryType: 'sheet_metal', thicknessMm: 1.6,
            unfoldedLengthMm: 480, unfoldedWidthMm: 88, bends: 2, punches: 4, scrapRatePct: 5.0,
            functionName: 'Coil Support', comparisonName: 'Coil Support Rail',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.BLOWER,
        parts: [
          {
            name: 'Composite Blower Housing', description: 'Glass-filled PA scroll housing',
            material: 'PA6 + 30% GF', finish: 'As-moulded',
            weightG: 2100, lengthMm: 370, widthMm: 350, heightMm: 280, quantity: 1,
            cost: { materialCost: 7.90, processCost: 4.20, labourCost: 1.30 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Misc',
            partNo: 'BSH-36-BLW-001', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom', thicknessMm: 3.5,
            functionName: 'Air Movement', comparisonName: 'Blower Housing',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Composite Blower Wheel', description: 'Forward-curved composite wheel, 241 mm dia',
            material: 'PA6 + 15% GF', finish: 'As-moulded',
            weightG: 1450, lengthMm: 241, widthMm: 241, heightMm: 216, quantity: 1,
            cost: { materialCost: 6.80, processCost: 3.10, labourCost: 0.90 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Misc',
            partNo: 'BSH-36-BLW-002', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: 'Balancing',
            surfaceFinish: 'As-Moulded', geometryType: 'circular',
            diameterOuterMm: 241, diameterInnerMm: 186,
            functionName: 'Air Movement', comparisonName: 'Blower Wheel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'ECM Variable-Speed Motor', description: '3/4 HP electronically commutated, integrated drive',
            material: 'Steel / Copper / NdFeB', finish: 'Powder coated',
            weightG: 6900, lengthMm: 152, widthMm: 132, heightMm: 132, quantity: 1,
            cost: { materialCost: 62.00, processCost: 14.00, labourCost: 4.20 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Electrical',
            partNo: 'BSH-36-BLW-003', uom: 'EA', primaryProcess: 'Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Powder Coated', geometryType: 'circular',
            diameterOuterMm: 132, turns: 288,
            functionName: 'Air Movement Drive', comparisonName: 'Blower Motor',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.ELECTRICAL,
        parts: [
          {
            name: 'Inverter Drive Control Board', description: 'IGBT inverter stage with integrated system control',
            material: 'FR-4 / Mixed', finish: 'ENIG',
            weightG: 380, lengthMm: 210, widthMm: 130, heightMm: 42, quantity: 1,
            cost: { materialCost: 42.00, processCost: 8.40, labourCost: 2.10 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Electrical',
            partNo: 'BSH-36-ELE-001', uom: 'EA', primaryProcess: 'PCB Fabrication', secondaryProcess: 'SMT Assembly',
            surfaceFinish: 'ENIG (Au/Ni)', geometryType: 'rectangular', thicknessMm: 1.6,
            // No counterpart in the set: the other three use a relay or
            // constant-torque control board with the drive in the motor, not a
            // discrete inverter stage on the control board.
            functionName: 'System Control', comparisonName: 'Inverter Drive Board',
            isFastener: false, similarFlag: false,
          },
          {
            name: 'Line Voltage Wire Harness', description: '14 AWG line-side harness with quick-connects',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 260, lengthMm: 1040, widthMm: 24, heightMm: 16, quantity: 1,
            cost: { materialCost: 4.60, processCost: 1.35, labourCost: 0.85 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'BSH-36-ELE-002', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '14 AWG',
            functionName: 'Power Distribution', comparisonName: 'Line Voltage Harness',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Low Voltage Control Harness', description: '18 AWG thermostat and sensor harness',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 140, lengthMm: 900, widthMm: 16, heightMm: 12, quantity: 1,
            cost: { materialCost: 3.20, processCost: 0.95, labourCost: 0.65 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'BSH-36-ELE-003', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '18 AWG',
            functionName: 'Control Signalling', comparisonName: 'Low Voltage Harness',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CONDENSATE,
        parts: [
          {
            name: 'Composite Condensate Drain Pan', description: 'Moulded PP pan, sloped, antimicrobial',
            material: 'PP', finish: 'Antimicrobial',
            weightG: 880, lengthMm: 490, widthMm: 455, heightMm: 42, quantity: 1,
            cost: { materialCost: 7.20, processCost: 3.00, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Condensate Management', commodity: 'Misc',
            partNo: 'BSH-36-CND-001', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: 'Antimicrobial Coating',
            surfaceFinish: 'Antimicrobial Coating', geometryType: 'custom', thicknessMm: 2.8,
            functionName: 'Condensate Collection', comparisonName: 'Condensate Drain Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Condensate Overflow Switch', description: 'Float switch, normally closed, pan-mounted',
            material: 'PA66 / Brass', finish: 'Bare',
            weightG: 65, lengthMm: 78, widthMm: 32, heightMm: 30, quantity: 1,
            cost: { materialCost: 5.40, processCost: 1.20, labourCost: 0.40 },
            makeOrBuy: 'Buy', productCategory: 'Condensate Management', commodity: 'Electrical',
            partNo: 'BSH-36-CND-002', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare', geometryType: 'custom',
            functionName: 'Overflow Protection', comparisonName: 'Condensate Overflow Switch',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.FILTRATION,
        parts: [
          {
            name: 'Return Air Filter', description: 'Pleated MERV 11, 457 x 457 x 25 mm',
            material: 'Polyester Media', finish: 'Bare',
            weightG: 340, lengthMm: 457, widthMm: 457, heightMm: 25, quantity: 1,
            cost: { materialCost: 3.40, processCost: 0.80, labourCost: 0.22 },
            makeOrBuy: 'Buy', productCategory: 'Filtration', commodity: 'Misc',
            partNo: 'BSH-36-FIL-001', uom: 'EA', primaryProcess: 'Media Pleating', secondaryProcess: 'Frame Assembly',
            surfaceFinish: 'Bare', geometryType: 'rectangular', thicknessMm: 25,
            functionName: 'Air Filtration', comparisonName: 'Return Air Filter',
            isFastener: false, similarFlag: true,
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 4. CARRIER FJ5ANXC48L — the middle of the set on cost and weight. 4-ton.
  // =========================================================================
  {
    name: 'FJ5ANXC48L',
    brand: 'Carrier',
    category: 'Residential Air Handling Unit',
    notes:
      'ILLUSTRATIVE DATA — figures are fabricated, not from a real teardown. ' +
      '4-ton multi-position air handler with 5 kW electric heat. Mid-set on cost, weight and part ' +
      'count: 0.9 mm cabinet steel, constant-torque ECM, TXV metering, secondary drain pan.',
    tornDownOn: '2026-07-30T09:45:00Z',
    capturedBy: 'Anindo M.',
    modules: [
      {
        module: MODULES.PACKAGING,
        parts: [
          {
            name: 'Shipping Carton', description: 'Single-wall corrugated, printed, 1400 x 620 x 570 mm',
            material: 'Corrugated Board', finish: 'Printed',
            weightG: 2600, lengthMm: 1400, widthMm: 620, heightMm: 570, quantity: 1,
            cost: { materialCost: 3.45, processCost: 0.44, labourCost: 0.15 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'CAR-48-PKG-001', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Flexo Printing',
            surfaceFinish: 'Printed Kraft', geometryType: 'rectangular', thicknessMm: 4.5,
            functionName: 'Transit Protection', comparisonName: 'Shipping Carton',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Foam Corner Set', description: 'EPS moulded corner protectors, 4 per unit',
            material: 'EPS', finish: 'As-moulded',
            weightG: 105, lengthMm: 185, widthMm: 185, heightMm: 125, quantity: 4,
            cost: { materialCost: 0.48, processCost: 0.20, labourCost: 0.06 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'CAR-48-PKG-002', uom: 'EA', primaryProcess: 'Foam Moulding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom',
            functionName: 'Transit Protection', comparisonName: 'Foam Corner Set',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CABINET,
        parts: [
          {
            name: 'Cabinet Wrapper Panel', description: 'Wrap-around cabinet shell, 0.90 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 9400, lengthMm: 1360, widthMm: 552, heightMm: 552, quantity: 1,
            cost: { materialCost: 11.20, processCost: 4.60, labourCost: 1.20 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'CAR-48-CAB-001', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 0.90,
            unfoldedLengthMm: 2000, unfoldedWidthMm: 570, bends: 4, punches: 14, scrapRatePct: 9.0,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Wrapper Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Base Pan', description: 'Formed base with blower cutout, 1.0 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 3350, lengthMm: 552, widthMm: 528, heightMm: 64, quantity: 1,
            cost: { materialCost: 4.40, processCost: 2.35, labourCost: 0.62 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'CAR-48-CAB-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.0,
            unfoldedLengthMm: 650, unfoldedWidthMm: 610, bends: 6, punches: 10, scrapRatePct: 11.5,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Base Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Access Door Panel', description: 'Single-wall removable service door, 0.90 mm',
            material: 'Galvanised Steel', finish: 'Painted',
            weightG: 2700, lengthMm: 735, widthMm: 528, heightMm: 22, quantity: 1,
            cost: { materialCost: 3.60, processCost: 1.95, labourCost: 0.48 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'CAR-48-CAB-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Powder Coating',
            surfaceFinish: 'Powder Coated (Grey)', geometryType: 'sheet_metal', thicknessMm: 0.90,
            unfoldedLengthMm: 775, unfoldedWidthMm: 568, bends: 4, punches: 6, scrapRatePct: 9.5,
            functionName: 'Service Access', comparisonName: 'Access Door Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Insulation Liner', description: '16 mm foil-faced fibreglass batt',
            material: 'Fibreglass', finish: 'Foil-faced',
            weightG: 1620, lengthMm: 1315, widthMm: 528, heightMm: 16, quantity: 1,
            cost: { materialCost: 3.40, processCost: 0.90, labourCost: 0.38 },
            makeOrBuy: 'Buy', productCategory: 'Insulation', commodity: 'Insulation',
            partNo: 'CAR-48-CAB-004', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Foil Lamination',
            surfaceFinish: 'Foil Faced (FSK)', geometryType: 'custom', thicknessMm: 16,
            functionName: 'Thermal Insulation', comparisonName: 'Cabinet Insulation Liner',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.COIL,
        parts: [
          {
            name: 'Evaporator Coil Slab', description: '3-row A-coil, copper hairpin / aluminium fin, 14 FPI',
            material: 'Copper / Aluminium', finish: 'Bare',
            weightG: 12400, lengthMm: 620, widthMm: 505, heightMm: 470, quantity: 1,
            cost: { materialCost: 66.00, processCost: 20.00, labourCost: 6.60 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Coil',
            partNo: 'CAR-48-COI-001', uom: 'EA', primaryProcess: 'Tube Bending', secondaryProcess: 'Fin Stamping',
            surfaceFinish: 'Bare Aluminium', geometryType: 'circular',
            diameterOuterMm: 9.52, diameterInnerMm: 8.71, wallThicknessMm: 0.405, turns: 28, fpi: 14,
            functionName: 'Heat Transfer', comparisonName: 'Evaporator Coil Slab',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Refrigerant Distributor', description: 'Brass distributor, 6 feeder tubes',
            material: 'Brass', finish: 'Bare',
            weightG: 195, lengthMm: 94, widthMm: 48, heightMm: 35, quantity: 1,
            cost: { materialCost: 4.40, processCost: 1.65, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'CAR-48-COI-002', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Brazing',
            surfaceFinish: 'Bare Brass', geometryType: 'circular',
            diameterOuterMm: 15.9, diameterInnerMm: 14.5, wallThicknessMm: 0.7,
            functionName: 'Refrigerant Distribution', comparisonName: 'Refrigerant Distributor',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Coil Support Rail', description: 'Formed coil end rail, galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 445, lengthMm: 510, widthMm: 50, heightMm: 35, quantity: 2,
            cost: { materialCost: 1.15, processCost: 0.62, labourCost: 0.22 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Bracket', commodity: 'Steel',
            partNo: 'CAR-48-COI-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: null,
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.2,
            unfoldedLengthMm: 530, unfoldedWidthMm: 100, bends: 3, punches: 4, scrapRatePct: 7.0,
            functionName: 'Coil Support', comparisonName: 'Coil Support Rail',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Thermostatic Expansion Valve', description: 'Externally equalised TXV, R-410A, 4-ton',
            material: 'Brass / Steel', finish: 'Bare',
            // Absent on the Goodman, which uses a fixed orifice — one of the
            // clearest "you get what you pay for" comparisons in the set.
            weightG: 285, lengthMm: 96, widthMm: 52, heightMm: 68, quantity: 1,
            cost: { materialCost: 18.40, processCost: 4.20, labourCost: 1.10 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'CAR-48-COI-004', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare Brass', geometryType: 'custom',
            functionName: 'Refrigerant Metering', comparisonName: 'Expansion Valve',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.BLOWER,
        parts: [
          {
            name: 'Blower Housing Assembly', description: 'Galvanised scroll housing with inlet rings',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 4400, lengthMm: 410, widthMm: 388, heightMm: 306, quantity: 1,
            cost: { materialCost: 8.80, processCost: 4.80, labourCost: 1.45 },
            makeOrBuy: 'Make', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'CAR-48-BLW-001', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Spot Welding',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 0.9,
            unfoldedLengthMm: 1210, unfoldedWidthMm: 430, bends: 8, punches: 14, scrapRatePct: 13.5,
            functionName: 'Air Movement', comparisonName: 'Blower Housing',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Direct-Drive Blower Wheel', description: 'Forward-curved centrifugal wheel, 254 mm dia',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 2780, lengthMm: 254, widthMm: 254, heightMm: 240, quantity: 1,
            cost: { materialCost: 7.60, processCost: 3.55, labourCost: 0.98 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'CAR-48-BLW-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Riveting',
            surfaceFinish: 'Galvanised G90', geometryType: 'circular',
            diameterOuterMm: 254, diameterInnerMm: 198,
            functionName: 'Air Movement', comparisonName: 'Blower Wheel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'ECM Constant-Torque Motor', description: '1/2 HP constant-torque ECM, 5-tap',
            material: 'Steel / Copper / NdFeB', finish: 'Painted',
            weightG: 8100, lengthMm: 160, widthMm: 140, heightMm: 140, quantity: 1,
            cost: { materialCost: 52.00, processCost: 12.00, labourCost: 3.60 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Electrical',
            partNo: 'CAR-48-BLW-003', uom: 'EA', primaryProcess: 'Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Painted (Black Enamel)', geometryType: 'circular',
            diameterOuterMm: 140, turns: 300,
            functionName: 'Air Movement Drive', comparisonName: 'Blower Motor',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.ELECTRICAL,
        parts: [
          {
            name: 'Integrated Control Board', description: 'Double-sided board, ECM speed tap control',
            material: 'FR-4 / Mixed', finish: 'HASL',
            weightG: 300, lengthMm: 186, widthMm: 120, heightMm: 36, quantity: 1,
            cost: { materialCost: 26.00, processCost: 5.40, labourCost: 1.60 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Electrical',
            partNo: 'CAR-48-ELE-001', uom: 'EA', primaryProcess: 'PCB Fabrication', secondaryProcess: 'SMT Assembly',
            surfaceFinish: 'HASL', geometryType: 'rectangular', thicknessMm: 1.6,
            functionName: 'System Control', comparisonName: 'Control Board',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Line Voltage Wire Harness', description: '12 AWG line-side harness, heater-ready',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 340, lengthMm: 1200, widthMm: 28, heightMm: 18, quantity: 1,
            cost: { materialCost: 5.10, processCost: 1.45, labourCost: 0.92 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'CAR-48-ELE-002', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '12 AWG',
            functionName: 'Power Distribution', comparisonName: 'Line Voltage Harness',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Low Voltage Control Harness', description: '18 AWG thermostat and sensor harness',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 165, lengthMm: 950, widthMm: 16, heightMm: 12, quantity: 1,
            cost: { materialCost: 3.40, processCost: 1.00, labourCost: 0.68 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'CAR-48-ELE-003', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '18 AWG',
            functionName: 'Control Signalling', comparisonName: 'Low Voltage Harness',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CONDENSATE,
        parts: [
          {
            name: 'Condensate Drain Pan', description: 'Moulded polypropylene primary pan, dual outlet',
            material: 'PP', finish: 'As-moulded',
            weightG: 1180, lengthMm: 546, widthMm: 505, heightMm: 44, quantity: 1,
            cost: { materialCost: 6.80, processCost: 2.90, labourCost: 0.55 },
            makeOrBuy: 'Buy', productCategory: 'Condensate Management', commodity: 'Misc',
            partNo: 'CAR-48-CND-001', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom', thicknessMm: 3.0,
            functionName: 'Condensate Collection', comparisonName: 'Condensate Drain Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Secondary Drain Pan', description: 'Galvanised auxiliary pan under coil',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 940, lengthMm: 560, widthMm: 520, heightMm: 32, quantity: 1,
            cost: { materialCost: 3.20, processCost: 1.70, labourCost: 0.42 },
            makeOrBuy: 'Make', productCategory: 'Condensate Management', commodity: 'Steel',
            partNo: 'CAR-48-CND-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Seam Sealing',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 0.8,
            unfoldedLengthMm: 620, unfoldedWidthMm: 580, bends: 4, punches: 3, scrapRatePct: 10.0,
            functionName: 'Overflow Protection', comparisonName: 'Secondary Drain Pan',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.FILTRATION,
        parts: [
          {
            name: 'Return Air Filter', description: 'Pleated MERV 11, 508 x 508 x 25 mm',
            material: 'Polyester Media', finish: 'Bare',
            weightG: 400, lengthMm: 508, widthMm: 508, heightMm: 25, quantity: 1,
            cost: { materialCost: 2.80, processCost: 0.70, labourCost: 0.22 },
            makeOrBuy: 'Buy', productCategory: 'Filtration', commodity: 'Misc',
            partNo: 'CAR-48-FIL-001', uom: 'EA', primaryProcess: 'Media Pleating', secondaryProcess: 'Frame Assembly',
            surfaceFinish: 'Bare', geometryType: 'rectangular', thicknessMm: 25,
            functionName: 'Air Filtration', comparisonName: 'Return Air Filter',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.HEATER,
        parts: [
          {
            name: 'Electric Heat Element Bank', description: '5 kW nichrome coil bank on ceramic insulators',
            material: 'Nichrome / Ceramic', finish: 'Bare',
            weightG: 1850, lengthMm: 505, widthMm: 300, heightMm: 90, quantity: 1,
            cost: { materialCost: 22.00, processCost: 6.40, labourCost: 2.20 },
            makeOrBuy: 'Buy', productCategory: 'Electric Heat', commodity: 'Electrical',
            partNo: 'CAR-48-HTR-001', uom: 'EA', primaryProcess: 'Coil Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare Nichrome', geometryType: 'custom',
            functionName: 'Supplemental Heating', comparisonName: 'Electric Heat Element Bank',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Heater Limit Switch', description: 'Manual-reset thermal limit, 2 per bank',
            material: 'Bakelite / Bimetal', finish: 'Bare',
            weightG: 55, lengthMm: 46, widthMm: 26, heightMm: 20, quantity: 2,
            cost: { materialCost: 3.20, processCost: 0.85, labourCost: 0.35 },
            makeOrBuy: 'Buy', productCategory: 'Electric Heat', commodity: 'Electrical',
            partNo: 'CAR-48-HTR-002', uom: 'EA', primaryProcess: 'Compression Molding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare', geometryType: 'custom',
            functionName: 'Thermal Safety Cutout', comparisonName: 'Heater Limit Switch',
            isFastener: false, similarFlag: true,
          },
        ],
      },
    ],
  },

  // =========================================================================
  // 5. TRANE — over-engineered. HEAVIEST, most expensive, most parts (25).
  //    Stainless drain pan, double-wall door, corner posts, isolators, 8 kW heat.
  // =========================================================================
  {
    name: '5TEMCB02',
    brand: 'Trane',
    category: 'Residential Air Handling Unit',
    notes:
      'ILLUSTRATIVE DATA — figures are fabricated, not from a real teardown. ' +
      '4-ton communicating air handler with 8 kW electric heat. Heaviest and most expensive in the ' +
      'set: 1.0 mm cabinet steel, double-wall access door, corner posts, stainless drain pan, ' +
      'variable-speed ECM. The over-engineering reference point.',
    tornDownOn: '2026-07-31T11:05:00Z',
    capturedBy: 'Yuvaraj R.',
    modules: [
      {
        module: MODULES.PACKAGING,
        parts: [
          {
            name: 'Shipping Carton', description: 'Double-wall corrugated, printed, 1420 x 640 x 590 mm',
            material: 'Corrugated Board', finish: 'Printed',
            weightG: 3100, lengthMm: 1420, widthMm: 640, heightMm: 590, quantity: 1,
            cost: { materialCost: 4.60, processCost: 0.55, labourCost: 0.18 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'TRN-48-PKG-001', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Flexo Printing',
            surfaceFinish: 'Printed Kraft', geometryType: 'rectangular', thicknessMm: 7.0,
            functionName: 'Transit Protection', comparisonName: 'Shipping Carton',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Foam Corner Set', description: 'EPS moulded corner protectors, 4 per unit',
            material: 'EPS', finish: 'As-moulded',
            weightG: 120, lengthMm: 195, widthMm: 195, heightMm: 130, quantity: 4,
            cost: { materialCost: 0.55, processCost: 0.22, labourCost: 0.06 },
            makeOrBuy: 'Buy', productCategory: 'Packaging', commodity: 'Packaging',
            partNo: 'TRN-48-PKG-002', uom: 'EA', primaryProcess: 'Foam Moulding', secondaryProcess: null,
            surfaceFinish: 'As-Moulded', geometryType: 'custom',
            functionName: 'Transit Protection', comparisonName: 'Foam Corner Set',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CABINET,
        parts: [
          {
            name: 'Cabinet Wrapper Panel', description: 'Wrap-around cabinet shell, 1.00 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 11200, lengthMm: 1380, widthMm: 560, heightMm: 560, quantity: 1,
            cost: { materialCost: 13.60, processCost: 5.40, labourCost: 1.40 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'TRN-48-CAB-001', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.00,
            unfoldedLengthMm: 2040, unfoldedWidthMm: 580, bends: 4, punches: 16, scrapRatePct: 9.5,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Wrapper Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Base Pan', description: 'Formed base with blower cutout, 1.2 mm galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 4100, lengthMm: 560, widthMm: 536, heightMm: 68, quantity: 1,
            cost: { materialCost: 5.60, processCost: 2.80, labourCost: 0.70 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'TRN-48-CAB-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.2,
            unfoldedLengthMm: 660, unfoldedWidthMm: 620, bends: 6, punches: 11, scrapRatePct: 12.0,
            functionName: 'Structural Enclosure', comparisonName: 'Cabinet Base Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Double-Wall Access Door Panel', description: 'Insulated double-wall service door with gasket',
            material: 'Galvanised Steel', finish: 'Painted',
            // Two skins with insulation between, where the other three use a
            // single skin. 33% heavier than the Carrier equivalent for the same
            // job — the clearest single over-engineering data point in the set.
            weightG: 3600, lengthMm: 745, widthMm: 536, heightMm: 32, quantity: 1,
            cost: { materialCost: 6.40, processCost: 3.10, labourCost: 0.72 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'TRN-48-CAB-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Powder Coating',
            surfaceFinish: 'Powder Coated (Charcoal)', geometryType: 'sheet_metal', thicknessMm: 0.90,
            unfoldedLengthMm: 1560, unfoldedWidthMm: 580, bends: 8, punches: 8, scrapRatePct: 11.0,
            functionName: 'Service Access', comparisonName: 'Access Door Panel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Insulation Liner', description: '25 mm foil-faced fibreglass batt',
            material: 'Fibreglass', finish: 'Foil-faced',
            weightG: 2150, lengthMm: 1330, widthMm: 536, heightMm: 25, quantity: 1,
            cost: { materialCost: 4.80, processCost: 1.20, labourCost: 0.45 },
            makeOrBuy: 'Buy', productCategory: 'Insulation', commodity: 'Insulation',
            partNo: 'TRN-48-CAB-004', uom: 'EA', primaryProcess: 'Die Cutting', secondaryProcess: 'Foil Lamination',
            surfaceFinish: 'Foil Faced (FSK)', geometryType: 'custom', thicknessMm: 25,
            functionName: 'Thermal Insulation', comparisonName: 'Cabinet Insulation Liner',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Cabinet Corner Post', description: 'Formed structural corner stiffener, 4 per cabinet',
            material: 'Galvanised Steel', finish: 'Galvanised',
            // Unique to this teardown — the other three achieve cabinet rigidity
            // from the wrapper's own bends alone.
            weightG: 380, lengthMm: 540, widthMm: 42, heightMm: 42, quantity: 4,
            cost: { materialCost: 1.20, processCost: 0.65, labourCost: 0.20 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Cabinet', commodity: 'Steel',
            partNo: 'TRN-48-CAB-005', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: null,
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.2,
            unfoldedLengthMm: 560, unfoldedWidthMm: 90, bends: 3, punches: 6, scrapRatePct: 6.5,
            functionName: 'Structural Reinforcement', comparisonName: 'Cabinet Corner Post',
            isFastener: false, similarFlag: false,
          },
        ],
      },
      {
        module: MODULES.COIL,
        parts: [
          {
            name: 'Evaporator Coil Slab', description: '3-row A-coil, copper hairpin / aluminium fin, 15 FPI',
            material: 'Copper / Aluminium', finish: 'E-coated',
            weightG: 14200, lengthMm: 630, widthMm: 515, heightMm: 480, quantity: 1,
            cost: { materialCost: 74.00, processCost: 23.00, labourCost: 7.40 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Coil',
            partNo: 'TRN-48-COI-001', uom: 'EA', primaryProcess: 'Tube Bending', secondaryProcess: 'Fin Stamping',
            surfaceFinish: 'E-Coat (Epoxy)', geometryType: 'circular',
            diameterOuterMm: 9.52, diameterInnerMm: 8.71, wallThicknessMm: 0.405, turns: 34, fpi: 15,
            functionName: 'Heat Transfer', comparisonName: 'Evaporator Coil Slab',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Refrigerant Distributor', description: 'Brass distributor, 8 feeder tubes',
            material: 'Brass', finish: 'Bare',
            weightG: 215, lengthMm: 98, widthMm: 52, heightMm: 36, quantity: 1,
            cost: { materialCost: 4.80, processCost: 1.75, labourCost: 0.58 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'TRN-48-COI-002', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Brazing',
            surfaceFinish: 'Bare Brass', geometryType: 'circular',
            diameterOuterMm: 15.9, diameterInnerMm: 14.5, wallThicknessMm: 0.7,
            functionName: 'Refrigerant Distribution', comparisonName: 'Refrigerant Distributor',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Coil Support Rail', description: 'Formed coil end rail, galvanised',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 480, lengthMm: 520, widthMm: 52, heightMm: 36, quantity: 2,
            cost: { materialCost: 1.25, processCost: 0.68, labourCost: 0.24 },
            makeOrBuy: 'Make', productCategory: 'Sheet Metal / Bracket', commodity: 'Steel',
            partNo: 'TRN-48-COI-003', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: null,
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.2,
            unfoldedLengthMm: 545, unfoldedWidthMm: 104, bends: 3, punches: 4, scrapRatePct: 7.0,
            functionName: 'Coil Support', comparisonName: 'Coil Support Rail',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Thermostatic Expansion Valve', description: 'Externally equalised TXV, R-410A, 4-ton',
            material: 'Brass / Steel', finish: 'Bare',
            weightG: 295, lengthMm: 98, widthMm: 54, heightMm: 70, quantity: 1,
            cost: { materialCost: 19.20, processCost: 4.40, labourCost: 1.15 },
            makeOrBuy: 'Buy', productCategory: 'Heat Exchanger', commodity: 'Tubing',
            partNo: 'TRN-48-COI-004', uom: 'EA', primaryProcess: 'Machining', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare Brass', geometryType: 'custom',
            functionName: 'Refrigerant Metering', comparisonName: 'Expansion Valve',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.BLOWER,
        parts: [
          {
            name: 'Blower Housing Assembly', description: 'Galvanised scroll housing with inlet rings',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 4900, lengthMm: 420, widthMm: 396, heightMm: 315, quantity: 1,
            cost: { materialCost: 9.60, processCost: 5.20, labourCost: 1.55 },
            makeOrBuy: 'Make', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'TRN-48-BLW-001', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Spot Welding',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 1.0,
            unfoldedLengthMm: 1260, unfoldedWidthMm: 445, bends: 8, punches: 16, scrapRatePct: 14.0,
            functionName: 'Air Movement', comparisonName: 'Blower Housing',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Direct-Drive Blower Wheel', description: 'Forward-curved centrifugal wheel, 267 mm dia',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 3050, lengthMm: 267, widthMm: 267, heightMm: 248, quantity: 1,
            cost: { materialCost: 8.40, processCost: 3.80, labourCost: 1.05 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Steel',
            partNo: 'TRN-48-BLW-002', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'Riveting',
            surfaceFinish: 'Galvanised G90', geometryType: 'circular',
            diameterOuterMm: 267, diameterInnerMm: 206,
            functionName: 'Air Movement', comparisonName: 'Blower Wheel',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'ECM Variable-Speed Motor', description: '1 HP variable-speed ECM with integrated module',
            material: 'Steel / Copper / NdFeB', finish: 'Powder coated',
            weightG: 8600, lengthMm: 170, widthMm: 145, heightMm: 145, quantity: 1,
            cost: { materialCost: 74.00, processCost: 16.00, labourCost: 4.60 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Electrical',
            partNo: 'TRN-48-BLW-003', uom: 'EA', primaryProcess: 'Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Powder Coated', geometryType: 'circular',
            diameterOuterMm: 145, turns: 340,
            functionName: 'Air Movement Drive', comparisonName: 'Blower Motor',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Motor Mount Isolator Set', description: 'EPDM vibration isolators, 4 per motor',
            material: 'EPDM / Steel', finish: 'Bare',
            weightG: 85, lengthMm: 52, widthMm: 34, heightMm: 34, quantity: 4,
            cost: { materialCost: 1.10, processCost: 0.42, labourCost: 0.15 },
            makeOrBuy: 'Buy', productCategory: 'Blower & Motor', commodity: 'Misc',
            partNo: 'TRN-48-BLW-004', uom: 'EA', primaryProcess: 'Compression Molding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare', geometryType: 'custom',
            functionName: 'Vibration Isolation', comparisonName: 'Motor Mount Isolator',
            isFastener: false, similarFlag: false,
          },
        ],
      },
      {
        module: MODULES.ELECTRICAL,
        parts: [
          {
            name: 'Integrated Control Board', description: 'Double-sided board, variable-speed ECM control',
            material: 'FR-4 / Mixed', finish: 'ENIG',
            weightG: 340, lengthMm: 200, widthMm: 128, heightMm: 40, quantity: 1,
            cost: { materialCost: 32.00, processCost: 6.20, labourCost: 1.80 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Electrical',
            partNo: 'TRN-48-ELE-001', uom: 'EA', primaryProcess: 'PCB Fabrication', secondaryProcess: 'SMT Assembly',
            surfaceFinish: 'ENIG (Au/Ni)', geometryType: 'rectangular', thicknessMm: 1.6,
            functionName: 'System Control', comparisonName: 'Control Board',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Communicating Interface Module', description: 'Proprietary 4-wire communicating bus adapter',
            material: 'FR-4 / ABS', finish: 'ENIG',
            weightG: 95, lengthMm: 92, widthMm: 62, heightMm: 24, quantity: 1,
            cost: { materialCost: 24.00, processCost: 4.60, labourCost: 1.20 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Electrical',
            partNo: 'TRN-48-ELE-002', uom: 'EA', primaryProcess: 'PCB Fabrication', secondaryProcess: 'SMT Assembly',
            surfaceFinish: 'ENIG (Au/Ni)', geometryType: 'rectangular', thicknessMm: 1.2,
            // Unique to this teardown — nothing equivalent on the other three.
            functionName: 'System Communication', comparisonName: 'Communicating Interface Module',
            isFastener: false, similarFlag: false,
          },
          {
            name: 'Line Voltage Wire Harness', description: '10 AWG line-side harness, 8 kW heater-ready',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 375, lengthMm: 1250, widthMm: 30, heightMm: 20, quantity: 1,
            cost: { materialCost: 5.60, processCost: 1.55, labourCost: 0.98 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'TRN-48-ELE-003', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '10 AWG',
            functionName: 'Power Distribution', comparisonName: 'Line Voltage Harness',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Low Voltage Control Harness', description: '18 AWG communicating and sensor harness',
            material: 'Copper / PVC', finish: 'PVC Jacket',
            weightG: 180, lengthMm: 980, widthMm: 18, heightMm: 12, quantity: 1,
            cost: { materialCost: 3.60, processCost: 1.05, labourCost: 0.72 },
            makeOrBuy: 'Buy', productCategory: 'Electrical / Controls', commodity: 'Wire',
            partNo: 'TRN-48-ELE-004', uom: 'EA', primaryProcess: 'Wire Harness Assembly', secondaryProcess: 'Crimping',
            surfaceFinish: 'PVC Jacket', geometryType: 'custom', wireGauge: '18 AWG',
            functionName: 'Control Signalling', comparisonName: 'Low Voltage Harness',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.CONDENSATE,
        parts: [
          {
            name: 'Stainless Condensate Drain Pan', description: '304 stainless primary pan, sloped, dual outlet',
            material: 'Stainless Steel 304', finish: 'Mill',
            // Stainless where the other three use moulded polymer: nearly twice
            // the cost of the Carrier pan and heavier, for the same function.
            weightG: 1420, lengthMm: 552, widthMm: 512, heightMm: 44, quantity: 1,
            cost: { materialCost: 12.40, processCost: 4.20, labourCost: 0.65 },
            makeOrBuy: 'Make', productCategory: 'Condensate Management', commodity: 'Steel',
            partNo: 'TRN-48-CND-001', uom: 'EA', primaryProcess: 'Stamping', secondaryProcess: 'TIG Welding',
            surfaceFinish: 'Mill Finish (2B)', geometryType: 'sheet_metal', thicknessMm: 0.8,
            unfoldedLengthMm: 610, unfoldedWidthMm: 570, bends: 4, punches: 3, scrapRatePct: 12.5,
            functionName: 'Condensate Collection', comparisonName: 'Condensate Drain Pan',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Condensate Overflow Switch', description: 'Float switch, normally closed, pan-mounted',
            material: 'PA66 / Brass', finish: 'Bare',
            weightG: 70, lengthMm: 80, widthMm: 34, heightMm: 32, quantity: 1,
            cost: { materialCost: 5.60, processCost: 1.25, labourCost: 0.42 },
            makeOrBuy: 'Buy', productCategory: 'Condensate Management', commodity: 'Electrical',
            partNo: 'TRN-48-CND-002', uom: 'EA', primaryProcess: 'Injection Molding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare', geometryType: 'custom',
            functionName: 'Overflow Protection', comparisonName: 'Condensate Overflow Switch',
            isFastener: false, similarFlag: true,
          },
        ],
      },
      {
        module: MODULES.FILTRATION,
        parts: [
          {
            name: 'Return Air Filter', description: 'Pleated MERV 13, 508 x 508 x 25 mm',
            material: 'Polyester Media', finish: 'Bare',
            weightG: 460, lengthMm: 508, widthMm: 508, heightMm: 25, quantity: 1,
            cost: { materialCost: 4.20, processCost: 0.95, labourCost: 0.25 },
            makeOrBuy: 'Buy', productCategory: 'Filtration', commodity: 'Misc',
            partNo: 'TRN-48-FIL-001', uom: 'EA', primaryProcess: 'Media Pleating', secondaryProcess: 'Frame Assembly',
            surfaceFinish: 'Bare', geometryType: 'rectangular', thicknessMm: 25,
            functionName: 'Air Filtration', comparisonName: 'Return Air Filter',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Filter Rack Frame', description: 'Galvanised filter track with retention clip',
            material: 'Galvanised Steel', finish: 'Galvanised',
            weightG: 620, lengthMm: 540, widthMm: 60, heightMm: 34, quantity: 1,
            cost: { materialCost: 2.40, processCost: 1.30, labourCost: 0.35 },
            makeOrBuy: 'Make', productCategory: 'Filtration', commodity: 'Steel',
            partNo: 'TRN-48-FIL-002', uom: 'EA', primaryProcess: 'Roll Forming', secondaryProcess: 'Punching',
            surfaceFinish: 'Galvanised G90', geometryType: 'sheet_metal', thicknessMm: 0.9,
            unfoldedLengthMm: 560, unfoldedWidthMm: 130, bends: 4, punches: 8, scrapRatePct: 8.0,
            functionName: 'Filter Retention', comparisonName: 'Filter Rack Frame',
            isFastener: false, similarFlag: false,
          },
        ],
      },
      {
        module: MODULES.HEATER,
        parts: [
          {
            name: 'Electric Heat Element Bank', description: '8 kW nichrome coil bank on ceramic insulators',
            material: 'Nichrome / Ceramic', finish: 'Bare',
            weightG: 2250, lengthMm: 515, widthMm: 310, heightMm: 105, quantity: 1,
            cost: { materialCost: 28.00, processCost: 7.60, labourCost: 2.50 },
            makeOrBuy: 'Buy', productCategory: 'Electric Heat', commodity: 'Electrical',
            partNo: 'TRN-48-HTR-001', uom: 'EA', primaryProcess: 'Coil Winding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare Nichrome', geometryType: 'custom',
            functionName: 'Supplemental Heating', comparisonName: 'Electric Heat Element Bank',
            isFastener: false, similarFlag: true,
          },
          {
            name: 'Heater Limit Switch', description: 'Manual-reset thermal limit, 2 per bank',
            material: 'Bakelite / Bimetal', finish: 'Bare',
            weightG: 58, lengthMm: 48, widthMm: 27, heightMm: 21, quantity: 2,
            cost: { materialCost: 3.40, processCost: 0.90, labourCost: 0.36 },
            makeOrBuy: 'Buy', productCategory: 'Electric Heat', commodity: 'Electrical',
            partNo: 'TRN-48-HTR-002', uom: 'EA', primaryProcess: 'Compression Molding', secondaryProcess: 'Assembly',
            surfaceFinish: 'Bare', geometryType: 'custom',
            functionName: 'Thermal Safety Cutout', comparisonName: 'Heater Limit Switch',
            isFastener: false, similarFlag: true,
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Derived fields
// ---------------------------------------------------------------------------

/**
 * Fill in what can be computed rather than hand-written.
 *
 * `moduleName` mirrors the enclosing module and `weightLbs` mirrors `weightG` —
 * both are written out for every part, and writing ~85 of each by hand is 85
 * chances to typo one. Deriving them here means the module name on a part can
 * never disagree with the sub-assembly it lives under.
 */
function fillDerived(moduleName, spec) {
  return {
    ...spec,
    moduleName,
    weightLbs:
      spec.weightG === null || spec.weightG === undefined
        ? null
        : Number((spec.weightG * LBS_PER_GRAM).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Measurement generation
// ---------------------------------------------------------------------------

/**
 * Build the capture records for one part: three dimensions plus a weight.
 *
 * Uses the four specific dimension_ types rather than a generic "dimension",
 * which is what lets the design-engineer view ask "compare heights across
 * products" without having to guess which axis a row refers to.
 *
 * `offsetMin` walks the timestamps forward so the capture history reads like a
 * session someone actually worked through, rather than 100 rows sharing one
 * timestamp.
 */
function buildMeasurements(partId, spec, capturedBy, sessionStart, offsetMin) {
  const rng = makeRng(hashString(`${capturedBy}:${spec.name}`));
  const at = (min) => new Date(sessionStart.getTime() + min * 60_000).toISOString();

  const rows = [];
  const dims = [
    [MEASUREMENT_TYPES.LENGTH, spec.lengthMm],
    [MEASUREMENT_TYPES.WIDTH, spec.widthMm],
    [MEASUREMENT_TYPES.HEIGHT, spec.heightMm],
  ];

  dims.forEach(([type, value], i) => {
    if (value === null || value === undefined) return;
    rows.push({
      partId,
      type,
      value: jitter(rng, value, 0.01), // ±1% — caliper-level variation
      unit: 'mm',
      capturedBy,
      capturedAt: at(offsetMin + i * 0.5),
      // imageUrl stays null: pointing at image files that don't exist on disk
      // would give the UI broken thumbnails during the demo. Wire real paths in
      // once the capture endpoint is actually writing uploads.
      imageUrl: null,
    });
  });

  if (spec.weightG !== null && spec.weightG !== undefined) {
    rows.push({
      partId,
      type: MEASUREMENT_TYPES.WEIGHT,
      value: jitter(rng, spec.weightG, 0.005), // ±0.5% — scales are tighter
      unit: 'g',
      capturedBy,
      capturedAt: at(offsetMin + 2),
      imageUrl: null,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/**
 * Remove the previous seed's fictional split-AC products.
 *
 * Matched on the exact (brand, name) pairs in RETIRED_PRODUCTS — never "anything
 * not in CATALOG", which would also delete teardowns imported through the CEDARS
 * BOM importer. Silent about products that are already gone, so this is a no-op
 * on every run after the first.
 */
async function retireOldProducts() {
  const existing = await products.listProducts();
  const removed = [];

  for (const { brand, name } of RETIRED_PRODUCTS) {
    const match = existing.find((p) => p.brand === brand && p.name === name);
    if (!match) continue;
    // Cascade takes sub-assemblies -> parts -> costs + measurements, and reports.
    await products.deleteProduct(match.id);
    removed.push(`${brand} — ${name}`);
  }

  return removed;
}

async function seedProduct(spec) {
  // 1. Upsert the product itself — stable id across re-runs.
  const product = await products.upsertProduct({
    name: spec.name,
    brand: spec.brand,
    category: spec.category,
    notes: spec.notes,
    // Marks these as demo data in a queryable way, so the repository can show a
    // "Seeded demo data" badge next to fabricated figures. The ILLUSTRATIVE DATA
    // prefix in `notes` stays as well — this is belt AND braces, because the whole
    // risk being managed is someone reading an invented cost as real competitive
    // intelligence.
    source: PRODUCT_SOURCES.SEED,
  });

  // 2. Drop cached reports. A report computed from the previous tree would
  //    still render, still look authoritative, and be wrong.
  await reports.clearForProduct(product.id);

  // 3. Clear the old tree. Deleting sub-assemblies cascades to parts, and parts
  //    cascade to costs and measurements — so this one loop empties everything
  //    below the product.
  const stale = await subAssemblies.listByProduct(product.id);
  for (const sub of stale) {
    await subAssemblies.remove(sub.id);
  }

  // 4. Rebuild.
  const sessionStart = new Date(spec.tornDownOn);
  let offsetMin = 0;
  let partCount = 0;
  let measurementCount = 0;

  for (const moduleSpec of spec.modules) {
    const sub = await subAssemblies.create({
      productId: product.id,
      name: moduleSpec.module,
      description: MODULE_DESCRIPTIONS[moduleSpec.module],
    });

    const partSpecs = moduleSpec.parts.map((p) => fillDerived(moduleSpec.module, p));

    // One transaction per module, and it returns the created rows with their
    // ids — which is exactly why partRepository.createMany wraps individual
    // creates instead of using Prisma's createMany.
    const created = await parts.createMany(sub.id, partSpecs);
    partCount += created.length;

    const batch = [];
    for (let i = 0; i < created.length; i++) {
      const part = created[i];
      const partSpec = partSpecs[i]; // createMany preserves input order

      await costs.upsertForPart(part.id, partSpec.cost);

      batch.push(
        ...buildMeasurements(part.id, partSpec, spec.capturedBy, sessionStart, offsetMin),
      );
      offsetMin += 3;
    }

    // One validated, atomic write per module rather than per part.
    const written = await measurements.createMany(batch);
    measurementCount += written.length;
  }

  return { product, moduleCount: spec.modules.length, partCount, measurementCount };
}

async function main() {
  console.log('Seeding local benchmarking database…\n');

  const retired = await retireOldProducts();
  if (retired.length) {
    console.log('  Retired the previous split-AC seed set:');
    for (const label of retired) console.log(`    − ${label}`);
    console.log('');
  }

  const summary = [];
  for (const spec of CATALOG) {
    const result = await seedProduct(spec);
    summary.push(result);
    console.log(
      `  ✔ ${result.product.brand} — ${result.product.name}\n` +
        `      id=${result.product.id}  ` +
        `${result.moduleCount} modules, ` +
        `${result.partCount} parts, ` +
        `${result.measurementCount} measurements`,
    );
  }

  const totalParts = summary.reduce((sum, r) => sum + r.partCount, 0);
  const totalMeasurements = summary.reduce((sum, r) => sum + r.measurementCount, 0);

  console.log(
    `\nDone. ${summary.length} products, ${totalParts} parts, ` +
      `${totalMeasurements} measurements.\n` +
      'Re-run any time — the result is identical.\n',
  );
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err.message);
    // Non-zero exit so a failed seed can't pass silently in a script chain.
    process.exitCode = 1;
  })
  .finally(async () => {
    // Always disconnect: SQLite buffers writes, and a process that exits
    // without closing can leave a stale -journal file beside dev.db.
    await disconnect();
  });
