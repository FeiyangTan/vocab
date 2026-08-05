import { eq, lte, sql } from 'drizzle-orm';
import { BottomTabs, Sidebar } from '@/components/app-nav';
import { getDb } from '@/db';
import { cards, inbox, words } from '@/db/schema';

/**
 * 应用外壳。`/login` 不在这个路由分组里，所以登录页是干净的一屏。
 *
 * 三个数量在这里查一次，侧边栏和底栏共用 —— 原本挂在首页的那三个查询搬了过来，
 * 首页那个「三个入口」的启动页也因此不再需要（数字已经在菜单上了）。
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const count = sql<number>`count(*)::int`;

  const [[due], [pending], [wordCount]] = await Promise.all([
    db.select({ count }).from(cards).where(lte(cards.due, new Date())),
    db.select({ count }).from(inbox).where(eq(inbox.status, 'pending')),
    db.select({ count }).from(words),
  ]);

  const counts = {
    due: due.count,
    pending: pending.count,
    words: wordCount.count,
  };

  return (
    <div className="flex min-h-dvh">
      <Sidebar counts={counts} />
      {/* 窄屏底部有标签栏，内容区留出空间，否则会盖住复习页的评分按钮 */}
      <div className="min-w-0 flex-1 pb-20 md:pb-0">{children}</div>
      <BottomTabs counts={counts} />
    </div>
  );
}
