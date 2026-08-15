import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { categories } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { ReviewSession } from './review-session';

export const dynamic = 'force-dynamic';

/**
 * The route uses the category **id** rather than its name: names can be Chinese (which needs
 * percent-encoding in a URL), and renaming would break existing links. The id is stable, and
 * the heading shows the name.
 *
 * `/review/all` lands on this dynamic segment too — "All" differs from one category only in
 * which cards are eligible, so it needs no separate page.
 */
export default async function CategoryReviewPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const scope = parseScope((await params).categoryId);
  if (scope === null) notFound();

  if (scope === 'all') {
    return <ReviewSession scope="all" name="All" />;
  }

  const [category] = await getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, scope))
    .limit(1);
  if (!category) notFound();

  return <ReviewSession scope={String(category.id)} name={category.name} />;
}
