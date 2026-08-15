import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { cleanRemark } from '@/lib/remark';

/**
 * Set a word's note. `PUT /api/words/{id}/remark` body `{ remark: string | null }`
 *
 * Like the confusables endpoint this is a **whole replacement** and idempotent: the words page
 * and the review page share it, and the frontend just sends the edited text back in full.
 *
 * Passing null or an empty string = clear the note (**deliberate** semantics, not an
 * oversight) — emptying the box in the UI and saving should delete the note.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { remark?: unknown } | null;
  if (!body || !('remark' in body)) {
    return NextResponse.json({ error: 'Missing remark' }, { status: 400 });
  }
  const remark = cleanRemark(body.remark);

  const updated = await getDb()
    .update(words)
    .set({ remark })
    .where(eq(words.id, id))
    .returning({ id: words.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, remark });
}
