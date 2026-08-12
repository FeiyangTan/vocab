import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { categories } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { ReviewSession } from './review-session';

export const dynamic = 'force-dynamic';

/**
 * 路由用分类 **id** 不用名字：分类名可以是中文（放进 URL 要百分号编码），
 * 而且改名会让已有链接失效。id 稳定，标题再显示名字。
 *
 * `/review/all` 也落在这个动态段上 —— 「全部」和一个分类只是取卡范围不同，
 * 没必要为它再开一套页面。
 */
export default async function CategoryReviewPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const scope = parseScope((await params).categoryId);
  if (scope === null) notFound();

  if (scope === 'all') {
    return <ReviewSession scope="all" name="全部" />;
  }

  const [category] = await getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, scope))
    .limit(1);
  if (!category) notFound();

  return <ReviewSession scope={String(category.id)} name={category.name} />;
}
