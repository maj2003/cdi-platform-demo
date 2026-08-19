// ---------------------------------------------------------------------------
// src/App.jsx — layout shell and routes.
//
// Routes live here rather than in main.jsx so the layout (header, container)
// wraps every page without each page rendering its own chrome.
//
// ---------------------------------------------------------------------------
// NAVIGATION IS ORGANISED AROUND THE WORKFLOW, NOT AROUND THE PAGES
//
// The app previously exposed Products, Compare, Best-of-Best and Workflow as four
// peer nav items, which made it read as four separate tools. It's now three
// sections in the order a benchmarking study actually happens:
//
//     How To Use  →  New Project  →  Competitive Intelligence Engine
//        (learn)      (capture)            (analyse)
//
// ONE ROUTE MOVED, ONCE, AND IT IS PROTECTED. The repository used to be '/'
// and is now '/products', because '/' became the portal landing page. Its search,
// brand facet and comparison selection are all URL state (?q=, ?brand=, ?sel=), so
// old links carry real information — LandingPage forwards any request arriving with
// those params straight to '/products' with the query string untouched. Every other
// path is untouched: '/products/:id', '/products/:id/capture',
// '/products/:id/ai-parse', '/products/:id/reports', '/compare', '/best-of-best'
// and '/workflow' all still work.
//
// '/workflow' is no longer in the global nav — three sections is the point — but
// the page and its route remain, linked from How To Use as the build-status map.
// ---------------------------------------------------------------------------

import { Link, Route, Routes, useLocation } from 'react-router-dom';
import LandingPage from '@/pages/LandingPage';
import ProductsPage from '@/pages/ProductsPage';
import RequestFormPage from '@/pages/RequestFormPage';
import ProductDetailPage from '@/pages/ProductDetailPage';
import CapturePage from '@/pages/CapturePage';
import AiBomParsePage from '@/pages/AiBomParsePage';
import ReportsPage from '@/pages/ReportsPage';
import ComparePage from '@/pages/ComparePage';
import BestOfBestPage from '@/pages/BestOfBestPage';
import HowToUsePage from '@/pages/HowToUsePage';
import NewProjectPage from '@/pages/NewProjectPage';
import IntelligencePage from '@/pages/IntelligencePage';
import AskPage from '@/pages/AskPage';
import ExecutiveSummaryReport from '@/pages/reports/ExecutiveSummaryReport';
import BestOfBestReport from '@/pages/reports/BestOfBestReport';
import MaterialCommodityReport from '@/pages/reports/MaterialCommodityReport';
import PolymerOptimizationReport from '@/pages/reports/PolymerOptimizationReport';
import WorkflowPage from '@/pages/WorkflowPage';
import { CdiMark } from '@/components/brand/CdiLogo';
import CieSubNav from '@/components/CieSubNav';
import ReportNav from '@/components/reports/ReportNav';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function NotFound() {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Page not found</h2>
      <Button asChild variant="outline" size="sm">
        <Link to="/products">Back to the repository</Link>
      </Button>
    </div>
  );
}

/**
 * Paths that belong to the Competitive Intelligence Engine section.
 *
 * Used for two things: lighting the right global nav tab, and deciding whether to
 * render CieSubNav. Product-scoped pages ('/products/:id/...') are included
 * because a single teardown IS part of the repository — but they get
 * ProductSubNav of their own, so the CIE sub-nav is suppressed there to avoid
 * stacking two tab rows (see CIE_SUBNAV_PATHS).
 */
function isIntelligencePath(pathname) {
  return (
    pathname.startsWith('/products') ||
    pathname.startsWith('/compare') ||
    pathname.startsWith('/best-of-best') ||
    pathname.startsWith('/intelligence')
  );
}

/**
 * Where CieSubNav actually renders — the four SECTION-level analytical pages.
 *
 * Deliberately excludes '/products/:id*': those already carry ProductSubNav
 * (Teardown / Capture / AI BOM parse / Reports), and two stacked tab rows reads
 * as clutter rather than as hierarchy. Matched exactly rather than by prefix so
 * '/products' can't accidentally qualify via '/'.
 */
/**
 * The report views, which carry ReportNav instead of CieSubNav.
 *
 * One tab row, never two: these pages already sit inside Competitive Intelligence,
 * and a second row of section tabs above the report tabs reads as clutter rather
 * than as hierarchy — the same call CIE_SUBNAV_PATHS makes for product pages.
 */
const REPORT_NAV_PATHS = new Set([
  '/intelligence/executive',
  '/intelligence/best-of-best',
  '/intelligence/material',
  '/intelligence/polymer',
  '/intelligence/ask',
]);

const CIE_SUBNAV_PATHS = new Set([
  '/products',
  '/intelligence',
  '/compare',
  '/best-of-best',
]);

/**
 * The three workflow sections.
 *
 * Active state is computed from a path predicate rather than NavLink's default
 * matching, because each section owns several routes — the CIE tab has to stay
 * lit on '/compare' and on a product detail page, neither of which is its own
 * href.
 */
function GlobalNav() {
  const { pathname } = useLocation();
  const links = [
    {
      to: '/request',
      label: 'Request',
      active: pathname.startsWith('/request'),
    },
    {
      to: '/how-to-use',
      label: 'How To Use',
      active: pathname.startsWith('/how-to-use') || pathname.startsWith('/workflow'),
    },
    {
      to: '/new-project',
      label: 'New Project',
      active: pathname.startsWith('/new-project'),
    },
    {
      to: '/intelligence',
      label: 'Competitive Intelligence Engine',
      active: isIntelligencePath(pathname),
    },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            // The active/hover tint is --header-accent (Maya light blue) rather
            // than a plain white overlay — the same "light blue is the ambient
            // active/selected color" rule the rest of the app follows, using the
            // header's own theme-invariant token instead of the page-surface
            // --accent (which varies with light/dark mode, and this nav never
            // does).
            link.active
              ? 'bg-header-accent/30 text-header-foreground'
              : 'text-header-foreground/70 hover:bg-header-accent/20 hover:text-header-foreground',
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const showCieSubNav = CIE_SUBNAV_PATHS.has(pathname);
  const showReportNav = REPORT_NAV_PATHS.has(pathname);

  // Routes that get the whole viewport instead of the reading column. Matched on
  // the path SHAPE, since these carry a product id. See the note above <main>.
  const fullBleed = /^\/products\/\d+\/capture\/?$/.test(pathname);
  // The report views get a WIDER column but stay centred. They are deck artefacts —
  // a nine-column commodity table squeezed into 1152px scrolls sideways inside its
  // own box, which is exactly what a slide must not do — but they are still
  // documents, so edge-to-edge full bleed would be wrong too.
  const wideColumn = showReportNav;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Fixed Daikin cerulean chrome — deliberately not theme-aware (see
          index.css's --header-background note): this bar stays the same blue
          whether the page content below is in light or dark mode. */}
      <header className="border-b border-white/10 bg-header-background text-header-foreground">
        <div
          className={
            fullBleed
              ? 'flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6'
              : 'mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4'
          }
        >
          <div className="flex flex-wrap items-center gap-6">
            {/* CDI is the platform; Daikin is the client it runs for. The second
                line is not small print — it is the relationship, and it is why the
                header says CDI without Daikin disappearing from it. */}
            <Link to="/" className="flex items-center gap-3">
              <CdiMark className="h-9 w-auto shrink-0" onDark />
              <span className="flex flex-col">
                <span className="text-base font-semibold leading-tight tracking-tight">
                  Competitive Decision Intelligence
                </span>
                <span className="text-[11px] text-header-foreground/65">
                  Powered for <span className="font-medium text-header-accent">Daikin</span> Product
                  Benchmarking
                </span>
              </span>
            </Link>
            <GlobalNav />
          </div>
          {/* Local build, no auth. Fake identity + initials avatar so the
              header looks finished; replaced by the Entra ID user on the
              work laptop. */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-header-accent text-xs font-semibold text-accent-foreground"
            >
              DU
            </span>
            <span className="text-sm text-header-foreground/70">Demo user</span>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------------
          WHY ONE ROUTE ESCAPES THE max-w-6xl COLUMN

          Every analytical page in this app is prose-and-tables and reads better
          in a 1152px column than stretched across a 34-inch monitor. The BOM
          Capture workstation is the exception: it is three simultaneous panes —
          the physical object, its measurements, its metadata — and squeezing
          those into 1152px is what forces the scrolling and nesting the redesign
          exists to remove. A teardown lab monitor is the target, so that page
          gets the full width and keeps its own padding.

          Opt-IN by pathname rather than a prop threaded through every page: the
          list of full-bleed routes is one line to read, and a page cannot
          accidentally change the shell's layout from inside itself.
      --------------------------------------------------------------------- */}
      <main
        className={
          fullBleed
            ? 'w-full px-4 py-4 sm:px-6'
            : wideColumn
              ? 'mx-auto max-w-368 space-y-4 px-6 py-8'
              : 'mx-auto max-w-6xl space-y-4 px-6 py-8'
        }
      >
        {showCieSubNav && !fullBleed && <CieSubNav />}
        {showReportNav && !fullBleed && <ReportNav />}

        <Routes>
          {/* ---- Competitive Intelligence Engine (paths unchanged) ---- */}
          {/* The landing page is the front door; the repository moved to
              /products. LandingPage forwards any request arriving with the
              catalog's own URL state (?q=, ?brand=, ?sel=) straight through, so
              old bookmarks of a filtered catalog still land where they did. */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/request" element={<RequestFormPage />} />
          <Route path="/intelligence" element={<IntelligencePage />} />
          {/* The four report views. Executive Summary is the section's landing
              page — the one an executive is meant to see first; the other three
              are the evidence behind it. All four share ?ids= so switching tabs
              keeps answering a question about the same designs. */}
          <Route path="/intelligence/executive" element={<ExecutiveSummaryReport />} />
          <Route path="/intelligence/best-of-best" element={<BestOfBestReport />} />
          <Route path="/intelligence/material" element={<MaterialCommodityReport />} />
          <Route path="/intelligence/polymer" element={<PolymerOptimizationReport />} />
          <Route path="/intelligence/ask" element={<AskPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          {/* Declared after /products/:id, but Router matches by specificity
              rather than order, so the nested paths win regardless. */}
          <Route path="/products/:id/capture" element={<CapturePage />} />
          <Route path="/products/:id/ai-parse" element={<AiBomParsePage />} />
          <Route path="/products/:id/reports" element={<ReportsPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/best-of-best" element={<BestOfBestPage />} />

          {/* ---- the other two workflow sections ---- */}
          <Route path="/how-to-use" element={<HowToUsePage />} />
          <Route path="/new-project" element={<NewProjectPage />} />

          {/* Out of the global nav but still routed — linked from How To Use. */}
          <Route path="/workflow" element={<WorkflowPage />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
