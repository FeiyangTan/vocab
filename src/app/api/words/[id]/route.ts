import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories, words } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { zipfOf } from '@/lib/frequency';

/**
 * 删掉一个词。`DELETE /api/words/{id}`
 *
 * 🔴 **连带删掉它的所有 encounter 和复习卡** —— `encounters.word_id` 和
 * `cards.encounter_id` 的外键都是 `onDelete: cascade`，所以一条 DELETE 就够，
 * 但也意味着这个词的原句、释义、复习进度全没了，**没有撤销**。
 * 界面上因此要求点两次。
 */
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const deleted = await getDb()
    .delete(words)
    .where(eq(words.id, id))
    .returning({ id: words.id, lemma: words.lemma });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lemma: deleted[0].lemma });
}

/**
 * drizzle 把原始的 pg 错误包了一层，错误码在 `cause` 链上、**不在字符串里** ——
 * 用 `String(error).includes('23505')` 判断是抓不到的（会漏成 500）。
 */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

/**
 * 改词或换分类。`PATCH /api/words/{id}` body `{ lemma?: string; categoryId?: number }`
 *
 * 🔴 目标分类里已经有同名的词时**返回 409，不做合并**。合并要决定留哪条释义、
 * 哪些原句、哪张卡的复习进度，是个有损操作 —— 静默做掉最糟。库里就有现成的
 * 案例：`sneak` 同时存在于两个分类。
 *
 * 落到新分类的**末尾**（取该分类现有的 max+1），不去猜该插在哪儿。
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    lemma?: unknown;
    categoryId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Empty request' }, { status: 400 });

  const db = getDb();

  const [word] = await db
    .select({ lemma: words.lemma, categoryId: words.categoryId })
    .from(words)
    .where(eq(words.id, id))
    .limit(1);
  if (!word) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }

  // ---- 改词 ----
  if (body.lemma !== undefined) {
    const lemma = typeof body.lemma === 'string' ? body.lemma.trim().slice(0, 80) : '';
    if (!lemma) {
      return NextResponse.json({ error: 'Word cannot be empty' }, { status: 400 });
    }
    try {
      // 词频跟着换 —— 不重算的话新词会挂着旧词的 zipf，排序和档位条全是错的
      await db
        .update(words)
        .set({ lemma, zipf: zipfOf(lemma) })
        .where(eq(words.id, id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: `This category already has ${lemma}` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
    return NextResponse.json({ ok: true, lemma, zipf: zipfOf(lemma) });
  }

  // ---- 换分类 ----
  const categoryId = parseCategoryId(body.categoryId);
  if (!categoryId) {
    return NextResponse.json({ error: 'categoryId must be a category id' }, { status: 400 });
  }

  const [category] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 400 });
  }

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${words.sortOrder}), 0)::int` })
    .from(words)
    .where(eq(words.categoryId, categoryId));

  try {
    await db
      .update(words)
      .set({ categoryId, sortOrder: max + 1 })
      .where(eq(words.id, id));
  } catch (error) {
    // 23505 = unique_violation，撞的是 (lemma, category_id) 那个唯一索引
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `${category.name} already has ${word.lemma}` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, categoryId });
}
