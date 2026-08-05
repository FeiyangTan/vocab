import { eq, lte, sql } from 'drizzle-orm';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { getDb } from '@/db';
import { cards, encounters, words } from '@/db/schema';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** work / daily 两个队列分开 —— 工作时不想被生活词打断，反之亦然。 */
export default async function ReviewPage() {
  const rows = await getDb()
    .select({ domain: words.domain, count: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(lte(cards.due, new Date()))
    .groupBy(words.domain);

  const due = (d: 'work' | 'daily') => rows.find((r) => r.domain === d)?.count ?? 0;

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <h1 className="mb-6 text-xl font-medium tracking-tight">复习</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        {(['work', 'daily'] as const).map((d) => {
          const n = due(d);
          const empty = n === 0;
          return (
            <Link
              key={d}
              href={empty ? '/review' : `/review/${d}`}
              aria-disabled={empty}
              className={cn(empty && 'pointer-events-none')}
            >
              <Card
                className={cn(
                  'flex-row items-center justify-between px-5 py-5 transition-colors',
                  empty ? 'opacity-45' : 'hover:border-foreground/30',
                )}
              >
                <div>
                  <div className="text-base font-medium">{d}</div>
                  <div className="text-sm text-muted-foreground">
                    {empty ? '没有到期的' : `${n} 张到期`}
                  </div>
                </div>
                {!empty && <ChevronRight className="size-4 text-muted-foreground" />}
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
