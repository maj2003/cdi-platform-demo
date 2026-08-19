-- Backfill Product.source for rows that existed before the column did.
--
-- The column was added with DEFAULT 'manual', which is the right default for a
-- NEW write of unknown provenance but wrong for rows already in an existing
-- development database: seeded products and imported products both landed there
-- before anything was labelling them.
--
-- This is a ONE-TIME correction and it deliberately keys off the `notes` prefix,
-- which is the only provenance signal those rows carry. That same string-matching
-- would be a bad idea in application code — an edited note would silently change a
-- product's provenance — but here the text is known, fixed, and read exactly once.
--
--   "ILLUSTRATIVE DATA…"  written only by src/db/seed.js
--   "Imported from…"      written only by the two BOM parsers
--
-- Re-running the seed also repairs seeded rows (upsertProduct now updates
-- `source`), so this migration's real job is the imported ones, which the seed
-- never touches.

UPDATE "Product" SET "source" = 'seed'   WHERE "notes" LIKE 'ILLUSTRATIVE DATA%';
UPDATE "Product" SET "source" = 'import' WHERE "notes" LIKE 'Imported from%';
