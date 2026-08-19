// ---------------------------------------------------------------------------
// src/components/capture/LabelPreview.jsx
//
// See the sticker before it prints, then print exactly that.
//
// ---------------------------------------------------------------------------
// WHY IT PRINTS THROUGH AN IFRAME
//
// The alternative is to print the live page with an `@media print` rule that hides
// everything except the label. That makes the sticker's layout depend on the
// workstation's stylesheet, so a future change to a Tailwind class three
// components away can silently reflow a physical label — and nobody finds out
// until a roll of them comes out wrong.
//
// So the label is a self-contained document (see lib/labelContent.js) rendered
// into a same-origin iframe, and `iframe.contentWindow.print()` prints that. The
// app's CSS cannot reach it. The on-screen preview below is a scaled rendering of
// the SAME document, in the same iframe, so what you see is literally the thing
// that goes to the printer rather than a second drawing of it.
//
// No print dialog is opened until Print is pressed, which also means this panel is
// safe to render and to test.
// ---------------------------------------------------------------------------

import { useMemo, useRef } from 'react';
import { Printer, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildLabel, LABEL_SIZE_MM, labelPrintDocument } from '@/lib/labelContent';

/** Screen pixels per mm for the preview. 3.4 puts a 50mm label at ~170px. */
const PREVIEW_SCALE = 3.4;

/**
 * @param {object}   props
 * @param {string}   props.label      the Photo ID being printed
 * @param {string}   [props.view]
 * @param {object}   props.part
 * @param {object}   [props.product]
 * @param {Function} props.onClose
 */
export default function LabelPreview({ label, view, part, product, onClose }) {
  const frameRef = useRef(null);

  const doc = useMemo(
    () => labelPrintDocument(buildLabel({ label, view, part, product }), LABEL_SIZE_MM),
    [label, view, part, product],
  );

  const print = () => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    // focus() first: without it some browsers print the parent document instead of
    // the frame, which would send the whole workstation to the printer.
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="label-preview">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Label preview
          </p>
          <p className="text-xs text-muted-foreground">
            {LABEL_SIZE_MM.width} × {LABEL_SIZE_MM.height} mm
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClose} aria-label="Close label preview">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex justify-center rounded-md border bg-white p-2">
        {/* srcDoc, not src: a same-origin inline document needs no server round
            trip and cannot be affected by the app's stylesheet. sandbox is
            deliberately NOT set — printing requires allow-modals, and the content
            is a string this app just generated, not third-party. */}
        <iframe
          ref={frameRef}
          title={`Label ${label}`}
          srcDoc={doc}
          className="border-0 bg-white"
          style={{
            width: `${LABEL_SIZE_MM.width * PREVIEW_SCALE}px`,
            height: `${LABEL_SIZE_MM.height * PREVIEW_SCALE}px`,
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={print}>
          <Printer className="mr-1.5 size-4" />
          Print
        </Button>
        <Badge variant="secondary" className="font-mono text-xs">
          {label}
        </Badge>
        {view && <Badge variant="outline" className="font-normal">{view}</Badge>}
      </div>

      <Alert>
        <AlertDescription className="text-xs">
          Prints through the browser's dialog — pick the label printer and set the paper
          to {LABEL_SIZE_MM.width} × {LABEL_SIZE_MM.height} mm. Direct printer
          integration is still planned; this generates the real label content, so
          wiring a printer is the only step left.
        </AlertDescription>
      </Alert>
    </div>
  );
}
