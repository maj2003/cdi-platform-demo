// ---------------------------------------------------------------------------
// src/components/CieSubNav.jsx
//
// The four views inside the Competitive Intelligence Engine — Overview,
// Repository, Comparison, Best-of-Best — as one row of tabs.
//
// This is the piece that turns four formerly top-level nav items into one
// section. Rendered from App.jsx's layout rather than added to each page, so the
// existing pages stay untouched: the whole point of this restructure was to
// reorganise without redesigning what already works.
//
// Same visual treatment as ProductSubNav, deliberately — a second style of
// sub-navigation would make the two levels look unrelated when they're the same
// idea at different depths.
//
// Persona Reports isn't a tab because it's product-scoped: there is no
// "/reports" that means anything without saying which teardown. It's reachable
// from the Overview tab and from any product's own sub-nav.
// ---------------------------------------------------------------------------

import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TABS = [
  // `end` on both of these for the same reason, one route apart: '/' is a prefix
  // of every route in the app, and '/intelligence' is a prefix of
  // '/intelligence/ask' — without it, Overview would stay lit while you're on
  // the Ask tab.
  { to: '/intelligence', label: 'Overview', end: true },
  { to: '/products', label: 'Repository', end: true },
  { to: '/compare', label: 'Comparison' },
  { to: '/best-of-best', label: 'Best-of-Best' },
  { to: '/intelligence/executive', label: 'Reports' },
];

export default function CieSubNav() {
  return (
    <nav
      className="flex flex-wrap gap-1 border-b pb-2"
      aria-label="Competitive Intelligence Engine views"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              // Ambient light-blue accent for the active tab, not --primary:
              // primary is reserved for elements carrying white text, and this
              // tab's text is ink.
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/15 hover:text-foreground',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
