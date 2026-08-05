import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, encounters, inbox, words, type Draft } from '@/db/schema';
import { cleanContrasts, MAX_CONTRASTS } from '@/lib/contrasts';

/**
 * 审核确认：把（可能被人改过的）草稿真正写成 word + encounter + card。
 *
 * 这是整个流程里唯一写这三张表的地方 —— 没经过这里的东西不会进复习队列。
 */

function parseDraft(body: unknown): Draft | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const target = str(b.target);
  const lemma = str(b.lemma);
  const definition = str(b.definition);
  const sentence = str(b.sentence);
  const cloze = str(b.cloze);
  const domain = b.domain === 'work' || b.domain === 'daily' ? b.domain : null;
  if (!target || !lemma || !definition || !sentence || !cloze || !domain) return null;
  return { target, lemma, definition, domain, sentence, cloze, generated: b.generated === true };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const draft = parseDraft(body);
  if (!draft) {
    return NextResponse.json({ error: '字段不完整' }, { status: 400 });
  }
  // 对比词是 word 的属性，不在 Draft 里；没传就是空数组
  const contrasts = cleanContrasts((body as { contrasts?: unknown })?.contrasts) ?? [];

  const db = getDb();

  try {
    const cardId = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ rawText: inbox.rawText, source: inbox.source })
        .from(inbox)
        .where(and(eq(inbox.id, id), eq(inbox.status, 'pending')))
        .limit(1);
      if (!row) throw new Error('NOT_PENDING');

      // 同一个 lemma 在同一个 domain 下复用同一条 word；不同 domain 算两个词
      const [existing] = await tx
        .select({ id: words.id, contrasts: words.contrasts })
        .from(words)
        .where(and(eq(words.lemma, draft.lemma), eq(words.domain, draft.domain)))
        .limit(1);

      let wordId: number;
      if (existing) {
        wordId = existing.id;
        // **合并而不是覆盖** —— 第二次遇到同一个词时确认，不该把上次加的对比词抹掉
        const merged = [...new Set([...existing.contrasts, ...contrasts])].slice(
          0,
          MAX_CONTRASTS,
        );
        if (merged.length !== existing.contrasts.length) {
          await tx.update(words).set({ contrasts: merged }).where(eq(words.id, wordId));
        }
      } else {
        const [created] = await tx
          .insert(words)
          .values({ lemma: draft.lemma, domain: draft.domain, contrasts })
          .returning({ id: words.id });
        wordId = created.id;
      }

      // encounter 存的是**句子**，不是 inbox 里的原始输入：
      // - 造句的条目，原始输入只是个孤立单词，存进来复习时底部什么也看不到
      // - 网页分享的条目，原始输入夹着标题和 URL，存进来是噪音
      // 原始输入不会丢 —— inbox.raw_text 永久保留。
      const [encounter] = await tx
        .insert(encounters)
        .values({
          wordId,
          rawText: draft.sentence,
          source: draft.generated ? `${row.source}+ai` : row.source,
          note: draft.definition,
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
      return NextResponse.json({ error: '这条已经处理过了' }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
