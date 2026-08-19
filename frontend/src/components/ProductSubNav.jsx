// ---------------------------------------------------------------------------
// src/components/ProductSubNav.jsx
//
// The four views over one product — Teardown, Capture, AI BOM parse, Reports
// — as a single row of tabs. Rendered identically on all four pages so moving
// between them is one click, not "back to teardown, then forward again."
// ---------------------------------------------------------------------------

import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TABS = [
  { to: (id) => `/products/${id}`, label: 'Teardown', end: true },
  { to: (id) => `/products/${id}/capture`, label: 'Capture' },
  { to: (id) => `/products/${id}/ai-parse`, label: 'AI BOM parse' },
  { to: (id) => `/products/${id}/reports`, label: 'Reports' },
];

/** @param {{productId: string|number}} props */
export default function ProductSubNav({ productId }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2" aria-label="Product views">
      {TABS.map((tab) => (
        <NavLink
          key={tab.label}
          to={tab.to(productId)}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              // Active tab uses the ambient light-blue accent (--accent),
              // not the darker --primary — --primary is reserved for
              // elements that need white text, and this tab's text is ink.
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
