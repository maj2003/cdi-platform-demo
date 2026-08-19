// ---------------------------------------------------------------------------
// src/components/brand/CdiLogo.jsx — the Competitive Decision Intelligence mark.
//
//   ( C  D ▶ )  |  Competitive Decision Intelligence
//                  FROM COMPETITIVE SIGNALS TO STRATEGIC DECISIONS
//
// ---------------------------------------------------------------------------
// WHY IT IS DRAWN RATHER THAN IMPORTED
//
// Inline SVG, not a PNG asset. It stays sharp at any size and on any display,
// carries no asset-pipeline or cache-busting concern, needs no separate dark-mode
// file, and the wordmark stays real text — so it is selectable, searchable and
// readable to a screen reader. The app already takes this approach for
// AhuSilhouette and for the old text wordmark, so this is the established pattern
// rather than a new one.
//
// The mark is three elements, matching the supplied logo:
//   · an open C, drawn as a stroked arc with the indigo → cyan gradient
//   · a D formed from a stem and a bowl, in deep navy
//   · a play triangle in violet — the "decision" half of the mark, and the reason
//     the palette carries a violet at all
//
// ---------------------------------------------------------------------------
// WHY THE GRADIENT IDS ARE INSTANCE-SCOPED
//
// SVG gradient ids are GLOBAL to the document. The header and the landing page
// render this logo at the same time, and two <linearGradient id="cdi-c"> in one
// DOM means whichever mounted last wins for both — a real, silent bug that shows
// up as a logo losing its gradient when a second one appears. So every instance
// gets a unique suffix via useId().
// ---------------------------------------------------------------------------

import { useId } from 'react';

/**
 * The mark alone — the C, the D and the play triangle.
 *
 * @param {object} props
 * @param {string} [props.className]
 * @param {boolean} [props.onDark=false]  swap the navy D for white, so the mark
 *   holds up on the navy header as well as on a white page
 */
export function CdiMark({ className = '', onDark = false }) {
  const uid = useId().replace(/:/g, '');
  const cGrad = `cdi-c-${uid}`;
  const pGrad = `cdi-p-${uid}`;
  const navy = onDark ? '#FFFFFF' : '#141C3A';

  return (
    <svg
      viewBox="0 0 128 120"
      fill="none"
      className={className}
      role="img"
      aria-label="Competitive Decision Intelligence"
    >
      <defs>
        <linearGradient id={cGrad} x1="14" y1="100" x2="96" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3B1FD1" />
          <stop offset="0.45" stopColor="#2E7BF6" />
          <stop offset="1" stopColor="#45C8F5" />
        </linearGradient>
        <linearGradient id={pGrad} x1="98" y1="38" x2="124" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8B4BF0" />
          <stop offset="1" stopColor="#4B1FD1" />
        </linearGradient>
      </defs>

      {/* The C — an arc centred at (54,60), r=40, left open on the right where the
          D and the play triangle sit. The two endpoints are the circle at ∓58°, so
          the opening is a clean 116° rather than an eyeballed gap. */}
      <path
        d="M75.2 26.1 A40 40 0 1 0 75.2 93.9"
        stroke={`url(#${cGrad})`}
        strokeWidth="15"
        strokeLinecap="round"
      />

      {/* The D — stem plus bowl, sitting inside the C's opening. */}
      <rect x="42" y="32" width="14" height="56" rx="3" fill={navy} />
      <path d="M60 32h6a28 28 0 0 1 0 56h-6z" fill={navy} />

      {/* The play triangle — the decision. */}
      <path d="M98 38 124 62 98 86z" fill={`url(#${pGrad})`} />
    </svg>
  );
}

/**
 * The full lock-up: mark, rule, wordmark and tagline.
 *
 * `size` controls the mark; the type scales with it via em-based sizing so the
 * lock-up keeps its proportions wherever it is used.
 *
 * @param {object} props
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.onDark=false]
 * @param {boolean} [props.showTagline=true]
 * @param {string} [props.className]
 */
export default function CdiLogo({
  size = 'md',
  onDark = false,
  showTagline = true,
  stacked = false,
  className = '',
}) {
  const dims = {
    sm: { mark: 'h-8', title: 'text-base', tag: 'text-[8px]', gap: 'gap-2.5' },
    md: { mark: 'h-11', title: 'text-xl', tag: 'text-[9px]', gap: 'gap-3' },
    lg: { mark: 'h-24', title: 'text-4xl sm:text-5xl', tag: 'text-[11px]', gap: 'gap-5' },
  }[size];

  const ink = onDark ? 'text-white' : 'text-[#141C3A]';
  const rule = onDark ? 'bg-white/25' : 'bg-[#141C3A]/15';
  const tagInk = onDark ? 'text-white/70' : 'text-[#5A6485]';

  const wordmark = (
    <>
      <span className={`font-semibold leading-tight tracking-tight ${dims.title} ${ink}`}>
        Competitive{' '}
        {/* "Decision" carries the mark's own blue → violet ramp, exactly as in the
            supplied logo. On dark it stays white: a violet word on navy is the one
            place the gradient stops being legible. */}
        <span
          className={onDark ? '' : 'bg-linear-to-r from-[#2E7BF6] to-[#7B3FE4] bg-clip-text text-transparent'}
        >
          Decision
        </span>{' '}
        Intelligence
      </span>
      {showTagline && (
        <span className={`mt-1 font-medium uppercase tracking-[0.18em] ${dims.tag} ${tagInk}`}>
          From competitive signals to strategic decisions
        </span>
      )}
    </>
  );

  // STACKED for the hero, side-by-side everywhere else. The horizontal lock-up is
  // right in a header bar, where it reads along the same line as the nav; at hero
  // size in a centred column it forces the wordmark to wrap beside the mark and the
  // whole thing goes lopsided. Same parts, arranged for the space they are in.
  if (stacked) {
    return (
      <span className={`flex flex-col items-center gap-4 text-center ${className}`}>
        <CdiMark className={`${dims.mark} w-auto`} onDark={onDark} />
        <span className="flex flex-col items-center">{wordmark}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center ${dims.gap} ${className}`}>
      <CdiMark className={`${dims.mark} w-auto shrink-0`} onDark={onDark} />
      <span aria-hidden className={`h-[2.2em] w-px shrink-0 ${rule}`} />
      <span className="flex flex-col justify-center">{wordmark}</span>
    </span>
  );
}
