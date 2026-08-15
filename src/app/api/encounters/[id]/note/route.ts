import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { encounters } from '@/db/schema';

/**
 * Edit one encounter's definition.
 * `PUT /api/encounters/{id}/note` body `{ note: string | null }`
 *
 * The definition hangs off the **encounter**, not the word — the same word can mean different
 * things in different contexts (brew: `泡；煮（茶、咖啡）` vs `泡（茶）；煮（咖啡）`), so this
 * edits the definition for *this* encounter and leaves the word's other encounters alone.
 *
 * Like the confusables and note endpoints, it's a whole replacement and idempotent.
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  if (!body || !('note' in body)) {
    return NextResponse.json({ error: 'Missing note' }, { status: 400 });
  }
  const raw = typeof body.note === 'string' ? body.note.trim() : '';
  const note = raw || null;

  const updated = await getDb()
    .update(encounters)
    .set({ note })
    .where(eq(encounters.id, id))
    .returning({ id: encounters.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, note });
}
