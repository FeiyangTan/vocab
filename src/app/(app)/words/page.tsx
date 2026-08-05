import { asc, eq, sql } from 'drizzle-orm';
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
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">词汇</h1>
        <span className="text-sm text-muted-foreground">{rows.length} 个</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">还没有确认过的词</p>
      ) : (
        <ul className="divide-y">
          {rows.map((w) => (
            <WordRow key={w.id} word={w} />
          ))}
        </ul>
      )}
    </main>
  );
}
