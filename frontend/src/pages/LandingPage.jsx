// ---------------------------------------------------------------------------
// src/pages/LandingPage.jsx — route /
//
// The front door: branding, one search box, three actions. Nothing else.
//
// ---------------------------------------------------------------------------
// WHAT WAS BORROWED, AND WHAT WASN'T
//
// The reference was the MyHCLTech portal, and the brief was explicit that we are
// not cloning it — we are borrowing the interaction model. What that means
// concretely: search is the primary affordance rather than navigation, the
// branding area is large enough to read as a product, and the key actions sit
// directly under the search box instead of in a sidebar.
//
// What was deliberately NOT borrowed: the announcement ribbon, the app-tile grid,
// the news cards, the floating widgets. Those exist because an intranet homepage
// is a directory of hundreds of unrelated tools. This is one tool with three
// entry points, and a grid of tiles pretending otherwise would be theatre.
//
// ---------------------------------------------------------------------------
// WHY THE SEARCH BOX SHOWS RESULTS INLINE
//
// A search-first page whose search only navigates elsewhere is a redirect with a
// hero image. Typing here matches against the repository immediately — brand,
// model, category, notes, via the same lib/productSearch.js the catalog uses, so
// this box and that page can never disagree about what matches. Enter (or "See
// all") hands off to /products?q=… with the query intact, which is also how a
// result gets shared.
//
// ---------------------------------------------------------------------------
// WHY / MOVED AND WHAT PROTECTS THE OLD LINKS
//
// The repository used to live here and now lives at /products. Its search, brand
// facet and comparison selection are all URL state (?q=, ?brand=, ?sel=), so old
// links carry real information. Rather than break them, this page forwards any
// request that arrives WITH those params straight to /products with the query
// string untouched — a bookmark of a filtered, half-selected catalog still lands
// exactly where it did.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, Boxes, FileText, FolderPlus, Search, Send, Sparkles } from 'lucide-react';

import api from '@/lib/api';
import CdiLogo from '@/components/brand/CdiLogo';
import { filterProducts } from '@/lib/productSearch';
import { useApi } from '@/lib/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The three ways in.
 *
 * Ordered as the workflow runs — a request comes in, it becomes a project, the
 * project produces intelligence — rather than by how finished each one is.
 */
const ACTIONS = [
  {
    to: '/request',
    icon: Send,
    label: 'Request Form',
    blurb: 'Ask for a competitive evaluation. Goes to the benchmarking team.',
  },
  {
    to: '/new-project',
    icon: FolderPlus,
    label: 'New Project',
    blurb: 'Start a teardown: pick a category, add competitors, capture the BOM.',
  },
  {
    to: '/intelligence',
    icon: BarChart3,
    label: 'Competitive Intelligence',
    blurb: 'Compare cost and weight, run Best-of-Best, export the deck.',
  },
];

/**
 * The quieter row: places you go when you already know what you want.
 *
 * Separated from the three above rather than making six equal tiles. Six tiles is
 * a directory; three plus three is a workflow with shortcuts, and the difference
 * is the whole reason the primary row is only three.
 */
const SECONDARY = [
  { to: '/intelligence/executive', icon: FileText, label: 'Reports' },
  { to: '/products', icon: Boxes, label: 'Repository' },
  { to: '/intelligence/ask', icon: Sparkles, label: 'Ask AI' },
];

/** How many inline matches to show before deferring to the full catalog. */
const INLINE_LIMIT = 5;

export default function LandingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  // A bookmark of the old catalog URL. Forwarded before anything else renders, so
  // there is no flash of a landing page on the way through.
  const legacyCatalogLink = ['q', 'brand', 'sel'].some((k) => params.has(k));

  const { data: products } = useApi(({ signal }) => api.products.list({ signal }), []);

  const trimmed = query.trim();
  const matches = useMemo(
    () => (trimmed ? filterProducts(products ?? [], { query: trimmed }) : []),
    [products, trimmed],
  );

  if (legacyCatalogLink) {
    return <Navigate to={`/products?${params.toString()}`} replace />;
  }

  const submit = (event) => {
    event.preventDefault();
    // An empty search opens the whole repository rather than doing nothing —
    // pressing Enter on a blank box reads as "show me everything".
    navigate(trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : '/products');
  };

  return (
    <div className="space-y-10">
      {/* ================= hero =================
          The Daikin cerulean → Maya light blue ramp, the same two brand colours
          the header and the ambient accent use, so the page reads as part of the
          product rather than a differently-branded splash screen.

          FULL-BLEED out of the app's max-w-6xl reading column. Every analytical
          page in this app wants that column, so the shell applies it globally and
          only the capture workstation opts out (see App.jsx). A hero that stops at
          the column edges reads as a large card, not as a portal — so rather than
          add a second exception to the shell for one section of one page, this
          escapes locally: full viewport width, pulled back to centre. `left-1/2`
          plus a half-width translate is the standard way out of a centred column
          and needs nothing from the layout above it. */}
      {/* Sized with margins rather than w-screen: 100vw INCLUDES the scrollbar, so
          w-screen on a page tall enough to scroll overflows horizontally by the
          scrollbar's width. `50% - 50vw` gutters reach the viewport edge without
          ever exceeding the available width. */}
      <section className="-mt-8 mx-[calc(50%-50vw)] overflow-hidden bg-linear-to-br from-[#0b1330] via-[#1d3a8f] to-[#2E7BF6] px-6 pb-12 pt-14 text-white">
        <div className="mx-auto max-w-3xl space-y-7 text-center">
          <div className="space-y-4">
            {/* The platform's own mark, at hero size. Drawn, not imported — see
                CdiLogo for why. The tagline is part of the lock-up, so it is not
                repeated as a separate line underneath. */}
            <div className="flex justify-center">
              <CdiLogo size="lg" onDark stacked />
            </div>
            <h1 className="sr-only">
              Competitive Decision Intelligence — from competitive signals to strategic decisions
            </h1>
            <p className="mx-auto max-w-2xl text-base text-white/85">
              AI-powered product benchmarking, teardown analysis, competitive intelligence and
              design optimization.
            </p>
            {/* The client relationship, stated on the front door rather than only
                in the header. CDI is the platform; Daikin is who it runs for. */}
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/60">
              Powered for Daikin Product Benchmarking
            </p>
          </div>

          {/* ---- the search box ---- */}
          <form onSubmit={submit} className="mx-auto max-w-2xl">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a brand, model or category — Carrier, FJ5ANXC48L, air handler"
                aria-label="Search the product benchmark repository"
                className="h-14 rounded-full border-0 bg-white pl-12 pr-32 text-base text-foreground shadow-lg placeholder:text-muted-foreground/70 focus-visible:ring-4 focus-visible:ring-white/40"
              />
              <Button
                type="submit"
                className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-full px-5"
              >
                Search
              </Button>
            </div>

            {/* Inline matches. Rendered only while there is a query, so the page
                is quiet by default — an always-open results panel would make the
                hero feel like a search-results page nobody asked for. */}
            {trimmed !== '' && (
              <div className="mx-auto mt-3 max-w-2xl overflow-hidden rounded-xl bg-white text-left text-foreground shadow-xl">
                {matches.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    Nothing in the repository matches “{trimmed}”. It may not have been torn
                    down yet — <Link to="/request" className="underline">request an evaluation</Link>.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {matches.slice(0, INLINE_LIMIT).map((p) => (
                      <li key={p.id}>
                        <Link
                          to={`/products/${p.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/10"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {p.brand} {p.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.category}
                            </span>
                          </span>
                          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                    {matches.length > INLINE_LIMIT && (
                      <li>
                        <button
                          type="submit"
                          className="w-full px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-accent/10"
                        >
                          See all {matches.length} matches
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </form>
        </div>
      </section>

      {/* ================= the three actions =================
          Directly under the search box, which is the part of the reference layout
          that matters: the actions are the fallback for someone who does not know
          what to search for. */}
      <section className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
        {ACTIONS.map(({ to, icon: Icon, label, blurb }) => (
          <Link
            key={to}
            to={to}
            className="group flex flex-col gap-2 rounded-xl border bg-card p-5 transition-colors hover:border-accent hover:bg-accent/5"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent/15 text-primary">
              <Icon aria-hidden className="size-5" />
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {label}
              <ArrowRight
                aria-hidden
                className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">{blurb}</span>
          </Link>
        ))}
      </section>

      {/* ================= secondary actions =================
          Quieter, and deliberately not a fourth/fifth/sixth tile: six equal tiles
          is a directory, three plus three is a workflow with shortcuts. */}
      <section className="mx-auto max-w-4xl border-t pt-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {SECONDARY.map(({ to, icon: Icon, label }) => (
            <Button key={to} asChild variant="outline" size="sm">
              <Link to={to}>
                <Icon className="mr-1.5 size-4" />
                {label}
                {to === '/products' && products ? ` (${products.length})` : ''}
              </Link>
            </Button>
          ))}
        </div>
        {/* The capability statement. It is what makes the platform read as
            capable of more than BOM capture, which is the point of the rebrand. */}
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Product benchmarking · Competitive intelligence · Cost reduction analysis · Design
          optimization · Executive reporting
        </p>
      </section>
    </div>
  );
}
