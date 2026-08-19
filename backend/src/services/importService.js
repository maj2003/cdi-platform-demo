// ---------------------------------------------------------------------------
// src/services/importService.js
//
// The write side of the CEDARS BOM import (see CEDARS_BOM_Import_Spec.md).
//
// ---------------------------------------------------------------------------
// WHERE THE EXCEL PARSING LIVES — AND WHY IT ISN'T HERE
//
// This service takes ALREADY-PARSED JSON. The .xlsx bytes are read in the
// browser by frontend/src/lib/importCedarsBom.js, and only the resulting rows
// are POSTed here. Three reasons, in order of weight:
//
//   1. The xlsx (SheetJS) dependency already exists on the frontend, installed
//      from SheetJS's own CDN because npm's last published build carries two
//      unpatched high-severity advisories (see frontend/package.json). Parsing
//      server-side would mean bringing that same non-npm dependency into the
//      backend for no gain.
//   2. The user gets to SEE what was parsed — module counts, skipped rows,
//      detected variant — and confirm before anything is written. A
//      file-upload-then-commit endpoint can't offer that without either a
//      two-phase upload or holding server state.
//   3. It keeps this service testable with a plain JSON fixture and no binary.
//
// The tradeoff, stated plainly: this endpoint trusts the client to have parsed
// correctly, so it validates the SHAPE of what arrives rather than assuming it.
// If a headless/server-side import is ever needed (a nightly ERP feed, say),
// the parser is pure and dependency-light enough to move here as-is — it
// imports nothing but `xlsx`.
// ---------------------------------------------------------------------------

import { PRODUCT_SOURCES, products, reports } from '../data/index.js';
import { badRequest, HttpError } from '../lib/http.js';

/** Hard ceiling on one import, so a malformed 100k-row payload can't wedge SQLite. */
const MAX_PARTS = 2000;

/**
 * Import a parsed CEDARS BOM as a new product.
 *
 * @param {object} body
 * @param {{name, brand, category, notes?}} body.product
 * @param {Array<object>} body.parts  flat rows, each carrying `moduleName`
 * @param {string} [body.sourceLabel]  which format these rows came from, used in
 *   each module's description. "CEDARS BOM" | "Daikin Mapped BOM".
 * @param {boolean} [body.replaceExisting=false]  delete-and-recreate on a
 *   brand+name collision instead of 409ing
 * @returns {Promise<{product: object, summary: object}>}
 */
export async function importBom(body) {
  const { product, parts: rows, replaceExisting = false } = body ?? {};

  // Which format the rows came from, for the module description only. Two
  // formats now feed this endpoint, and the description used to be hardcoded to
  // "Imported from CEDARS BOM" — so every module of a Daikin Mapped BOM import
  // named the wrong source file on the teardown page. Cosmetic, but it's a
  // provenance label, and a provenance label that lies is worse than none.
  // Length-capped and stripped of newlines because it goes straight into a
  // rendered string.
  const sourceLabel =
    body?.sourceLabel?.toString().replace(/\s+/g, ' ').trim().slice(0, 60) || 'BOM import';

  // ---- validate the product record ---------------------------------------
  const required = ['name', 'brand', 'category'];
  const missing = required.filter((f) => !product?.[f]?.toString().trim());
  if (missing.length) {
    throw badRequest(
      `Import needs product ${missing.join(', ')} — the source file's Key Features / Physical Data sheets normally supply these.`,
    );
  }

  // ---- validate the rows -------------------------------------------------
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest(
      'Import contained no part rows. Every row may have been skipped as a placeholder — check the file has data below the units row.',
    );
  }
  if (rows.length > MAX_PARTS) {
    throw badRequest(`Import is limited to ${MAX_PARTS} parts per product, got ${rows.length}`);
  }

  const unnamed = rows.findIndex((r) => !r?.name?.toString().trim());
  if (unnamed !== -1) {
    throw badRequest(`Part row ${unnamed + 1} has no name — every part needs a Component Name`);
  }
  const unmoduled = rows.findIndex((r) => !r?.moduleName?.toString().trim());
  if (unmoduled !== -1) {
    throw badRequest(
      `Part row ${unmoduled + 1} ("${rows[unmoduled].name}") has no module — the sheet it came from mapped to nothing`,
    );
  }

  // ---- group flat rows into modules --------------------------------------
  // Insertion-ordered Map, so module order follows the order the parser walked
  // the sheets rather than being alphabetised here. Sub-assemblies are read
  // back name-ascending anyway (see TEARDOWN_INCLUDE), so this only decides
  // which id each module gets — but keeping it deterministic makes a re-import
  // of the same file produce the same ids, which makes diffs legible.
  const byModule = new Map();
  for (const row of rows) {
    const key = row.moduleName.toString().trim();
    if (!byModule.has(key)) byModule.set(key, []);

    // `unitCost`/`currency` are lifted off into a nested `cost` object below, so
    // they're destructured away. `moduleName` deliberately STAYS on the part:
    // it's both the grouping key here AND a real Part column, and the first pass
    // at this stripped it out — which left every imported part's moduleName null
    // while the sub-assembly tree looked perfectly correct. Caught by the
    // end-to-end check reading a row back out of SQLite.
    const { unitCost, currency, ...part } = row;
    byModule.get(key).push({
      ...part,
      // A part is "costed" only if the file actually gave a number. 0 is a real
      // value in these files and is NOT the same as absent — see
      // productRepository.createTeardown for why absent means no cost row.
      ...(unitCost === null || unitCost === undefined || unitCost === ''
        ? {}
        : { cost: { materialCost: unitCost, currency: currency || 'USD' } }),
    });
  }

  const modules = [...byModule.entries()].map(([name, moduleParts]) => ({
    name,
    description: `Imported from ${sourceLabel} — ${moduleParts.length} ${
      moduleParts.length === 1 ? 'part' : 'parts'
    }`,
    parts: moduleParts,
  }));

  // ---- replace-on-collision (opt-in) -------------------------------------
  if (replaceExisting) {
    // Looked up through listProducts rather than a dedicated findByNaturalKey:
    // the list is three-to-six rows in this app and adding a repository method
    // for one caller isn't worth it. Revisit if the product count ever grows.
    const clash = (await products.listProducts()).find(
      (p) => p.brand === product.brand.trim() && p.name === product.name.trim(),
    );
    if (clash) {
      // Cascade takes the sub-assemblies, parts, costs, measurements and cached
      // reports with it. Destructive and opt-in only — never the default.
      await products.deleteProduct(clash.id);
    }
  }

  // ---- write -------------------------------------------------------------
  let created;
  try {
    created = await products.createTeardown({
      product: {
        name: product.name.trim(),
        brand: product.brand.trim(),
        category: product.category.trim(),
        notes: product.notes?.toString().trim() || null,
        // Not taken from the request body: an import IS an import, whatever the
        // client says. Letting the caller choose would let real competitor data be
        // labelled "seeded demo data" and vice versa, which defeats the point of
        // having the column.
        source: PRODUCT_SOURCES.IMPORT,
      },
      modules,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new HttpError(
        409,
        `A teardown for "${product.brand} ${product.name}" already exists. Re-import with "replace existing" to overwrite it.`,
      );
    }
    // partRepository/costRepository normalisers throw plain Errors on bad input
    // (bad geometryType, non-numeric dimension). That's the client's mistake,
    // not a server fault — same relabelling partService.updatePart does.
    throw badRequest(err.message);
  }

  // A brand-new product has no cached reports, and a REPLACED one had its cached
  // reports removed by the cascade. So this is belt-and-braces rather than a fix
  // for a known case — kept because it is cheap and because every other write path
  // clears reports, so an import that didn't would be the odd one out.
  //
  // It is NOT protecting against id reuse: Product.id is INTEGER PRIMARY KEY
  // AUTOINCREMENT, which SQLite never reuses (an earlier version of this comment
  // claimed otherwise — deleted product ids in this database have only ever
  // increased, 63 and 73-76 never came back).
  await reports.clearForProduct(created.id);

  return { product: created, summary: summarise(created) };
}

/**
 * Per-module and per-commodity counts, read back off what was actually written.
 *
 * Deliberately computed from the CREATED rows rather than echoing the client's
 * own tallies: the point of a summary is to confirm what landed in the
 * database, and a number the client supplied confirms nothing. Costs and
 * weights are counts and sums of stored columns only — the real cost/weight
 * rollups belong to benchmarkService, which the UI fetches separately.
 */
function summarise(created) {
  const allParts = created.subAssemblies.flatMap((s) => s.parts);

  const tally = (keyFn) => {
    const out = {};
    for (const part of allParts) {
      const key = keyFn(part) ?? 'Unassigned';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };

  return {
    productId: created.id,
    modules: created.subAssemblies.map((s) => ({ name: s.name, parts: s.parts.length })),
    byCommodity: tally((p) => p.commodity),
    byGeometryType: tally((p) => p.geometryType),
    partLines: allParts.length,
    partUnits: allParts.reduce((sum, p) => sum + (p.quantity ?? 1), 0),
    costedParts: allParts.filter((p) => p.costs.length > 0).length,
    weighedParts: allParts.filter((p) => p.weightG !== null).length,
  };
}
