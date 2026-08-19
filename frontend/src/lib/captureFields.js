// ---------------------------------------------------------------------------
// src/lib/captureFields.js — the one description of a capturable dimension.
//
// Both capture modes read this: the workstation's centre pane and the Rapid
// capture wizard. Before the workstation existed the wizard held its own array of
// four fields inline, which was fine while four was the whole list. It isn't any
// more — thickness, diameter and the unfolded pair were added with the
// workstation — and two lists would mean a dimension capturable in one mode and
// invisible in the other.
//
// Mirrors the backend's MEASUREMENT_TYPES and captureService's PART_FIELD_BY_TYPE.
// Duplicated rather than imported for the reason lib/api.js already documents for
// PERSONAS: frontend/ and backend/ are separate npm packages. verify-capture
// asserts the two agree, so a divergence fails a suite instead of silently
// dropping readings.
// ---------------------------------------------------------------------------

/**
 * Every dimension the rig or an engineer can capture.
 *
 * `partField` is the Part column the latest reading resolves into — the server
 * does that write; this is here so the UI can show the current agreed value next
 * to the field being captured.
 *
 * ---------------------------------------------------------------------------
 * `geometries` IS THE VISIBILITY RULE, AND IT COMES FROM THE REVIEW
 *
 * These lists are not a guess at what is "meaningful" — they are the field sets
 * asked for in review, per geometry:
 *
 *   RECTANGULAR   Length, Width, Height, Thickness, Weight, Quantity
 *   SHEET METAL   Thickness, Unfolded Length, Unfolded Width, Weight, Quantity,
 *                 plus an EXTERNAL section (finish + paint thickness) and an
 *                 INTERNAL one — Length, Width and Height HIDDEN
 *   CIRCULAR      Outer Diameter, Inner Diameter, Thickness, Weight, Quantity
 *   CUSTOM        everything
 *
 * The sheet-metal case is the one that looks surprising and is deliberate: a
 * formed panel is measured as a FLAT BLANK plus a thickness, so its folded
 * envelope (L/W/H) is not what anyone records. Showing those three invited
 * someone to fill them in with numbers nothing consumes.
 *
 * CUSTOM shows every field because it is the escape hatch — a part that fits
 * none of the three shapes must not also be the most restricted to describe.
 * ---------------------------------------------------------------------------
 */
export const CAPTURE_FIELDS = Object.freeze([
  {
    type: 'dimension_length',
    label: 'Length',
    unit: 'mm',
    partField: 'lengthMm',
    geometries: ['rectangular', 'custom'],
  },
  {
    type: 'dimension_width',
    label: 'Width',
    unit: 'mm',
    partField: 'widthMm',
    geometries: ['rectangular', 'custom'],
  },
  {
    type: 'dimension_height',
    label: 'Height',
    unit: 'mm',
    partField: 'heightMm',
    geometries: ['rectangular', 'custom'],
  },
  {
    type: 'dimension_diameter',
    label: 'Outer Diameter (OØ)',
    unit: 'mm',
    partField: 'diameterOuterMm',
    geometries: ['circular', 'custom'],
  },
  {
    // Restored to the workstation in this pass. The part-row geometry editor has
    // always offered a bore diameter; the workstation did not, so it could not be
    // captured at the bench at all.
    type: 'dimension_inner_diameter',
    label: 'Inner Diameter (IØ)',
    unit: 'mm',
    partField: 'diameterInnerMm',
    geometries: ['circular', 'custom'],
    // Not a MEASUREMENT_TYPE on the server, so it is written straight to the Part
    // column rather than through the capture endpoint. See `directToPart` below.
    directToPart: true,
  },
  {
    type: 'dimension_thickness',
    label: 'Thickness',
    unit: 'mm',
    partField: 'thicknessMm',
    geometries: ['rectangular', 'sheet_metal', 'circular', 'custom'],
  },
  {
    // EXTERNAL comes first, per the review. A formed panel is painted differently
    // inside and out — external powder coat over internal primer is the normal
    // case — and the two coatings have different thicknesses and different costs,
    // so a single "paint thickness" forced a choice between recording one or the
    // other.
    type: 'external_paint_thickness',
    label: 'External Paint Thickness',
    unit: 'mm',
    partField: 'externalPaintThicknessMm',
    geometries: ['sheet_metal', 'custom'],
    directToPart: true,
    section: 'external',
    isPaintThickness: true,
    hint: 'Coating only, on top of the base thickness',
  },
  {
    type: 'internal_paint_thickness',
    label: 'Internal Paint Thickness',
    unit: 'mm',
    partField: 'internalPaintThicknessMm',
    geometries: ['sheet_metal', 'custom'],
    directToPart: true,
    section: 'internal',
    isPaintThickness: true,
    hint: 'Coating only, on top of the base thickness',
  },
  {
    type: 'unfolded_length',
    label: 'Unfolded Length',
    unit: 'mm',
    partField: 'unfoldedLengthMm',
    geometries: ['sheet_metal', 'custom'],
    hint: 'Measured on the flat blank',
  },
  {
    type: 'unfolded_width',
    label: 'Unfolded Width',
    unit: 'mm',
    partField: 'unfoldedWidthMm',
    geometries: ['sheet_metal', 'custom'],
    hint: 'Measured on the flat blank',
  },
  {
    type: 'weight',
    label: 'Weight',
    unit: 'g',
    partField: 'weightG',
    geometries: ['rectangular', 'sheet_metal', 'circular', 'custom'],
  },
]);

/**
 * Per-face finish, for sheet metal. TEXT, so deliberately not in CAPTURE_FIELDS —
 * everything there is numeric, carries a unit and is convertible between metric and
 * imperial, and a finish name is none of those things.
 *
 * Rendered with the paint thicknesses as an EXTERNAL section then an INTERNAL one,
 * in that order, per the review.
 */
export const FINISH_FIELDS = Object.freeze([
  {
    key: 'externalFinish',
    label: 'External Finish',
    section: 'external',
    geometries: ['sheet_metal', 'custom'],
  },
  {
    key: 'internalFinish',
    label: 'Internal Finish',
    section: 'internal',
    geometries: ['sheet_metal', 'custom'],
  },
]);

/**
 * The face sections, in the order they are rendered: EXTERNAL first, INTERNAL
 * second. A named constant rather than an inline array at the call site, because
 * this order is the requirement itself and a later edit should have to change
 * something obviously named to reverse it.
 */
export const FINISH_SECTIONS = Object.freeze([
  { key: 'external', heading: 'External' },
  { key: 'internal', heading: 'Internal' },
]);

/** Finish options, matching the vocabulary PartInfoEditor already offers. */
export const FINISH_OPTIONS = Object.freeze([
  'Powder Coated', 'Painted', 'Primed', 'Zinc Plated', 'Galvanised',
  'Anodized', 'As-moulded', 'Bare', 'None',
]);

export function finishFieldsForGeometry(geometryType) {
  if (!geometryType) return [];
  return FINISH_FIELDS.filter((f) => f.geometries.includes(geometryType));
}

/**
 * Quantity is shown for EVERY geometry, and is not a measurement.
 *
 * It appeared in all four review lists, and it is not something an instrument
 * reads — it is a count the engineer states. So it writes straight to the Part
 * and gets no Measurement row: a provenance trail saying "the tape measure
 * reported 4 of these" would be a lie about where the number came from.
 */
export const QUANTITY_FIELD = Object.freeze({
  key: 'quantity',
  label: 'Quantity',
  integer: true,
});

/**
 * The four the Rapid capture wizard walks, in its fixed order.
 *
 * Deliberately NOT the full list. The wizard exists for a rig that types one
 * value and sends Enter, and its value is the rhythm — L, W, H, weight, next part,
 * a hundred times over without looking at the screen. Adding four more steps to
 * every part would double the session for dimensions most parts don't have.
 * The workstation is where the full set is captured.
 */
export const RAPID_FIELD_TYPES = Object.freeze([
  'dimension_length',
  'dimension_width',
  'dimension_height',
  'weight',
]);

export const RAPID_FIELDS = Object.freeze(
  RAPID_FIELD_TYPES.map((type) => CAPTURE_FIELDS.find((f) => f.type === type)),
);

/**
 * Fields worth showing for a geometry. Unknown/unset geometry shows the core four.
 *
 * `hidePaintThickness` is a DEMO option, not a data one: the columns stay, the
 * values stay, and only the inputs are withheld. A demo that has not populated
 * paint thickness looks tidier without two empty fields, and hiding them must not
 * quietly discard anything already recorded.
 */
export function fieldsForGeometry(geometryType, { hidePaintThickness = false } = {}) {
  const pool = hidePaintThickness
    ? CAPTURE_FIELDS.filter((f) => !f.isPaintThickness)
    : CAPTURE_FIELDS;
  if (!geometryType) return pool.filter((f) => RAPID_FIELD_TYPES.includes(f.type));
  return pool.filter((f) => f.geometries.includes(geometryType));
}

/**
 * The fields Enter walks through, in order — the DIMENSIONAL capture sequence.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST fieldsForGeometry()
 *
 * The paint thicknesses sit next to `dimension_thickness` in CAPTURE_FIELDS because
 * that is where they belong when the list is read as a definition of a sheet-metal
 * part. They are NOT rendered there: they are rendered inside the External and
 * Internal sections, below the flat measurement list.
 *
 * Walking the raw list therefore sent Enter from Thickness straight to External
 * Paint Thickness — out of the dimensional sequence, into a different section, and
 * (because the armed field is focused) down the pane. Array position was standing in
 * for data-entry order, and the two stopped agreeing the moment the sections were
 * introduced.
 *
 * So the sequence is stated explicitly and derived from the SAME predicate the flat
 * list is rendered from. Adding a field renders it and puts it in the sequence in
 * one step; there is no second ordering to keep in sync.
 *
 * Paint thickness stays MANUALLY armable — click it and the rig types into it, which
 * is right, a coating gauge is a real instrument. It is only excluded as an
 * automatic destination, because arriving there by pressing Enter after a base
 * thickness reading is how a coating value ends up in a base-thickness column.
 */
export function advanceSequenceForGeometry(geometryType, options = {}) {
  return fieldsForGeometry(geometryType, options).filter((f) => !f.isPaintThickness);
}

/** @returns {object|undefined} */
export function fieldByType(type) {
  return CAPTURE_FIELDS.find((f) => f.type === type);
}

/**
 * Geometry options, matching PartGeometryEditor's set and order.
 *
 * Kept here so the workstation's tiles and the part row's editor offer the same
 * four in the same order — an engineer switching between the two screens should
 * not have to re-find "Sheet Metal".
 */
export const GEOMETRY_OPTIONS = Object.freeze([
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'circular', label: 'Circular' },
  { value: 'sheet_metal', label: 'Sheet Metal' },
  { value: 'custom', label: 'Custom' },
]);

/** Integer count fields that belong with the dimensions but are not measurements. */
export const COUNT_FIELDS = Object.freeze([
  { key: 'bends', label: 'No. of Bends', geometries: ['sheet_metal', 'custom'] },
  { key: 'punches', label: 'No. of Punches', geometries: ['sheet_metal', 'custom'] },
  { key: 'turns', label: 'Turns', geometries: ['circular', 'custom'] },
]);

export function countFieldsForGeometry(geometryType) {
  if (!geometryType) return [];
  return COUNT_FIELDS.filter((f) => f.geometries.includes(geometryType));
}
