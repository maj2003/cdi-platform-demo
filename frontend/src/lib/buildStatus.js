// ---------------------------------------------------------------------------
// src/lib/buildStatus.js — the one place "is this built yet?" is expressed.
//
// Extracted from WorkflowPage.jsx, which invented this convention and is still
// its heaviest user. The three workflow-section pages (How To Use, New Project,
// Competitive Intelligence Engine) all need to say the same thing about the same
// features, and three private copies of these maps would drift the moment one
// stubbed thing goes live.
//
// STATUS MEANINGS — this is the part worth getting right, because a page that
// claims something works when it doesn't is worse than one that says nothing:
//
//   live    — real and working, backed by a real endpoint or real database rows.
//   stubbed — the UI and the call shape are real; the computation behind it is
//             canned on purpose (aiService.parseBOM), per CONTEXT.md.
//   partial — genuinely works, but not end-to-end. Photo capture is the example:
//             real uploads, real persistence, but IndexedDB in one browser rather
//             than the backend.
//   planned — nothing built. Either a schema column with no UI, or an external
//             system this build deliberately does not talk to.
//
// Anything described as live on a page in front of a stakeholder should be
// clickable and should work. If it isn't, it is `planned`.
// ---------------------------------------------------------------------------

export const STATUS_LABEL = Object.freeze({
  live: 'Live',
  stubbed: 'Stubbed',
  partial: 'Partial',
  planned: 'Planned',
});

/**
 * Badge variant per status.
 *
 * `default` is the cerulean solid fill (white text on brand blue) and is
 * reserved for Live — it's the strongest visual weight available, and "this
 * actually works" is the strongest claim on these pages. Planned is an outline
 * so it reads as an empty slot rather than an achievement.
 */
export const STATUS_BADGE_VARIANT = Object.freeze({
  live: 'default',
  stubbed: 'secondary',
  partial: 'secondary',
  planned: 'outline',
});

/**
 * One neutral, muted-line treatment for every icon, regardless of status.
 *
 * Status is the badge's job (text + variant), not the icon's. A different fill
 * per status would turn every icon into a coloured sticker, which is exactly the
 * pattern this app's visual style avoids: colour should signal meaning once, not
 * repeat it as decoration.
 */
export const ICON_WRAPPER_CLASS = 'border-border bg-card text-muted-foreground';
