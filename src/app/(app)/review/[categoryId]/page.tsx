import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { categories } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { ReviewSession } from './review-session';

export const dynamic = 'force-dynamic';

/**
 * 路由用分类 **id** 不用名字：分类名可以是中文（放进 URL 要百分号编码），
 * 而且改名会让已有链接失效。id 稳定，标题再显示名字。
 */
export default async function CategoryReviewPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const id = parseCategoryId((await params).categoryId);
  if (!id) notFound();

  const [category] = await getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (!category) notFound();

  return <ReviewSession categoryId={category.id} name={category.name} />;
}
