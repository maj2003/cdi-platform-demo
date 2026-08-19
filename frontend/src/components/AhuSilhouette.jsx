// ---------------------------------------------------------------------------
// src/components/AhuSilhouette.jsx
//
// Generic air-handler line drawing: cabinet, access panel, A-coil, blower.
//
// A SCHEMATIC, NOT A PHOTO, and that distinction is deliberate. There are no
// product photos in this build (part photos exist; unit photos do not), and
// dropping in stock imagery of a real competitor cabinet would put a picture of
// one manufacturer's unit next to another manufacturer's cost data. A neutral
// line drawing says "air handler" without claiming to be any particular one.
//
// Lifted out of ProductCatalogEntry when the New Project wizard needed the same
// drawing on its product cards. Two copies of an SVG is two things to keep in
// sync for no benefit, and the catalog and the wizard showing subtly different
// air handlers would look like a bug.
//
// Uses `currentColor` throughout so the caller controls it with a text colour and
// it re-themes for free. `aria-hidden` because it carries no information the
// surrounding text does not already state.
// ---------------------------------------------------------------------------

/** @param {{className?: string}} props */
export default function AhuSilhouette({ className = '' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 160 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* cabinet */}
      <rect x="26" y="14" width="108" height="172" rx="6" />
      {/* supply opening, top */}
      <path d="M48 14v-6h64v6" />
      {/* access panel seam + handle */}
      <path d="M26 74h108" />
      <path d="M118 60h8" />
      {/* A-coil */}
      <path d="M44 66 80 30l36 36" />
      <path d="M58 66 80 44l22 22" />
      {/* blower housing */}
      <circle cx="80" cy="126" r="26" />
      <circle cx="80" cy="126" r="8" />
      {/* blower blades */}
      <path d="M80 100v10M80 142v10M54 126h10M96 126h10" />
      {/* drain pan */}
      <path d="M34 168h92" />
      {/* feet */}
      <path d="M40 186v6M120 186v6" />
    </svg>
  );
}
