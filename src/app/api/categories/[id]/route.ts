import { and, eq, ne, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories, words } from '@/db/schema';
import { cleanCategoryName, parseCategoryId } from '@/lib/categories';

/**
 * 改名 / 设为默认 / 删除。
 *
 * `PATCH /api/categories/{id}`  body: `{ name?: string; isDefault?: true }`
 * `DELETE /api/categories/{id}?moveTo=<id>`
 *
 * 删除策略：分类里还有词就**不删**，必须带 `moveTo` 把词转走。库层的
 * `onDelete: 'restrict'` 是同一条规则的第二道保险 —— 这里的检查只是为了
 * 给出能看懂的报错，真正拦住数据丢失的是外键。
 */
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseCategoryId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    isDefault?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: '空请求' }, { status: 400 });

  const db = getDb();

  const [target] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (!target) return NextResponse.json({ error: '分类不存在' }, { status: 404 });

  if (body.name !== undefined) {
    const name = cleanCategoryName(body.name);
    if (!name) return NextResponse.json({ error: '分类名不能为空' }, { status: 400 });

    const [dup] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name), ne(categories.id, id)))
      .limit(1);
    if (dup) {
      return NextResponse.json({ error: `已经有一个叫「${name}」的分类了` }, { status: 409 });
    }

    await db.update(categories).set({ name }).where(eq(categories.id, id));
  }

  if (body.isDefault === true) {
    // 「恰好一个默认」没有数据库约束能表达，只能靠事务：先全置 false 再置一个 true
    await db.transaction(async (tx) => {
      await tx.update(categories).set({ isDefault: false }).where(ne(categories.id, id));
      await tx.update(categories).set({ isDefault: true }).where(eq(categories.id, id));
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseCategoryId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const moveTo = parseCategoryId(new URL(request.url).searchParams.get('moveTo'));
  if (moveTo === id) {
    return NextResponse.json({ error: '不能转移到自己' }, { status: 400 });
  }

  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: categories.id, isDefault: categories.isDefault })
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);
      if (!target) throw new Error('NOT_FOUND');

      // 词必须有归属，所以最后一个分类删不得
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(categories);
      if (total <= 1) throw new Error('LAST_ONE');

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(words)
        .where(eq(words.categoryId, id));

      if (count > 0) {
        if (!moveTo) throw new Error('HAS_WORDS');
        const [dest] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, moveTo))
          .limit(1);
        if (!dest) throw new Error('BAD_MOVE_TO');
        await tx.update(words).set({ categoryId: moveTo }).where(eq(words.categoryId, id));
      }

      await tx.delete(categories).where(eq(categories.id, id));

      // 删掉的是默认分类，默认得有个去处，否则审核页没有初值可选
      if (target.isDefault) {
        const [next] = await tx
          .select({ id: categories.id })
          .from(categories)
          .orderBy(categories.sortOrder, categories.id)
          .limit(1);
        if (next) {
          await tx.update(categories).set({ isDefault: true }).where(eq(categories.id, next.id));
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: '分类不存在' }, { status: 404 });
    }
    if (message === 'LAST_ONE') {
      return NextResponse.json({ error: '至少要留一个分类' }, { status: 409 });
    }
    if (message === 'HAS_WORDS') {
      return NextResponse.json({ error: '这个分类里还有词，先选一个转移目标' }, { status: 409 });
    }
    if (message === 'BAD_MOVE_TO') {
      return NextResponse.json({ error: '转移目标不存在' }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
