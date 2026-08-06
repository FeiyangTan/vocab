import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { listCategories } from '@/db/queries';
import { categories } from '@/db/schema';
import { cleanCategoryName } from '@/lib/categories';

/**
 * 分类的增查。`GET /api/categories` / `POST /api/categories`
 *
 * 列表带每个分类的词数 —— 删除时要靠它决定「能不能直接删」还是「先转移」。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ categories: await listCategories() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanCategoryName(body?.name);
  if (!name) {
    return NextResponse.json({ error: '分类名不能为空' }, { status: 400 });
  }

  const db = getDb();

  // 重名在库层没有唯一约束（名字可改，加约束会让改名路径也要处理冲突），
  // 这里查一次就够 —— 单人应用，不存在并发新建同名的场景。
  const [dup] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  if (dup) {
    return NextResponse.json({ error: `已经有一个叫「${name}」的分类了` }, { status: 409 });
  }

  // 排在最后。sortOrder 目前只由新建顺序决定，没有拖拽排序
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int` })
    .from(categories);

  // 库里一个分类都没有时，新建的这个就是默认分类，否则审核页没有可选中的初值
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(categories);

  const [created] = await db
    .insert(categories)
    .values({ name, sortOrder: max + 1, isDefault: count === 0 })
    .returning({ id: categories.id, name: categories.name, isDefault: categories.isDefault });

  return NextResponse.json({ category: { ...created, wordCount: 0 } }, { status: 201 });
}
