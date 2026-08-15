import { eq, lte, sql } from 'drizzle-orm';
import { BottomTabs, Sidebar } from '@/components/app-nav';
import { getDb } from '@/db';
import { cards, categories, inbox, words } from '@/db/schema';

/**
 * The app shell. `/login` is outside this route group, so the login page is a clean screen.
 *
 * The three counts are queried once here and shared by the sidebar and the bottom tabs — they
 * moved over from the home page, which is also why the home page's "three entry points"
 * splash is no longer needed (the numbers are on the menu already).
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const count = sql<number>`count(*)::int`;

  const [[due], [pending], [wordCount], [categoryCount]] = await Promise.all([
    db.select({ count }).from(cards).where(lte(cards.due, new Date())),
    db.select({ count }).from(inbox).where(eq(inbox.status, 'pending')),
    db.select({ count }).from(words),
    db.select({ count }).from(categories),
  ]);

  const counts = {
    due: due.count,
    pending: pending.count,
    words: wordCount.count,
    categories: categoryCount.count,
  };

  return (
    <div className="flex min-h-dvh">
      <Sidebar counts={counts} />
      {/*
        On narrow screens there are bottom tabs, so the content area leaves room — otherwise
        they cover the review page's grading buttons.
        This has to be a flex column: the review page's <main> relies on flex-1 to fill the
        **remaining** height. Giving it min-h-dvh instead would fill the entire viewport and
        push the buttons underneath the tab bar.
      */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">{children}</div>
      <BottomTabs counts={counts} />
    </div>
  );
}
