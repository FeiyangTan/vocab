'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Used instead of the native `title`. Both are "hover a moment and it appears", but they time
 * it completely differently:
 *
 * - native `title`: **any pointer movement restarts the timer**, so it only appears if you
 *   hold dead still
 * - Radix: **counts from the moment you enter the element**, and moving within it never resets
 *
 * Which is why a 1.2-second delay is safe here — park the pointer and wait a beat when you
 * want it, and skimming across the page isn't interrupted by a trail of popups.
 *
 * `skipDelayDuration = 0`: by default Radix shows the next tooltip **immediately** if you move
 * to it within 300ms of one closing. Turning that off makes every one wait the full 1.2s.
 */
function TooltipProvider({
  delayDuration = 1200,
  skipDelayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 max-w-64 rounded-sm border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md',
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
