import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';
import { CaptureBox } from './capture-box';
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
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <h1 className="mb-6 text-xl font-medium tracking-tight">收集箱</h1>

      <CaptureBox />

      <ReviewList
        items={ready.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        unprocessed={unprocessed}
      />
    </main>
  );
}
