'use client';

import { BookText, Inbox, Layers } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type NavCounts = { due: number; pending: number; words: number };

const ITEMS = [
  { href: '/review', label: '复习', icon: Layers, key: 'due' },
  { href: '/inbox', label: '收集箱', icon: Inbox, key: 'pending' },
  { href: '/words', label: '词汇', icon: BookText, key: 'words' },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 宽屏用左侧边栏，窄屏用底部标签栏。
 *
 * 不用 shadcn 那个 `sidebar` 组件 —— 它带折叠、rail、cookie 持久化，
 * 三个固定菜单项用不上那套。
 *
 * 窄屏走底栏是因为这个应用一半的场景是 iPhone PWA 复习，
 * 中后台那种侧边栏在手机上拇指够不着。
 */
export function Sidebar({ counts }: { counts: NavCounts }) {
  const isActive = useActive();

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="px-5 py-5 text-base font-medium tracking-tight">vocab</div>
      <nav className="flex flex-col gap-0.5 px-2">
        {ITEMS.map(({ href, label, icon: Icon, key }) => {
          const active = isActive(href);
          const n = counts[key];
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
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
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t bg-background/95 backdrop-blur md:hidden">
      {ITEMS.map(({ href, label, icon: Icon, key }) => {
        const active = isActive(href);
        const n = counts[key];
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground',
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
