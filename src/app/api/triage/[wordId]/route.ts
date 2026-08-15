import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { pushBack } from '@/lib/triage';

/**
 * Quick pass: record one judgement.
 * `POST /api/triage/{wordId}` body `{ action: 'known' | 'unknown', scope: <id|'all'> }`
 *
 * - `known` → out of the queue for this round
 * - `unknown` → back 10 places in the queue (rules in `src/lib/triage.ts`)
 *
 * `scope` is the scope of **the queue that was on screen**, which `unknown` needs in order to
 * count "the 10th ahead" — going back 10 within All and within one category land in different
 * places, and both are correct.
 *
 * **Delete is not here** — the existing `DELETE /api/words/{id}` already cascades to
 * encounters and review cards, so there's no reason to build a second entry point.
 *
 * 🔴 Neither action **touches `cards`**: Quick pass never alters the review schedule.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ wordId: string }> }) {
  const id = Number((await ctx.params).wordId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    scope?: unknown;
  } | null;

  const action = body?.action;
  if (action !== 'known' && action !== 'unknown') {
    return NextResponse.json({ error: "action must be 'known' or 'unknown'" }, { status: 400 });
  }

  const db = getDb();

  const [word] = await db
    .select({ categoryId: words.categoryId, triageOrder: words.triageOrder })
    .from(words)
    .where(eq(words.id, id))
    .limit(1);
  if (!word) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }

  if (action === 'known') {
    await db.update(words).set({ triageDone: true }).where(eq(words.id, id));
    return NextResponse.json({ ok: true });
  }

  // With no scope supplied, fall back to the word's own category — safer than defaulting to
  // 'all': guessing too wide counts across categories and lands somewhere that doesn't match
  // what was on screen
  const scope = parseScope(body?.scope) ?? word.categoryId;
  // No position means it never entered the queue (on the normal path GET has already stamped
  // it); stamping is GET's job
  if (word.triageOrder === null) {
    return NextResponse.json({ error: 'This word is not in the queue yet' }, { status: 409 });
  }
  await db.execute(pushBack(scope, id));
  return NextResponse.json({ ok: true });
}
