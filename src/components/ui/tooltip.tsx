'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 用它不用原生 `title`。两者都是「悬停一会儿才弹」，但计时方式完全不同：
 *
 * - 原生 `title`：鼠标**一动就重新计时**，所以得死死停住才弹得出来
 * - Radix：**从进入元素那一刻开始算**，在元素范围内怎么动都不重置
 *
 * 所以这里可以放心用 1.2 秒的延迟 —— 想看的时候把鼠标放上去等一下就有，
 * 快速扫过不会被一路弹窗打断。
 *
 * `skipDelayDuration = 0`：Radix 默认在刚关掉一个气泡后的 300ms 内，
 * 移到下一个会**立刻**弹。关掉它，每一个都老老实实等满 1.2 秒。
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
