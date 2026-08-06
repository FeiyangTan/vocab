import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { categories, encounters, words } from '@/db/schema';
import { WordCard } from './word-card';

export const dynamic = 'force-dynamic';

export default async function WordsPage() {
  const rows = await getDb()
    .select({
      id: words.id,
      lemma: words.lemma,
      category: categories.name,
      contrasts: words.contrasts,
      encounterCount: sql<number>`count(${encounters.id})::int`,
      // 释义挂在 encounter 上（同一个词不同语境可以有不同释义），卡片取最近那次。
      // 卡片上不放释义的话就只剩一个孤零零的单词，看不出什么。
      note: sql<string | null>`
        (array_agg(${encounters.note} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
    })
    .from(words)
    .innerJoin(categories, eq(categories.id, words.categoryId))
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .groupBy(words.id, categories.name)
    .orderBy(asc(words.lemma));

  return (
    <main className="mx-auto w-full max-w-4xl p-4 md:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-medium tracking-tight">词汇</h1>
        <span className="text-sm text-muted-foreground">{rows.length} 个</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">还没有确认过的词</p>
      ) : (
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <WordCard key={w.id} word={w} />
          ))}
        </div>
      )}
    </main>
  );
}
