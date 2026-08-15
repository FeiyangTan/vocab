import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, inbox, words, type Draft } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { cleanContrasts, MAX_CONTRASTS } from '@/lib/contrasts';
import { zipfOf } from '@/lib/frequency';
import { cleanRemark } from '@/lib/remark';

/**
 * Review confirm: turn the (possibly hand-edited) draft into a real word + encounter + card.
 *
 * This is the only place in the whole flow that writes those three tables — nothing that
 * hasn't passed through here can enter the review queue.
 */

/**
 * The category isn't part of Draft — Claude no longer guesses it; a person picks it on the
 * review page. Confusables *are* in Draft (carried over from the `carve (cave)` shorthand),
 * but they're editable on the review page, so the request body is authoritative.
 */
function parseBody(body: unknown): { draft: Draft; categoryId: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const target = str(b.target);
  const lemma = str(b.lemma);
  const definition = str(b.definition);
  const sentence = str(b.sentence);
  const cloze = str(b.cloze);
  const categoryId = parseCategoryId(b.categoryId);
  if (!target || !lemma || !definition || !sentence || !cloze || !categoryId) return null;
  return {
    draft: {
      target,
      lemma,
      definition,
      sentence,
      cloze,
      generated: b.generated === true,
      pos: typeof b.pos === 'string' ? b.pos.trim().slice(0, 12) : '',
      contrasts: cleanContrasts(b.contrasts) ?? [],
      remark: cleanRemark(b.remark),
    },
    categoryId,
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseBody(body);
  if (!parsed) {
    return NextResponse.json({ error: 'Incomplete fields' }, { status: 400 });
  }
  const { draft, categoryId } = parsed;
  // Confusables are a property of the word, not the encounter; the copy in Draft is
  // only kept for the record
  const contrasts = draft.contrasts;
  const db = getDb();

  try {
    const cardId = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ rawText: inbox.rawText, source: inbox.source })
        .from(inbox)
        .where(and(eq(inbox.id, id), eq(inbox.status, 'pending')))
        .limit(1);
      if (!row) throw new Error('NOT_PENDING');

      // The category may have been deleted since the review page was opened; check before
      // writing
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);
      if (!category) throw new Error('NO_CATEGORY');

      // The same lemma reuses one word row within a category; across categories they're
      // two separate words
      const [existing] = await tx
        .select({ id: words.id, contrasts: words.contrasts, remark: words.remark })
        .from(words)
        .where(and(eq(words.lemma, draft.lemma), eq(words.categoryId, categoryId)))
        .limit(1);

      let wordId: number;
      if (existing) {
        wordId = existing.id;
        // **Merged, not overwritten** — confirming the same word a second time must not
        // wipe the confusables added the first time
        const merged = [...new Set([...existing.contrasts, ...contrasts])].slice(
          0,
          MAX_CONTRASTS,
        );
        // A note is free text and can't be unioned the way confusables can, so **first
        // write wins**: an existing note is kept, because confirming the same word again
        // must not erase what was written by hand last time
        const remark = existing.remark ?? draft.remark;
        if (merged.length !== existing.contrasts.length || remark !== existing.remark) {
          await tx.update(words).set({ contrasts: merged, remark }).where(eq(words.id, wordId));
        }
      } else {
        // New words go at the end of their category — the default of 0 would put them
        // first, which isn't what's wanted
        const [{ max }] = await tx
          .select({ max: sql<number>`coalesce(max(${words.sortOrder}), 0)::int` })
          .from(words)
          .where(eq(words.categoryId, categoryId));
        const [created] = await tx
          .insert(words)
          .values({
            lemma: draft.lemma,
            categoryId,
            contrasts,
            remark: draft.remark,
            sortOrder: max + 1,
            zipf: zipfOf(draft.lemma),
          })
          .returning({ id: words.id });
        wordId = created.id;
      }

      // An encounter stores the **sentence**, not the raw inbox input:
      // - for invented sentences the raw input is a lone word, which would leave the bottom
      //   of the review card empty
      // - for web shares the raw input drags along a title and a URL, which is just noise
      // The raw input isn't lost — inbox.raw_text is kept forever.
      const [encounter] = await tx
        .insert(encounters)
        .values({
          wordId,
          rawText: draft.sentence,
          source: draft.generated ? `${row.source}+ai` : row.source,
          note: draft.definition,
          // Empty string means absent — that's what the model returns when unsure
          pos: draft.pos || null,
        })
        .returning({ id: encounters.id });

      const [card] = await tx
        .insert(cards)
        .values({ encounterId: encounter.id, clozeText: draft.cloze })
        .returning({ id: cards.id });

      await tx.update(inbox).set({ status: 'processed', draft }).where(eq(inbox.id, id));

      return card.id;
    });

    return NextResponse.json({ ok: true, cardId });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_PENDING') {
      return NextResponse.json({ error: 'This item was already handled' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'NO_CATEGORY') {
      return NextResponse.json({ error: 'That category no longer exists' }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
