import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { listCategories } from '@/db/queries';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { contrastHintsFor } from '@/lib/dictionary';
import { phoneticsFor } from '@/lib/phonetics';
import { WordList } from './word-list';

export const dynamic = 'force-dynamic';

/**
 * The filter lives in the URL (`?category=<id>`) rather than client state: back/forward work,
 * refresh doesn't lose it, and a link can be saved. As client state it would instead cost a
 * `'use client'` boundary and require shipping every word to the browser to filter there.
 */
/** Items per page. 3 columns × 10 rows, which is exactly one screen */
const PAGE_SIZE = 30;

export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const cats = await listCategories();
  const params = await searchParams;

  // When a category has been deleted but an old link survives, fall back to "All" rather than
  // 404 — one stale filter parameter shouldn't make the whole page unopenable
  const requested = parseCategoryId(params.category);
  const active = cats.some((c) => c.id === requested) ? requested : null;

  const scope = active ? eq(words.categoryId, active) : undefined;

  const [{ total }] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(words)
    .where(scope);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // An invalid or out-of-range page falls back to page 1 — same rule as ?category=99: a stale
  // parameter shouldn't make the whole page unopenable
  const wanted = Number(params.page);
  const page = Number.isInteger(wanted) && wanted >= 1 && wanted <= totalPages ? wanted : 1;

  const rows = await getDb()
    .select({
      id: words.id,
      lemma: words.lemma,
      category: categories.name,
      contrasts: words.contrasts,
      remark: words.remark,
      zipf: words.zipf,
      // The definition hangs off the encounter (the same word can be defined differently in
      // different contexts), and the card takes the most recent one. Without a definition the
      // card would be a lone word, which says nothing.
      note: sql<string | null>`
        (array_agg(${encounters.note} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
      pos: sql<string | null>`
        (array_agg(${encounters.pos} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
    })
    .from(words)
    .innerJoin(categories, eq(categories.id, words.categoryId))
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .where(scope)
    .groupBy(words.id, categories.name)
    .orderBy(asc(words.sortOrder), asc(words.lemma))
    // Where pagination actually saves work is the two lookups below: encounters and glosses
    // are fetched for these 30 words only
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  /*
   * The sentences and definitions the expanded area needs, fetched in one go and grouped in JS.
   * The whole database holds 225 encounters averaging 76 characters — the entire dataset is
   * smaller than one image, so fetching on expand would cost an extra endpoint plus network
   * latency for nothing.
   */
  const detail = rows.length
    ? await getDb()
        .select({
          id: encounters.id,
          wordId: encounters.wordId,
          rawText: encounters.rawText,
          note: encounters.note,
          pos: encounters.pos,
          // The cloze locates **the span originally blanked out** inside the sentence — words
          // there are usually inflected
          clozeText: cards.clozeText,
        })
        .from(encounters)
        .innerJoin(cards, eq(cards.encounterId, encounters.id))
        .where(
          inArray(
            encounters.wordId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(encounters.createdAt))
    : [];

  const byWord = new Map<number, typeof detail>();
  for (const e of detail) {
    const list = byWord.get(e.wordId) ?? [];
    list.push(e);
    byWord.set(e.wordId, list);
  }

  /*
   * Confusable glosses are resolved **on the server**, and only the few dozen this screen uses
   * are sent down (a few hundred bytes). The table itself is 2.18MB and must never reach the
   * browser.
   */
  const glosses = contrastHintsFor(new Set(rows.flatMap((r) => r.contrasts)));
  // Same for phonetics — the table stays server-side and only these 30 words go down
  const phonetics = phoneticsFor(rows.map((r) => r.lemma));

  const allCount = cats.reduce((sum, c) => sum + c.wordCount, 0);

  return (
    <main className="mx-auto w-full max-w-4xl p-4 md:p-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-medium tracking-tight">Words</h1>
        <span className="text-sm text-muted-foreground">
          {rows.length} / {total}
        </span>
      </div>

      {/* The chips are drop targets, so they have to share a DndContext with the cards —
          hence both are handed to WordList together */}
      <WordList
        words={rows}
        encountersByWord={Object.fromEntries(byWord)}
        chips={cats.map((c) => ({ id: c.id, name: c.name, count: c.wordCount }))}
        activeCategory={active}
        total={allCount}
        glosses={glosses}
        phonetics={phonetics}
        page={page}
        totalPages={totalPages}
        empty={active === null ? 'No confirmed words yet' : 'No words in this category yet'}
      />
    </main>
  );
}
