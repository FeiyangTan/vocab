import { eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [{ count: pending }] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(inbox)
    .where(eq(inbox.status, 'pending'));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 p-6">
      <h1 className="text-lg font-medium">vocab</h1>

      <Link
        href="/inbox"
        className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-4 hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
      >
        <span>收集箱</span>
        <span className="text-sm opacity-60">{pending} 条待整理</span>
      </Link>

      <p className="text-sm opacity-50">复习界面还没做（Phase 4b）。</p>
    </main>
  );
}
