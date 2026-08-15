import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { categories } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { PUSH_BACK } from '@/lib/triage';
import { TriageSession } from './triage-session';

export const dynamic = 'force-dynamic';

/**
 * 「快速过词」。和同级的挖空复习共用一个范围（某个分类，或 `/review/all/triage`
 * 的全部），队列和判定完全独立。
 */
export default async function TriagePage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const scope = parseScope((await params).categoryId);
  if (scope === null) notFound();

  if (scope === 'all') {
    return <TriageSession scope="all" name="All" pushBack={PUSH_BACK} />;
  }

  const [category] = await getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, scope))
    .limit(1);
  if (!category) notFound();

  return (
    <TriageSession scope={String(category.id)} name={category.name} pushBack={PUSH_BACK} />
  );
}
