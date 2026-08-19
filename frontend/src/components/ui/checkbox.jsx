"use client"

import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Added for the repository's compare-selection control. Same shape and the same
// radix import style as switch.jsx next door — a checkbox rather than a switch
// because "include this product in the comparison" is a selection, not a
// setting, and screen readers should hear it as one.
//
// Checked state uses --primary (cerulean) because the tick is white on top of
// it; the surrounding row tint elsewhere uses --accent. That's the app's
// standing two-tier rule, not an arbitrary choice.
function Checkbox({ className, ...props }) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-lg border border-input shadow-xs transition-shadow outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}>
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox }
