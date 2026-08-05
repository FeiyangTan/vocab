import { eq, lte, sql } from 'drizzle-orm';
import Link from 'next/link';
import { getDb } from '@/db';
import { cards, inbox, words } from '@/db/schema';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const db = getDb();

  const [[{ count: pending }], [{ count: due }], [{ count: wordCount }]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inbox)
      .where(eq(inbox.status, 'pending')),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(cards)
      .where(lte(cards.due, new Date())),
    db.select({ count: sql<number>`count(*)::int` }).from(words),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-3 p-6">
      <h1 className="mb-3 text-lg font-medium">vocab</h1>

      <Entry href="/review" label="复习" detail={due > 0 ? `${due} 张到期` : '没有到期的'} />
      <Entry
        href="/inbox"
        label="收集箱"
        detail={pending > 0 ? `${pending} 条待整理` : '空的'}
      />
      <Entry href="/words" label="词汇" detail={`${wordCount} 个`} />
    </main>
  );
}

function Entry({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-4 hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
    >
      <span>{label}</span>
      <span className="text-sm opacity-60">{detail}</span>
    </Link>
  );
}
