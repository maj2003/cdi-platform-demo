// ---------------------------------------------------------------------------
// src/lib/labelContent.js — what goes on a teardown label, and its print markup.
//
// ONE definition, used by both the on-screen preview and the page that actually
// prints. A preview that is built separately from the print output is a preview of
// nothing: the whole point is to see the sticker before it comes out of the
// printer, and two renderers drift the first time either is touched.
//
// ---------------------------------------------------------------------------
// WHAT A TEARDOWN LABEL IS FOR
//
// It is stuck on a physical part and then photographed with it. So the Photo ID
// has to be readable in a photo taken at arm's length under workshop light —
// which is why it dominates the label and everything else is secondary. The
// part name and module are there for the person holding the part, not the camera.
// ---------------------------------------------------------------------------

/** Default stock: 50 x 25 mm, the common small thermal label. */
export const LABEL_SIZE_MM = Object.freeze({ width: 50, height: 25 });

/**
 * Assemble the fields for one label.
 *
 * @param {object} args
 * @param {string} args.label      the Photo ID as written on the part ("FJ0010")
 * @param {string} [args.view]     which face this shot is of
 * @param {object} args.part       needs name, moduleName, partNo
 * @param {object} [args.product]  needs brand, name
 * @returns {{label: string, lines: Array<{key: string, value: string}>}}
 */
export function buildLabel({ label, view, part, product }) {
  const lines = [
    { key: 'Part', value: part?.name ?? '—' },
    { key: 'Module', value: part?.moduleName ?? '—' },
  ];
  if (part?.partNo) lines.push({ key: 'Part No', value: String(part.partNo) });
  if (product) {
    lines.push({ key: 'Unit', value: `${product.brand ?? ''} ${product.name ?? ''}`.trim() });
  }
  if (view) lines.push({ key: 'View', value: view });

  return { label: label ?? '—', view: view ?? null, lines };
}

/**
 * Escape for interpolation into the print document.
 *
 * The printed page is assembled as an HTML string rather than by React, so part
 * names and module names — which come from imported spreadsheets and can contain
 * anything — have to be escaped here. A part called `A <B> "C"` would otherwise
 * produce broken markup at best.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A complete, self-contained HTML document for one label.
 *
 * Self-contained on purpose: it carries its own CSS and depends on nothing from
 * the app's stylesheet. The alternative — printing the live page behind an
 * `@media print` rule that hides everything else — means the sticker's layout is
 * at the mercy of every future Tailwind change on the workstation, and a label
 * that silently reflows is a label that comes out of the printer wrong.
 *
 * `@page size` plus explicit mm units means the output matches the stock rather
 * than being scaled to A4.
 *
 * @param {ReturnType<typeof buildLabel>} content
 * @param {{width: number, height: number}} [size] in mm
 */
export function labelPrintDocument(content, size = LABEL_SIZE_MM) {
  const rows = content.lines
    .map(
      (line) =>
        `<tr><th>${esc(line.key)}</th><td>${esc(line.value)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Label ${esc(content.label)}</title>
    <style>
      @page { size: ${size.width}mm ${size.height}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        width: ${size.width}mm;
        height: ${size.height}mm;
        padding: 1.5mm 2mm;
        font-family: "Helvetica Neue", Arial, sans-serif;
        color: #000;
        background: #fff;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
      }
      /* The Photo ID is the whole reason the label exists — it has to be legible
         in a photograph of the part, not just to someone holding it. */
      .id {
        font-family: "Courier New", monospace;
        font-weight: 700;
        font-size: ${Math.round(size.height * 0.34)}mm;
        line-height: 1;
        letter-spacing: 0.3mm;
      }
      table { border-collapse: collapse; width: 100%; }
      th, td {
        font-size: 2.1mm;
        line-height: 1.25;
        text-align: left;
        padding: 0;
        vertical-align: top;
      }
      th { font-weight: 400; color: #444; width: 12mm; padding-right: 1mm; }
      td { font-weight: 600; }
      /* Long imported part names must clip, not push the layout off the stock. */
      td { max-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    <div class="id">${esc(content.label)}</div>
    <table>${rows}</table>
  </body>
</html>`;
}
