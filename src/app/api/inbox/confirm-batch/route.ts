import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, inbox, words, type Draft } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { cleanContrasts, MAX_CONTRASTS } from '@/lib/contrasts';
import { zipfOf } from '@/lib/frequency';
import { cleanRemark } from '@/lib/remark';

/**
 * Bulk confirm. `POST /api/inbox/confirm-batch`
 *
 * Calling `/api/inbox/{id}/confirm` one item at a time means one transaction and 9 round
 * trips each; the database is in us-west-2 at ~50 ms per round trip, so 135 items take two
 * minutes. This does the whole batch in **one transaction and about 10 round trips**,
 * independent of item count.
 *
 * 🔴 **Never rely on `RETURNING` order.** A multi-row `INSERT … RETURNING` does not guarantee
 * the returned order matches the VALUES order, and guessing wrong pairs a card with the wrong
 * sentence — silent data corruption you'd only discover during review. So: words are matched
 * back by `lemma` (there's a unique index on `(lemma, category_id)`), and encounter ids are
 * **drawn from the sequence in bulk first**, then inserted explicitly.
 */
export const dynamic = 'force-dynamic';

type Item = Draft & { id: number };

/** The same validation as the single-item endpoint. One bad item rejects the whole request —
 *  don't discover it halfway through a transaction */
function parseItems(value: unknown): Item[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Item[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const b = raw as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const id = typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : 0;
    const target = str(b.target);
    const lemma = str(b.lemma);
    const definition = str(b.definition);
    const sentence = str(b.sentence);
    const cloze = str(b.cloze);
    if (!id || !target || !lemma || !definition || !sentence || !cloze) return null;
    out.push({
      id,
      target,
      lemma,
      definition,
      sentence,
      cloze,
      generated: b.generated === true,
      pos: typeof b.pos === 'string' ? b.pos.trim().slice(0, 12) : '',
      contrasts: cleanContrasts(b.contrasts) ?? [],
      remark: cleanRemark(b.remark),
    });
  }
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    categoryId?: unknown;
    items?: unknown;
  } | null;

  const categoryId = parseCategoryId(body?.categoryId);
  const items = parseItems(body?.items);
  if (!categoryId || !items) {
    return NextResponse.json({ error: 'Incomplete fields' }, { status: 400 });
  }

  // The same id twice in one batch would double the encounters/cards, so dedupe first
  // (keeping the last edit)
  const byId = new Map(items.map((i) => [i.id, i]));
  const unique = [...byId.values()];

  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      // (1) category
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);
      if (!category) throw new Error('NO_CATEGORY');

      // (2) which are still pending — the rest are skipped as "already handled"
      const rows = await tx
        .select({ id: inbox.id, source: inbox.source })
        .from(inbox)
        .where(
          and(
            inArray(
              inbox.id,
              unique.map((i) => i.id),
            ),
            eq(inbox.status, 'pending'),
          ),
        );
      const sourceById = new Map(rows.map((r) => [r.id, r.source]));
      const todo = unique.filter((i) => sourceById.has(i.id));
      const skipped = unique.filter((i) => !sourceById.has(i.id)).map((i) => i.id);
      if (todo.length === 0) return { confirmed: 0, skipped };

      // (3) words that already exist
      const lemmas = [...new Set(todo.map((i) => i.lemma))];
      const existing = await tx
        .select({
          id: words.id,
          lemma: words.lemma,
          contrasts: words.contrasts,
          remark: words.remark,
        })
        .from(words)
        .where(and(eq(words.categoryId, categoryId), inArray(words.lemma, lemmas)));
      const wordIdByLemma = new Map(existing.map((w) => [w.lemma, w.id]));

      // (4) aggregate within the batch by lemma — two `dare` items in one batch share one
      //     word row, and their confusables are unioned. A note is free text and can't be
      //     merged, so the **first non-empty one** wins (consistent with first-write-wins)
      const contrastsByLemma = new Map<string, string[]>();
      const remarkByLemma = new Map<string, string | null>();
      for (const item of todo) {
        const merged = new Set(contrastsByLemma.get(item.lemma) ?? []);
        for (const c of item.contrasts) merged.add(c);
        contrastsByLemma.set(item.lemma, [...merged].slice(0, MAX_CONTRASTS));
        remarkByLemma.set(item.lemma, remarkByLemma.get(item.lemma) ?? item.remark);
      }

      // (5) insert all new words at once. lemma is unique within the category (there's a
      //     unique index), which is what makes matching ids back by lemma safe
      const newLemmas = lemmas.filter((l) => !wordIdByLemma.has(l));
      if (newLemmas.length > 0) {
        // New words go at the end of their category — the default of 0 would put them
        // first, which isn't what's wanted
        const [{ maxOrder }] = await tx
          .select({ maxOrder: sql<number>`coalesce(max(${words.sortOrder}), 0)::int` })
          .from(words)
          .where(eq(words.categoryId, categoryId));
        const created = await tx
          .insert(words)
          .values(
            newLemmas.map((lemma, n) => ({
              lemma,
              categoryId,
              contrasts: contrastsByLemma.get(lemma) ?? [],
              remark: remarkByLemma.get(lemma) ?? null,
              sortOrder: maxOrder + n + 1,
              zipf: zipfOf(lemma),
            })),
          )
          .returning({ id: words.id, lemma: words.lemma });
        for (const w of created) wordIdByLemma.set(w.lemma, w.id);
      }

      // (6) an existing word's confusables are **merged, not overwritten** — meeting the
      //     same word a second time must not wipe what was added the first time. Same for the
      //     note, except a union isn't possible, so **first write wins**: an existing note
      //     is left untouched
      const merges: { id: number; contrasts: string[]; remark: string | null }[] = [];
      for (const w of existing) {
        const incoming = contrastsByLemma.get(w.lemma) ?? [];
        const merged = [...new Set([...w.contrasts, ...incoming])].slice(0, MAX_CONTRASTS);
        const remark = w.remark ?? remarkByLemma.get(w.lemma) ?? null;
        if (merged.length !== w.contrasts.length || remark !== w.remark) {
          merges.push({ id: w.id, contrasts: merged, remark });
        }
      }
      if (merges.length > 0) {
        await tx.execute(sql`
          UPDATE ${words} AS w
          SET contrasts = v.contrasts::jsonb, remark = v.remark
          FROM (VALUES ${sql.join(
            merges.map(
              (m) =>
                sql`(${m.id}::bigint, ${JSON.stringify(m.contrasts)}::text, ${m.remark}::text)`,
            ),
            sql`, `,
          )}) AS v(id, contrasts, remark)
          WHERE w.id = v.id
        `);
      }

      // (7) draw ids first, then insert — so which encounter each card hangs off is
      //     **known**, rather than inferred from the returned order
      const seq = await tx.execute<{ id: string }>(sql`
        SELECT nextval(pg_get_serial_sequence('encounters', 'id'))::bigint AS id
        FROM generate_series(1, ${todo.length})
      `);
      const encounterIds = seq.rows.map((r) => Number(r.id));

      // (8) encounters. The field semantics match the single-item endpoint exactly:
      //     raw_text stores the **sentence**, not the raw inbox text; invented sentences get
      //     a +ai marker on the source
      await tx.insert(encounters).values(
        todo.map((item, n) => ({
          id: encounterIds[n],
          wordId: wordIdByLemma.get(item.lemma)!,
          rawText: item.sentence,
          source: item.generated
            ? `${sourceById.get(item.id)}+ai`
            : sourceById.get(item.id)!,
          note: item.definition,
          pos: item.pos || null,
        })),
      );

      // (9) cards
      await tx.insert(cards).values(
        todo.map((item, n) => ({
          encounterId: encounterIds[n],
          clozeText: item.cloze,
        })),
      );

      // (10) close out the inbox rows, writing the draft back for the record
      await tx.execute(sql`
        UPDATE ${inbox} AS i
        SET status = 'processed', draft = v.draft::jsonb
        FROM (VALUES ${sql.join(
          todo.map((item) => {
            const { id: _id, ...draft } = item;
            return sql`(${item.id}::bigint, ${JSON.stringify(draft)}::text)`;
          }),
          sql`, `,
        )}) AS v(id, draft)
        WHERE i.id = v.id
      `);

      return { confirmed: todo.length, skipped };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_CATEGORY') {
      return NextResponse.json({ error: 'That category no longer exists' }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
