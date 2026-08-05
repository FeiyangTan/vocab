import { and, eq, lte, sql } from 'drizzle-orm';
import Link from 'next/link';
import { getDb } from '@/db';
import { cards, encounters, words } from '@/db/schema';

export const dynamic = 'force-dynamic';

/** work / daily 两个队列分开 —— 工作时不想被生活词打断，反之亦然。 */
export default async function ReviewPage() {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({ domain: words.domain, count: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(lte(cards.due, now))
    .groupBy(words.domain);

  const due = (d: 'work' | 'daily') => rows.find((r) => r.domain === d)?.count ?? 0;

  return (
    <main className="mx-auto w-full max-w-xl p-4">
      <header className="mb-6 flex items-baseline justify-between">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← vocab
        </Link>
        <span className="text-sm opacity-60">复习</span>
      </header>

      <div className="space-y-3">
        {(['work', 'daily'] as const).map((d) => {
          const n = due(d);
          return (
            <Link
              key={d}
              href={n > 0 ? `/review/${d}` : '/review'}
              aria-disabled={n === 0}
              className={`flex items-center justify-between rounded-xl border px-4 py-5 ${
                n > 0
                  ? 'border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/40'
                  : 'pointer-events-none border-black/5 opacity-40 dark:border-white/10'
              }`}
            >
              <span className="text-lg">{d}</span>
              <span className="text-sm opacity-60">{n > 0 ? `${n} 张到期` : '没有到期的'}</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
