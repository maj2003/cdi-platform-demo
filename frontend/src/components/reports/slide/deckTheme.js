// ---------------------------------------------------------------------------
// src/components/reports/slide/deckTheme.js
//
// The reference deck's palette, in its own module.
//
// Split out of SlideKit.jsx because a file that exports both components and
// constants breaks Fast Refresh — the lint rule is about the dev-loop, but the
// separation is right anyway: this is the one place the deck's colours are stated,
// and the eventual PPT exporter needs them without pulling in JSX.
//
// ---------------------------------------------------------------------------
// WHY THESE ARE FIXED HEX AND NOT THEME TOKENS
//
// The report pages are print/deck artefacts — screenshotted into decks and exported
// to PowerPoint. The reference is a white slide with a specific navy and a specific
// green, and a report that changed colour with the viewer's OS theme would not match
// the deck it reproduces. So this surface deliberately opts OUT of the app's
// light/dark theming; everything around it (nav, chrome) still themes normally.
// ---------------------------------------------------------------------------

/**
 * The report palette — the Report Design Reference deck, aligned to the CDI brand.
 *
 * The two were already close: the reference deck's navy and the CDI mark's navy are
 * within a shade of each other, and the deck's accent blue and CDI's electric blue
 * are the same family. So this is one palette now rather than two that nearly match,
 * which is what stops a report screenshot from looking subtly off-brand next to the
 * header it was taken under.
 */
export const DECK = Object.freeze({
  navy: '#141C3A',       // CDI deep navy
  navySoft: '#25305c',
  ink: '#141C3A',
  violet: '#7B3FE4',     // the mark's play triangle — brand gradients only
  daikin: '#00A0E4',     // the supporting brand, for Daikin attribution
  bodyText: '#243056',
  muted: '#7a839f',
  rule: '#d5dcec',
  zebra: '#f5f7fc',
  surface: '#ffffff',
  page: '#f7f9fd',
  win: '#dff3e3',        // green highlight — best value in a row
  winText: '#186a3b',
  alert: '#fdeaea',      // red highlight — the over-used grade
  alertText: '#b3261e',
  gap: '#fdf1e3',        // amber — the gap-to-next column
  gapText: '#a55a12',
  accent: '#2E7BF6',   // CDI electric blue
});
