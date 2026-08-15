import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { cleanContrasts } from '@/lib/contrasts';
import { contrastHintsFor } from '@/lib/dictionary';

/**
 * Set a word's confusables. `PUT /api/words/{id}/contrasts` body `{ contrasts: string[] }`
 *
 * A **whole-set replacement** rather than incremental add/remove — idempotent, shared by the
 * review page and the words page, so the frontend edits the current array and sends all of it
 * back, with no second code path to maintain.
 */

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { contrasts?: unknown } | null;
  const contrasts = cleanContrasts(body?.contrasts);
  if (!contrasts) {
    return NextResponse.json({ error: 'contrasts must be an array of strings' }, { status: 400 });
  }

  const updated = await getDb()
    .update(words)
    .set({ contrasts })
    .where(eq(words.id, id))
    .returning({ id: words.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }
  // Include the glosses so a newly added word has its tooltip immediately, without a
  // refresh
  return NextResponse.json({ ok: true, contrasts, glosses: contrastHintsFor(contrasts) });
}
