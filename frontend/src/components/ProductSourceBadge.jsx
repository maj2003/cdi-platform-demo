// ---------------------------------------------------------------------------
// src/components/ProductSourceBadge.jsx
//
// Where a product's figures came from, said on the product itself.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Until now the repository showed seeded demo data and real imported teardowns as
// visually IDENTICAL rows. The seeded five carry fabricated costs and weights (their
// `notes` open with "ILLUSTRATIVE DATA" for exactly that reason), while an imported
// product carries real figures reconciled against a supplied spreadsheet — and
// nothing on screen distinguished them. Someone could screenshot an invented $499
// competitor cost and circulate it as competitive intelligence.
//
// That is a credibility problem rather than a cosmetic one, which is why provenance
// is a real column (Product.source) and not a string match on the notes prose: an
// edited note must not be able to change what a product claims to be.
//
// One component, used by both the catalog entry and the teardown header, so the two
// can never describe the same product differently.
// ---------------------------------------------------------------------------

import { Badge } from '@/components/ui/badge';

/**
 * Label, tone and tooltip per provenance.
 *
 * Only "seed" gets the warning tone. Being loud about fabricated data is the whole
 * point; an imported or hand-built product needs to be identifiable, not warned
 * about.
 */
const SOURCES = Object.freeze({
  seed: {
    label: 'Seeded demo data',
    className: 'text-warning',
    title: 'Fabricated figures loaded by npm run seed — not from a real teardown.',
  },
  import: {
    label: 'Imported',
    className: '',
    title: 'Created by importing a BOM workbook.',
  },
  manual: {
    label: 'Created in app',
    className: '',
    title: 'Built by hand in the BOM Authoring Workbench.',
  },
});

/** dd Mmm, for the "Imported 5 Aug" form. Undated if the timestamp is missing. */
function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * @param {object} props
 * @param {{source?: string, createdAt?: string}} props.product
 * @param {boolean} [props.withDate=false]  append the creation date, for imported
 *   and hand-built products where "when" is genuinely useful. Seeded data is
 *   whenever the seed last ran, which tells you nothing.
 */
export default function ProductSourceBadge({ product, withDate = false }) {
  // An unrecognised or absent value is NOT guessed at. A product whose provenance
  // was never recorded gets an honest "Unknown source" rather than being quietly
  // presented as hand-built, which is what defaulting would do.
  const known = SOURCES[product?.source];
  const spec = known ?? {
    label: 'Unknown source',
    className: 'text-muted-foreground',
    title: 'This product predates provenance tracking, so where it came from was never recorded.',
  };

  const date = withDate && known && product.source !== 'seed' ? shortDate(product.createdAt) : null;

  return (
    <Badge variant="outline" className={`font-normal ${spec.className}`} title={spec.title}>
      {spec.label}
      {date && ` ${date}`}
    </Badge>
  );
}

export { SOURCES as PRODUCT_SOURCE_LABELS };
