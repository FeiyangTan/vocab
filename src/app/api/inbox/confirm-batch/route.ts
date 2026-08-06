import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, inbox, words, type Draft } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { cleanContrasts, MAX_CONTRASTS } from '@/lib/contrasts';

/**
 * 批量确认。`POST /api/inbox/confirm-batch`
 *
 * 逐条调 `/api/inbox/{id}/confirm` 时每条是一个事务、9 个来回；数据库在 us-west-2，
 * 每个来回约 50 ms，135 条要两分钟。这里把整批做成**一个事务、约 10 个来回**，
 * 次数和条数无关。
 *
 * 🔴 **不依赖 `RETURNING` 的顺序。** 多行 `INSERT … RETURNING` 不保证返回顺序等于
 * VALUES 顺序，猜错就是卡片配错原句 —— 静默的数据错乱，只有复习时才看得出来。
 * 所以：word 靠 `lemma` 对回去（`(lemma, category_id)` 有唯一索引），
 * encounter **先从序列批量取号**再用显式 id 插。
 */
export const dynamic = 'force-dynamic';

type Item = Draft & { id: number };

/** 和单条接口同一套校验，任何一条不合格就整个请求拒掉 —— 别让事务开到一半才发现 */
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
      contrasts: cleanContrasts(b.contrasts) ?? [],
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
    return NextResponse.json({ error: '字段不完整' }, { status: 400 });
  }

  // 同一个 id 在一批里出现两次会让 encounter/card 翻倍，先去重（保留最后一次的编辑）
  const byId = new Map(items.map((i) => [i.id, i]));
  const unique = [...byId.values()];

  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      // ① 分类
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);
      if (!category) throw new Error('NO_CATEGORY');

      // ② 哪些还是 pending —— 其余的当作「已经处理过」跳过
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

      // ③ 已经存在的词
      const lemmas = [...new Set(todo.map((i) => i.lemma))];
      const existing = await tx
        .select({ id: words.id, lemma: words.lemma, contrasts: words.contrasts })
        .from(words)
        .where(and(eq(words.categoryId, categoryId), inArray(words.lemma, lemmas)));
      const wordIdByLemma = new Map(existing.map((w) => [w.lemma, w.id]));

      // ④ 批内先按 lemma 聚合 —— 同一批里两条 `dare` 共用一条 word，对比词取并集
      const contrastsByLemma = new Map<string, string[]>();
      for (const item of todo) {
        const merged = new Set(contrastsByLemma.get(item.lemma) ?? []);
        for (const c of item.contrasts) merged.add(c);
        contrastsByLemma.set(item.lemma, [...merged].slice(0, MAX_CONTRASTS));
      }

      // ⑤ 新词一次插完。lemma 在这个分类里唯一（有唯一索引），所以能靠它对回 id
      const newLemmas = lemmas.filter((l) => !wordIdByLemma.has(l));
      if (newLemmas.length > 0) {
        const created = await tx
          .insert(words)
          .values(
            newLemmas.map((lemma) => ({
              lemma,
              categoryId,
              contrasts: contrastsByLemma.get(lemma) ?? [],
            })),
          )
          .returning({ id: words.id, lemma: words.lemma });
        for (const w of created) wordIdByLemma.set(w.lemma, w.id);
      }

      // ⑥ 已有词的对比词**合并而不是覆盖** —— 第二次遇到同一个词，不该抹掉上次加的
      const merges: { id: number; contrasts: string[] }[] = [];
      for (const w of existing) {
        const incoming = contrastsByLemma.get(w.lemma) ?? [];
        const merged = [...new Set([...w.contrasts, ...incoming])].slice(0, MAX_CONTRASTS);
        if (merged.length !== w.contrasts.length) merges.push({ id: w.id, contrasts: merged });
      }
      if (merges.length > 0) {
        await tx.execute(sql`
          UPDATE ${words} AS w
          SET contrasts = v.contrasts::jsonb
          FROM (VALUES ${sql.join(
            merges.map((m) => sql`(${m.id}::bigint, ${JSON.stringify(m.contrasts)}::text)`),
            sql`, `,
          )}) AS v(id, contrasts)
          WHERE w.id = v.id
        `);
      }

      // ⑦ 先取号再插 —— 这样 cards 挂到哪个 encounter 上是**已知的**，不靠返回顺序
      const seq = await tx.execute<{ id: string }>(sql`
        SELECT nextval(pg_get_serial_sequence('encounters', 'id'))::bigint AS id
        FROM generate_series(1, ${todo.length})
      `);
      const encounterIds = seq.rows.map((r) => Number(r.id));

      // ⑧ encounters。字段口径和单条接口逐字一致：
      //    raw_text 存**句子**不是 inbox 原文；造句的条目 source 打 +ai 标记
      await tx.insert(encounters).values(
        todo.map((item, n) => ({
          id: encounterIds[n],
          wordId: wordIdByLemma.get(item.lemma)!,
          rawText: item.sentence,
          source: item.generated
            ? `${sourceById.get(item.id)}+ai`
            : sourceById.get(item.id)!,
          note: item.definition,
        })),
      );

      // ⑨ cards
      await tx.insert(cards).values(
        todo.map((item, n) => ({
          encounterId: encounterIds[n],
          clozeText: item.cloze,
        })),
      );

      // ⑩ inbox 收尾，草稿写回留档
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
      return NextResponse.json({ error: '这个分类已经不存在了' }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
