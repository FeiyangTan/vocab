'use client';

import { BookText, Coins, Inbox, Layers, Tags } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type NavCounts = { due: number; pending: number; words: number; categories: number };

const ITEMS = [
  { href: '/review', label: 'Review', icon: Layers, key: 'due' },
  { href: '/inbox', label: 'Inbox', icon: Inbox, key: 'pending' },
  { href: '/words', label: 'Words', icon: BookText, key: 'words' },
  { href: '/categories', label: 'Categories', icon: Tags, key: 'categories' },
  // Usage isn't a to-do count, so a badge there would mean nothing — hence key: null
  { href: '/usage', label: 'Usage', icon: Coins, key: null },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A left sidebar on wide screens, bottom tabs on narrow ones.
 *
 * Not shadcn's `sidebar` component — it brings collapsing, a rail, and cookie persistence,
 * none of which a handful of fixed menu items needs.
 *
 * Narrow screens get the bottom bar because half of this app's use is reviewing in the iPhone
 * PWA, and a dashboard-style sidebar is out of thumb reach on a phone.
 */
export function Sidebar({ counts }: { counts: NavCounts }) {
  const isActive = useActive();

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="px-5 py-6 font-serif text-xl font-medium tracking-tight">vocab</div>
      <nav className="flex flex-col px-2">
        {ITEMS.map(({ href, label, icon: Icon, key }) => {
          const active = isActive(href);
          const n = key ? counts[key] : 0;
          return (
            <Link
              key={href}
              href={href}
              /* The active state is an ink-green left bar plus ink-green text, not a grey
                 filled block — filled blocks are a dashboard idiom */
              className={cn(
                'flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-sidebar-primary font-medium text-sidebar-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {n > 0 && <span className="text-xs tabular-nums opacity-60">{n}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function BottomTabs({ counts }: { counts: NavCounts }) {
  const isActive = useActive();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-background/95 backdrop-blur md:hidden">
      {ITEMS.map(({ href, label, icon: Icon, key }) => {
        const active = isActive(href);
        const n = key ? counts[key] : 0;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs transition-colors',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {n > 0 && (
                <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground tabular-nums">
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
