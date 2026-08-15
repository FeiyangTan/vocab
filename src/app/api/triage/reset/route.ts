import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { resetRound } from '@/lib/triage';

/**
 * "New round". `POST /api/triage/reset` body `{ categoryId: <id|'all'> }`
 *
 * Clears the Know flags in scope and re-stamps positions in frequency order — so a round
 * forgets completely when it ends, and a word you knew last round comes up again next round.
 * This mode is "sweep through a batch of words", not long-term memory scheduling (that's
 * cloze review's job).
 *
 * 🔴 **Scoped**: triggering it from inside a category resets only that category and never
 * wipes another category's progress.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { categoryId?: unknown } | null;
  const scope = parseScope(body?.categoryId);
  if (scope === null) {
    return NextResponse.json({ error: "categoryId must be a category id or 'all'" }, { status: 400 });
  }

  const db = getDb();
  if (scope !== 'all') {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, scope))
      .limit(1);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
  }

  const result = await db.execute(resetRound(scope));
  return NextResponse.json({ ok: true, queued: result.rowCount ?? 0 });
}
