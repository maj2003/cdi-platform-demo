// ---------------------------------------------------------------------------
// src/components/ui/accordion.jsx
//
// shadcn's generated Accordion, with ONE modification — see AccordionContent.
// Everything else is stock.
// ---------------------------------------------------------------------------

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Accordion({ ...props }) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ className, ...props }) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b last:border-b-0', className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

// ---------------------------------------------------------------------------
// THE FIX — two utilities added to the open state.
//
// THE BUG: Radix measures its content once, when the panel opens, and writes
// the result to --radix-accordion-content-height. The open animation runs
// `height: 0 -> var(--radix-accordion-content-height)` on a box that is
// `overflow-hidden`. Fine for static content — but our teardown rows expand
// AFTER the panel is already open, and nothing re-measures. The panel keeps the
// height it computed at open time and the extra rows are clipped, not scrolled,
// because overflow is hidden. The last capture row simply vanishes.
//
// THE FIX:
//   data-[state=open]:h-auto           once the 200ms animation finishes (it has
//                                      no fill-mode, so it stops asserting a
//                                      height), the box sizes to its content and
//                                      keeps doing so as that content grows.
//   data-[state=open]:overflow-visible belt and braces. If a stale height ever
//                                      does apply, content spills rather than
//                                      disappearing — a visible glitch instead
//                                      of silently missing data.
//
// The tradeoff: during the open animation, overflow-visible means content is
// briefly painted outside the growing box. It's 200ms and barely perceptible —
// far cheaper than a row that isn't there.
//
// NOTE: shadcn puts `className` on the inner <div>, not on Content. So this
// cannot be fixed by passing classes from the page — it has to be edited here.
// That's fine: shadcn components are copied into your repo precisely so you can.
// ---------------------------------------------------------------------------
function AccordionContent({ className, children, ...props }) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        'overflow-hidden text-sm',
        'data-[state=closed]:animate-accordion-up',
        'data-[state=open]:animate-accordion-down',
        'data-[state=open]:h-auto data-[state=open]:overflow-visible',
      )}
      {...props}
    >
      <div className={cn('pt-0 pb-4', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };