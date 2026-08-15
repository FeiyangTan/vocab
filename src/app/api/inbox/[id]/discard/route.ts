import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';

/** Discard: flips the inbox status only; writes nothing to words/encounters/cards. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const updated = await getDb()
    .update(inbox)
    .set({ status: 'discarded' })
    .where(and(eq(inbox.id, id), eq(inbox.status, 'pending')))
    .returning({ id: inbox.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'This item was already handled' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
