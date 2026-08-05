import { asc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { getDb } from '@/db';
import { encounters, words } from '@/db/schema';
import { WordRow } from './word-row';

export const dynamic = 'force-dynamic';

export default async function WordsPage() {
  const rows = await getDb()
    .select({
      id: words.id,
      lemma: words.lemma,
      domain: words.domain,
      contrasts: words.contrasts,
      encounterCount: sql<number>`count(${encounters.id})::int`,
    })
    .from(words)
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .groupBy(words.id)
    .orderBy(asc(words.lemma));

  return (
    <main className="mx-auto w-full max-w-xl p-4 pb-24">
      <header className="mb-6 flex items-baseline justify-between">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← vocab
        </Link>
        <span className="text-sm opacity-60">词汇 {rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm opacity-60">还没有确认过的词</p>
      ) : (
        <ul className="divide-y divide-black/10 dark:divide-white/10">
          {rows.map((w) => (
            <WordRow key={w.id} word={w} />
          ))}
        </ul>
      )}
    </main>
  );
}
