// ---------------------------------------------------------------------------
// src/lib/hvacModules.js — the standard HVAC assembly breakdown.
//
// The seventeen modules an air handler is torn down into. Supplied by the review
// as the fixed list, so an engineer starting a teardown never has to invent the
// structure — "do not require manual creation of modules" was the requirement, and
// this is what makes that possible.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A TEMPLATE AND NOT SEVENTEEN ROWS PER PRODUCT
//
// The obvious reading of "load them automatically" is to insert all seventeen
// SubAssembly rows the moment a product is picked. That was rejected, and the
// reason matters: the four imported products already carry the modules their own
// workbooks described — five to eight each. Adding the missing nine to twelve
// would leave every imported teardown padded with permanently empty groups, and
// those groups are not invisible. They would show as empty accordions on the
// teardown page, empty sections in the Engineering BOM view, and empty blocks in
// the Excel export — i.e. we would be asserting that Goodman ships a Humidity
// Control Assembly we simply found no parts in, which is a different claim from
// "their workbook did not mention one".
//
// So the seventeen are always DISPLAYED, matched against whatever the product
// actually has, and a row becomes a real SubAssembly at the moment someone puts a
// part in it. The checklist is complete; the database stays truthful.
//
// ---------------------------------------------------------------------------
// MATCHING IS FUZZY ON PURPOSE
//
// Imported module names are whatever the source workbook called them — "Air
// Filtration Assm", "Coil Assy", "Blower/Fan Assembly". Matching those to the
// template on an exact string would fail on nearly all of them and the checklist
// would claim a product has nothing, next to a teardown that plainly shows parts.
// So each template entry carries `match` keywords and the comparison is done on a
// normalised, de-suffixed name. A wrong match here shows the part count under a
// slightly different heading; a missed match invites someone to create a second
// module that duplicates one that already exists, which is worse.
// ---------------------------------------------------------------------------

/**
 * The standard breakdown, in teardown order.
 *
 * `optional` marks the four the review flagged as not present on every unit. They
 * are still listed — an engineer needs to see that an electric heater was looked
 * for and not found, which an absent row cannot say.
 */
export const HVAC_MODULES = Object.freeze([
  { key: 'packaging', name: 'Packaging Assembly', match: ['packaging', 'packing', 'carton', 'crate'] },
  { key: 'cabinet', name: 'Cabinet Assembly', match: ['cabinet', 'casing', 'enclosure', 'housing', 'chassis'] },
  { key: 'coil', name: 'Coil Assembly', match: ['coil', 'evaporator', 'heat exchanger'] },
  { key: 'blower', name: 'Blower Assembly', match: ['blower', 'fan', 'impeller', 'wheel'] },
  { key: 'electrical', name: 'Electrical Assembly', match: ['electrical', 'wiring', 'harness', 'transformer'] },
  { key: 'refrigeration', name: 'Refrigeration Assembly', match: ['refrigeration', 'refrigerant', 'metering', 'txv', 'expansion'] },
  { key: 'control', name: 'Control System Assembly', match: ['control', 'board', 'pcb', 'thermostat', 'logic'] },
  { key: 'motor', name: 'Motor & Drive Assembly', match: ['motor', 'drive', 'ecm', 'belt', 'pulley'] },
  { key: 'condensate', name: 'Condensate Management Assembly', match: ['condensate', 'drain', 'pan', 'trap'] },
  { key: 'filtration', name: 'Air Filtration Assembly', match: ['filtration', 'filter', 'media'] },
  { key: 'distribution', name: 'Air Distribution Assembly', match: ['distribution', 'duct', 'plenum', 'damper', 'grille', 'louver'] },
  { key: 'insulation', name: 'Insulation Assembly', match: ['insulation', 'insulating', 'liner', 'acoustic'] },
  { key: 'safety', name: 'Safety & Protection Assembly', match: ['safety', 'protection', 'limit', 'fuse', 'guard', 'switch'] },
  { key: 'heater', name: 'Electric Heater Assembly', optional: true, match: ['heater', 'heating element', 'strip heat', 'electric heat'] },
  { key: 'humidity', name: 'Humidity Control Assembly', optional: true, match: ['humidity', 'humidifier', 'dehumidif'] },
  { key: 'iaq', name: 'IAQ/UV Assembly', optional: true, match: ['iaq', 'uv', 'ultraviolet', 'ionis', 'ioniz', 'purif'] },
  { key: 'connectivity', name: 'Connectivity Assembly', optional: true, match: ['connectivity', 'wifi', 'wi-fi', 'gateway', 'iot', 'comms', 'bacnet'] },
]);

/**
 * Product categories offered by the wizard.
 *
 * `match` is how a category finds the products already in the repository. The five
 * seeded teardowns are all filed as "Residential Air Handling Unit", so AHU has to
 * match on the phrase rather than the acronym — a literal 'AHU' comparison would
 * report an empty repository on the one path the demo actually walks.
 */
export const PRODUCT_CATEGORIES = Object.freeze([
  {
    key: 'ahu',
    name: 'AHU',
    fullName: 'Air Handling Units',
    match: ['air handling', 'ahu', 'air handler'],
    // The demo's primary path, so it is stated in the data rather than left to
    // whichever card happens to be rendered first.
    primary: true,
    blurb: 'Residential and light-commercial air handlers — the path this build is deepest on.',
  },
  {
    key: 'ac',
    name: 'Air Conditioners',
    fullName: 'Air Conditioners',
    match: ['air conditioner', 'condition', 'split system', 'cooling'],
    blurb: 'Split and packaged cooling systems.',
  },
  {
    key: 'hp',
    name: 'Heat Pumps',
    fullName: 'Heat Pumps',
    match: ['heat pump'],
    blurb: 'Reversible systems, heating and cooling from one refrigerant circuit.',
  },
  {
    key: 'furnace',
    name: 'Gas Furnaces',
    fullName: 'Gas Furnaces',
    match: ['furnace', 'gas'],
    blurb: 'Gas-fired heating, including the burner and heat-exchanger trains.',
  },
  {
    key: 'package',
    name: 'Package Units',
    fullName: 'Package Units',
    match: ['package', 'packaged', 'rooftop', 'rtu'],
    blurb: 'Single-cabinet rooftop and self-contained units.',
  },
  {
    key: 'iaq',
    name: 'Indoor Air Quality',
    fullName: 'Indoor Air Quality',
    match: ['indoor air', 'iaq', 'air quality', 'purif', 'ventilat'],
    blurb: 'Filtration, purification and ventilation products.',
  },
]);

/** Lower-cased, punctuation-stripped, and with the noise words removed. */
function normalise(name) {
  return String(name ?? '')
    .toLowerCase()
    // 'Assm', 'Assy' and 'Assembly' all mean the same thing and none of them
    // distinguishes one module from another, so they are dropped before matching.
    .replace(/\b(assembly|assemblies|assm|assy|asm)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Which template module a real sub-assembly name corresponds to.
 *
 * Longest keyword first, so "heat exchanger" is read as the coil rather than
 * letting the heater's "heat" claim it. Keyword order within the list does not
 * matter; length does.
 *
 * @param {string} name
 * @returns {string|null} the template key, or null when nothing matches
 */
export function moduleKeyFor(name) {
  const n = normalise(name);
  if (!n) return null;

  let best = null;
  for (const mod of HVAC_MODULES) {
    for (const kw of mod.match) {
      if (n.includes(kw) && (best === null || kw.length > best.length)) {
        best = { key: mod.key, length: kw.length };
      }
    }
  }
  return best?.key ?? null;
}

/**
 * The seventeen modules, each annotated with what the product actually has.
 *
 * Every template entry is returned whether or not the product has it, because the
 * checklist's job is to show the whole breakdown — including the gaps, which are
 * the interesting part when comparing two competitors.
 *
 * A sub-assembly that matches NOTHING in the template is still returned, appended
 * and flagged `extra`. Hiding it would mean a module full of real parts vanished
 * from the one screen claiming to list the product's modules.
 *
 * @param {Array<{id: number, name: string, parts?: Array}>} subAssemblies
 * @returns {Array<object>}
 */
export function modulesForProduct(subAssemblies = []) {
  const byKey = new Map();
  const extras = [];

  for (const sub of subAssemblies) {
    const key = moduleKeyFor(sub.name);
    const entry = {
      id: sub.id,
      actualName: sub.name,
      partCount: sub.parts?.length ?? 0,
      // The parts themselves, not just a count. The review asked to see what is
      // already inside a module without opening another screen, and the teardown
      // response already carries them — so passing them through costs nothing and
      // a second request to list parts we were already handed would be waste.
      parts: sub.parts ?? [],
    };
    // First match wins the slot; a second sub-assembly matching the same key is
    // listed alongside rather than dropped, because two modules both reading as
    // "Coil" is a real thing in imported data and losing one would understate
    // the part count.
    if (key && !byKey.has(key)) byKey.set(key, entry);
    else extras.push({ ...entry, key: null });
  }

  const template = HVAC_MODULES.map((mod) => {
    const actual = byKey.get(mod.key) ?? null;
    return {
      ...mod,
      exists: actual !== null,
      subAssemblyId: actual?.id ?? null,
      // The name the product uses, when it differs from the template's — worth
      // showing, so nobody thinks the app renamed their module.
      actualName: actual?.actualName ?? null,
      partCount: actual?.partCount ?? 0,
      parts: actual?.parts ?? [],
    };
  });

  return [
    ...template,
    ...extras.map((e) => ({
      key: `extra-${e.id}`,
      name: e.actualName,
      match: [],
      extra: true,
      exists: true,
      subAssemblyId: e.id,
      actualName: e.actualName,
      partCount: e.partCount,
      parts: e.parts,
    })),
  ];
}

/**
 * Does this product belong to this category?
 *
 * Matched on the product's own category string rather than an id, because
 * categories are a client-side idea in this build — there is no category table,
 * and inventing one would be the schema expansion this wizard was told to avoid.
 *
 * @param {{category?: string}} product
 * @param {{match: string[]}} category
 */
export function productInCategory(product, category) {
  if (!category) return true;
  const c = String(product?.category ?? '').toLowerCase();
  return category.match.some((kw) => c.includes(kw));
}

/** @returns {object|undefined} */
export function categoryByKey(key) {
  return PRODUCT_CATEGORIES.find((c) => c.key === key);
}
