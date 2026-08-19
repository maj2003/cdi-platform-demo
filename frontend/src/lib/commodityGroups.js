// ---------------------------------------------------------------------------
// src/lib/commodityGroups.js
//
// The reference deck's eight commodity rows, and how a real part gets into one.
//
//   Ferrous (sheet steel) · Non-ferrous (Al / Cu) · Polymer / Plastics ·
//   Insulation / Foam · Electrical · Electronics / Controls ·
//   Bought-out (fan, motor) · Fasteners & Hardware
//
// ---------------------------------------------------------------------------
// WHY A CLASSIFIER AND NOT Part.commodity DIRECTLY
//
// `Part.commodity` exists and is populated, but its vocabulary is the importers' —
// Steel, Electrical, Misc, Packaging, Tubing, Wire, Insulation, Coil — and it does
// not line up with the deck's eight rows. "Tubing" is copper, so it is non-ferrous;
// "Wire" is electrical; "Coil" is a copper/aluminium heat exchanger; and "Misc"
// covers a dozen unrelated things.
//
// So each part is classified on the strongest signal available, in order:
//
//   1. MATERIAL   the most specific thing we know. "Galvanised Steel" is ferrous
//                 whatever the commodity column says, and "FR-4" is a circuit board.
//   2. COMMODITY  the importer's grouping, for parts with a vague material.
//   3. NAME       last resort — "Blower Motor" is a bought-out assembly even when
//                 its material reads "Steel / Copper / NdFeB".
//
// ---------------------------------------------------------------------------
// UNCLASSIFIED PARTS ARE COUNTED AND REPORTED, NOT SWEPT INTO "MISC"
//
// A commodity table whose rows do not add up to the BOM total is a table that will
// be quoted wrongly. Anything the rules cannot place is returned in its own bucket
// so the page can say how many parts and how much cost sit outside the eight rows,
// rather than quietly inflating whichever row it was dropped into.
// ---------------------------------------------------------------------------

/** The eight rows, in the reference deck's order. */
export const COMMODITY_GROUPS = Object.freeze([
  { key: 'ferrous', label: 'Ferrous (sheet steel)' },
  { key: 'nonferrous', label: 'Non-ferrous (Al / Cu)' },
  { key: 'polymer', label: 'Polymer / Plastics' },
  { key: 'insulation', label: 'Insulation / Foam' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'electronics', label: 'Electronics / Controls' },
  { key: 'boughtout', label: 'Bought-out (fan, motor)' },
  { key: 'fasteners', label: 'Fasteners & Hardware' },
]);

const norm = (v) => String(v ?? '').toLowerCase();

/**
 * Rules, most specific first. Each returns a group key or null.
 *
 * Order matters and is load-bearing: a blower motor is "Steel / Copper / NdFeB", so
 * the bought-out rule has to run before the ferrous and non-ferrous material rules
 * or every motor lands in the wrong row.
 */
const RULES = [
  // ---- 3-ish: whole assemblies bought in, identified by name ----
  ({ name }) => (/\b(motor|blower wheel|fan|compressor|pump|actuator|transformer)\b/.test(name)
    ? 'boughtout' : null),

  // ---- fasteners, by name (they rarely carry a distinguishing material) ----
  ({ name, commodity }) => (
    /\b(screw|bolt|nut|washer|rivet|clip|fastener|bracket set|grommet|standoff)\b/.test(name)
      || /fastener/.test(commodity) ? 'fasteners' : null),

  // ---- 1: material, the most specific signal ----
  ({ material }) => (/fr-?[24]|pcb|circuit/.test(material) ? 'electronics' : null),
  ({ material }) => (/(^|[^a-z])(eps|epp|epdm)([^a-z]|$)|foam|fibreglass|fiberglass|insulat|mineral wool/
    .test(material) ? 'insulation' : null),
  ({ material }) => (/galvanis|galvaniz|\bsteel\b|\biron\b|\bzinc\b/.test(material)
    && !/copper|aluminium|aluminum|brass/.test(material) ? 'ferrous' : null),
  ({ material }) => (/copper|aluminium|aluminum|brass|bronze/.test(material) ? 'nonferrous' : null),
  ({ material }) => (/\b(abs|pp|ps|pc|pom|pa6|pa66|pvc|hips|pet|nylon|polyester|polypropylene|acrylic|bakelite|resin|plastic)\b/
    .test(material) ? 'polymer' : null),
  ({ material }) => (/nichrome|ceramic|bimetal/.test(material) ? 'electrical' : null),

  // ---- 2: the importer's commodity column ----
  ({ commodity }) => ({
    steel: 'ferrous',
    tubing: 'nonferrous',
    coil: 'nonferrous',
    wire: 'electrical',
    electrical: 'electrical',
    electronics: 'electronics',
    insulation: 'insulation',
    packaging: 'polymer',
  })[commodity] ?? null,

  // ---- 3: name, last resort ----
  ({ name }) => (/\b(board|pcb|control|sensor|thermostat)\b/.test(name) ? 'electronics' : null),
  ({ name }) => (/\b(harness|wire|wiring|relay|contactor|switch|heater element)\b/.test(name)
    ? 'electrical' : null),
  ({ name }) => (/\b(panel|wrapper|pan|rail|frame|cabinet|door)\b/.test(name) ? 'ferrous' : null),
  ({ name }) => (/\b(carton|foam|liner|gasket|insulation)\b/.test(name) ? 'insulation' : null),
];

/**
 * @param {{name?: string, material?: string, commodity?: string}} part
 * @returns {string|null} a COMMODITY_GROUPS key, or null when nothing fits
 */
export function commodityGroupFor(part) {
  const ctx = {
    name: norm(part?.name),
    material: norm(part?.material),
    commodity: norm(part?.commodity),
  };
  for (const rule of RULES) {
    const key = rule(ctx);
    if (key) return key;
  }
  return null;
}

/**
 * Roll one design's parts up into the eight rows.
 *
 * Cost comes from the COST REPORT, not from the part rows — extended cost is the
 * benchmark service's definition and recomputing it here is how two screens start
 * disagreeing about the same BOM. `costByPartId` is that lookup; a part missing from
 * it is counted as uncosted rather than as zero, because one real part in this
 * repository genuinely costs $0.00 and the two must not look the same.
 *
 * @param {Array} parts             every part of one design
 * @param {Map<number, number>} costByPartId  extended cost per part id
 * @returns {{rows: object[], totals: object, unclassified: object}}
 */
export function rollUpByCommodity(parts, costByPartId) {
  const blank = () => ({ parts: 0, units: 0, weightG: 0, cost: 0, uncosted: 0 });
  const acc = new Map(COMMODITY_GROUPS.map((g) => [g.key, blank()]));
  const unclassified = blank();
  unclassified.names = [];

  for (const p of parts ?? []) {
    const key = commodityGroupFor(p);
    const bucket = key ? acc.get(key) : unclassified;
    const qty = Number(p.quantity ?? 1) || 1;
    bucket.parts += 1;
    bucket.units += qty;
    bucket.weightG += (Number(p.weightG) || 0) * qty;
    const cost = costByPartId?.get(p.id);
    if (cost === undefined || cost === null) bucket.uncosted += 1;
    else bucket.cost += cost;
    if (!key) unclassified.names.push(p.name);
  }

  const rows = COMMODITY_GROUPS.map((g) => ({ ...g, ...acc.get(g.key) }));
  const totals = rows.reduce(
    (t, r) => ({
      parts: t.parts + r.parts,
      units: t.units + r.units,
      weightG: t.weightG + r.weightG,
      cost: t.cost + r.cost,
      uncosted: t.uncosted + r.uncosted,
    }),
    { ...blank() },
  );
  // The unclassified bucket is added to the totals so they still reconcile with the
  // BOM — the page reports the bucket separately rather than hiding the difference.
  totals.parts += unclassified.parts;
  totals.units += unclassified.units;
  totals.weightG += unclassified.weightG;
  totals.cost += unclassified.cost;
  totals.uncosted += unclassified.uncosted;

  return { rows, totals, unclassified };
}
