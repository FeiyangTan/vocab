import { asc, eq, lte, sql } from 'drizzle-orm';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** 每个分类一个队列 —— 工作时不想被生活词打断，反之亦然。分类由人自己在 /categories 管理。 */
export default async function ReviewPage() {
  // 从 categories 出发做左连接：没有到期卡的分类也要出现在列表里（置灰），
  // 从 cards 出发 groupBy 的话它们会整行消失。
  const rows = await getDb()
    .select({
      id: categories.id,
      name: categories.name,
      due: sql<number>`count(${cards.id})::int`,
    })
    .from(categories)
    .leftJoin(words, eq(words.categoryId, categories.id))
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .leftJoin(cards, sql`${cards.encounterId} = ${encounters.id} and ${cards.due} <= now()`)
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.id));

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <h1 className="mb-6 font-serif text-2xl font-medium tracking-tight">复习</h1>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          还没有分类，先去<Link href="/categories" className="mx-1 underline">分类</Link>建一个
        </p>
      ) : (
        /* 纸质风：队列靠发丝线分隔，不用盒子 */
        <div className="grid gap-x-8 sm:grid-cols-2">
          {rows.map((c) => {
            const empty = c.due === 0;
            return (
              <Link
                key={c.id}
                href={empty ? '/review' : `/review/${c.id}`}
                aria-disabled={empty}
                className={cn(
                  'flex items-center justify-between border-t border-border py-5 transition-opacity',
                  empty ? 'pointer-events-none opacity-45' : 'hover:opacity-70',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-serif text-xl font-medium">{c.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {empty ? '没有到期的' : `${c.due} 张到期`}
                  </div>
                </div>
                {!empty && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
