// ---------------------------------------------------------------------------
// src/components/reports/slide/SlideKit.jsx
//
// The report deck's visual vocabulary, as components: the frame, the KPI card, the
// navy-headed table, the highlight cells and the closing insight banner.
//
// ---------------------------------------------------------------------------
// WHY ONE KIT AND NOT FOUR HAND-BUILT PAGES
//
// The four reports are the same slide in four arrangements — dark navy header row,
// zebra body, a highlighted winner cell, a totals row, a full-width takeaway banner
// at the foot. Building each page from raw markup would mean four slightly different
// navies and four slightly different table paddings within a week, and the whole
// point of the reference deck is that the set reads as ONE document.
//
// It also makes the eventual PPT export tractable: the slide structures are declared
// in one place, so an exporter has something to walk rather than four pages of JSX.
//
// ---------------------------------------------------------------------------
// WHY THE COLOURS ARE FIXED RATHER THAN THEME TOKENS
//
// These pages are print/deck artefacts — screenshotted into decks and exported to
// PowerPoint. The reference is a white slide with a specific navy and a specific
// green, and a report that changes colour with the viewer's OS theme would not match
// the deck it is supposed to reproduce. So the slide surface stays light and the
// palette is stated here explicitly, deliberately opting OUT of the app's light/dark
// theming for this one surface. Everything around it (nav, chrome) still themes.
// ---------------------------------------------------------------------------

import { CdiMark } from '@/components/brand/CdiLogo';
import { DECK } from './deckTheme';

/**
 * One report page.
 *
 * `footnote` is not decoration — every table in the reference carries a legend
 * explaining what the highlight means and whether the figures are illustrative, and
 * a benchmarking table without that legend is a table someone will quote.
 */
export function SlideFrame({ title, subtitle, kicker, footnote, children, banner }) {
  return (
    <section
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{ background: DECK.surface, borderColor: DECK.rule, color: DECK.bodyText }}
      data-testid="slide-frame"
    >
      {/* ---- report identity band ----
          The CDI mark on every report, with Daikin named as the client. A report
          gets screenshotted out of the application and pasted into a deck, and at
          that point the band is the only thing saying where the figures came from.
          Which is also why the client is on it: an unattributed benchmark table is
          a table nobody can place. */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
        style={{ background: DECK.navy }}
        data-testid="report-brand-band"
      >
        <CdiMark className="h-7 w-auto shrink-0" onDark />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white">
            Competitive Decision Intelligence
          </span>
          <span className="text-[10px] text-white/60">
            From competitive signals to strategic decisions
          </span>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-white/70">
          Prepared for <span className="font-semibold" style={{ color: DECK.daikin }}>Daikin</span>
        </span>
      </div>

      <div className="space-y-5 p-6">
      <header className="space-y-1.5">
        {kicker && (
          <p
            className="text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: DECK.accent }}
          >
            {kicker}
          </p>
        )}
        <h2 className="text-2xl font-semibold tracking-tight" style={{ color: DECK.ink }}>
          {title}
        </h2>
        {subtitle && <p className="max-w-4xl text-sm" style={{ color: '#5a6485' }}>{subtitle}</p>}
      </header>

      {children}

      {footnote && (
        <p className="text-[11px]" style={{ color: '#7a839f' }}>{footnote}</p>
      )}

      {banner}
      </div>
    </section>
  );
}

/**
 * A headline number. Five of these run across the top of the executive summary.
 *
 * `caveat` marks a figure that is illustrative rather than measured — the deck's own
 * numbers are a worked example, and a KPI card is exactly the element someone
 * screenshots without the surrounding page.
 */
export function KpiCard({ value, label, caveat }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-lg border px-4 py-5 text-center"
      style={{ borderColor: DECK.rule, background: DECK.surface }}
      data-testid="kpi-card"
    >
      <span className="text-3xl font-semibold leading-none" style={{ color: DECK.winText }}>
        {value}
      </span>
      <span className="text-sm font-medium" style={{ color: DECK.bodyText }}>{label}</span>
      {caveat && <span className="text-[10px]" style={{ color: '#8b93ad' }}>{caveat}</span>}
    </div>
  );
}

export function KpiRow({ children }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="kpi-row">
      {children}
    </div>
  );
}

/**
 * The navy-headed table.
 *
 * `columns` entries: { key, label, align, width, group }. `group` builds the
 * two-row header the commodity slide needs (Design A spanning Parts / Wt / Cost).
 *
 * Horizontal scroll is on the WRAPPER, not the page: a nine-column commodity table
 * on a laptop must scroll inside its own box rather than making the whole report
 * scroll sideways.
 */
export function SlideTable({ columns, groups, rows, caption }) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: DECK.rule }}>
      <table className="w-full border-collapse text-sm" data-testid="slide-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          {groups && (
            <tr style={{ background: DECK.navy, color: '#fff' }}>
              {groups.map((g, i) => (
                <th
                  key={`${g.label}-${i}`}
                  colSpan={g.span ?? 1}
                  rowSpan={g.rowSpan ?? 1}
                  scope="colgroup"
                  className="px-3 py-2 text-center text-xs font-semibold"
                  style={{ borderRight: `1px solid ${DECK.navySoft}` }}
                >
                  {g.label}
                </th>
              ))}
            </tr>
          )}
          <tr style={{ background: groups ? DECK.navySoft : DECK.navy, color: '#fff' }}>
            {columns
              // A column already covered by a rowSpan=2 group header must NOT emit a
              // second cell here. Emitting one pushes every following header a column
              // to the right, so "Parts" lands over the weight figures and the whole
              // table reads wrong while looking plausible — the worst kind of table
              // bug. `spanned: true` on the column is how a page declares that its
              // header lives in the group row above.
              .filter((c) => !(groups && c.spanned))
              .map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2 text-xs font-semibold ${
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                  style={{ borderRight: `1px solid ${DECK.navySoft}`, width: c.width }}
                >
                  {c.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={row.key ?? ri}
              style={{
                background: row.emphasis === 'total'
                  ? '#e8edf8'
                  : row.emphasis === 'alert'
                    ? DECK.alert
                    : ri % 2 === 1 ? DECK.zebra : DECK.surface,
                borderTop: `1px solid ${DECK.rule}`,
                fontWeight: row.emphasis === 'total' ? 600 : undefined,
              }}
            >
              {columns.map((c) => {
                const cell = row.cells[c.key];
                // A cell is either a bare value or { value, highlight } — the
                // highlight is what carries "this design wins this row", which is
                // the single most-read thing on every table in the deck.
                const value = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
                const highlight = cell && typeof cell === 'object' ? cell.highlight : null;
                const bg = highlight === 'win' ? DECK.win
                  : highlight === 'alert' ? DECK.alert
                    : highlight === 'gap' ? DECK.gap : undefined;
                const fg = highlight === 'win' ? DECK.winText
                  : highlight === 'alert' ? DECK.alertText
                    : highlight === 'gap' ? DECK.gapText
                      : row.emphasis === 'alert' ? DECK.alertText : undefined;
                return (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${
                      c.align === 'right' ? 'text-right tabular-nums'
                        : c.align === 'center' ? 'text-center tabular-nums' : 'text-left'
                    }`}
                    style={{
                      background: bg,
                      color: fg,
                      fontWeight: highlight ? 600 : undefined,
                      borderRight: `1px solid ${DECK.rule}`,
                    }}
                  >
                    {value ?? '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A proportion bar, for the commodity slide's Cost Contribution column. */
export function ShareBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <span className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-right text-xs tabular-nums">{clamped.toFixed(0)}%</span>
      <span
        aria-hidden
        className="h-2 min-w-16 flex-1 overflow-hidden rounded-sm"
        style={{ background: '#e4e9f5' }}
      >
        <span
          className="block h-full rounded-sm"
          style={{ width: `${clamped}%`, background: DECK.accent }}
        />
      </span>
    </span>
  );
}

/**
 * The closing takeaway. Every reference slide ends with one.
 *
 * It carries the sentence an executive repeats in the meeting, so it is the last
 * thing on the page and visually the loudest — which is also why an illustrative
 * figure inside one has to be labelled where it sits, not in a footnote above it.
 */
export function InsightBanner({ headline, children }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg px-5 py-4 text-white"
      style={{ background: `linear-gradient(90deg, ${DECK.navy} 0%, ${DECK.accent} 100%)` }}
      data-testid="insight-banner"
    >
      {headline && (
        <div className="shrink-0 border-white/25 pr-6 sm:border-r">
          <p className="text-3xl font-semibold leading-none">{headline.value}</p>
          {headline.label && <p className="mt-1 text-xs text-white/80">{headline.label}</p>}
        </div>
      )}
      <p className="min-w-60 flex-1 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

/**
 * States plainly that what follows is a worked example rather than measured data.
 *
 * Used wherever a report shows figures the database cannot supply. The rule this
 * app has followed since the SIMULATED badges on the request form: an unlabelled
 * convincing figure is indistinguishable from a real one, and the person being
 * shown the report is the one who ends up misinformed.
 */
export function IllustrativeNotice({ children }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
      style={{ borderColor: '#e6c98f', background: '#fdf6e7', color: '#7a5a12' }}
      data-testid="illustrative-notice"
    >
      <span className="rounded bg-[#7a5a12] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Illustrative
      </span>
      <span className="min-w-40 flex-1">{children}</span>
    </div>
  );
}

/** Marks a report built from the live teardown data. The counterpart to the above. */
export function LiveDataNotice({ children }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
      style={{ borderColor: '#a9d5bb', background: '#eef8f1', color: DECK.winText }}
      data-testid="live-data-notice"
    >
      <span className="rounded bg-[#186a3b] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Live data
      </span>
      <span className="min-w-40 flex-1">{children}</span>
    </div>
  );
}
