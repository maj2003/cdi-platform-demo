// ---------------------------------------------------------------------------
// src/components/reports/ReportNav.jsx
//
// The report tabs inside Competitive Intelligence.
//
//   Executive Summary · Best-of-Best · Material & Commodity · Polymer Optimization · Ask AI
//
// Executive Summary is first and is the section's landing view, because it is the
// page an executive is meant to see before anything else — the other three are the
// evidence behind it.
//
// ---------------------------------------------------------------------------
// WHY THE SELECTED DESIGNS TRAVEL WITH THE TAB
//
// All four reports describe the same comparison, carried in `?ids=`. Plain links
// would drop it on every tab change and silently re-default the set, so each tab
// preserves the current query string. Switching from cost to commodity then keeps
// answering a question about the same designs, which is the whole reason to have
// them in one section.
// ---------------------------------------------------------------------------

import { NavLink, useLocation } from 'react-router-dom';

import api from '@/lib/api';
import ExportReportPackButton from '@/components/reports/ExportReportPackButton';
import { useReportSelection } from '@/lib/reportSelection';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/intelligence/executive', label: 'Executive Summary' },
  { to: '/intelligence/best-of-best', label: 'Best-of-Best' },
  { to: '/intelligence/material', label: 'Material & Commodity' },
  { to: '/intelligence/polymer', label: 'Polymer Optimization' },
  // Ask keeps its own route and carries no design selection — it is a question box,
  // not a view of a set.
  { to: '/intelligence/ask', label: 'Ask AI', dropParams: true },
];

export default function ReportNav() {
  const { search } = useLocation();
  // The export sits with the tabs because it exports the SET, not one page — all
  // four reports describe the same designs, so the deck does too.
  const { data: products } = useApi(({ signal }) => api.products.list({ signal }), []);
  const { ids } = useReportSelection(products);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
      <nav className="flex flex-wrap gap-1" aria-label="Reports">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={{ pathname: tab.to, search: tab.dropParams ? '' : search }}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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
      <ExportReportPackButton ids={ids} products={products ?? []} />
    </div>
  );
}
