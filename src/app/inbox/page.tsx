import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import Link from 'next/link';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';
import { ReviewList } from './review-list';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const db = getDb();

  const ready = await db
    .select({
      id: inbox.id,
      rawText: inbox.rawText,
      source: inbox.source,
      draft: inbox.draft,
      createdAt: inbox.createdAt,
    })
    .from(inbox)
    .where(and(eq(inbox.status, 'pending'), isNotNull(inbox.draft)))
    .orderBy(inbox.id);

  const [{ count: unprocessed }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inbox)
    .where(and(eq(inbox.status, 'pending'), isNull(inbox.draft)));

  return (
    <main className="mx-auto w-full max-w-xl p-4 pb-24">
      <header className="mb-6 flex items-baseline justify-between">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          ← vocab
        </Link>
        <span className="text-sm opacity-60">收集箱</span>
      </header>

      <ReviewList
        items={ready.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        unprocessed={unprocessed}
      />
    </main>
  );
}
