import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';
import { PROCESS_BATCH_SIZE } from '@/lib/batch';
import { draftFromInbox } from '@/lib/claude';
import { splitContrastSuffix } from '@/lib/contrasts';

/**
 * The drafting stage: take a few items that are pending and not yet processed, call Claude,
 * and write the drafts back into the draft column.
 *
 * **Does not change status** — they stay pending, awaiting confirmation on the review page.
 * Writing to the real tables only happens at confirm time.
 */

export async function POST() {
  const db = getDb();

  const rows = await db
    .select({ id: inbox.id, rawText: inbox.rawText, source: inbox.source })
    .from(inbox)
    .where(and(eq(inbox.status, 'pending'), isNull(inbox.draft)))
    .orderBy(inbox.id)
    .limit(PROCESS_BATCH_SIZE);

  if (rows.length === 0) return NextResponse.json({ processed: 0 });

  // The parentheses in `carve (cave)` have to be stripped **before** the text reaches
  // Claude: left in, it treats "carve (cave)" as the original sentence, the cloze carries
  // the parentheses, and it may well pick the wrong target.
  const stripped = rows.map((r) => {
    const { text, contrasts } = splitContrastSuffix(r.rawText);
    return { ...r, rawText: text, contrasts };
  });
  const contrastsById = new Map(stripped.map((r) => [r.id, r.contrasts]));

  let drafts;
  try {
    drafts = await draftFromInbox(stripped);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }

  const wanted = new Set(rows.map((r) => r.id));
  let processed = 0;

  for (const d of drafts) {
    // An id Claude echoes back must be one we sent, otherwise drop it — never let the
    // model's output decide which row gets written
    if (!wanted.has(d.id)) continue;
    const { id, ...rest } = d;
    // Neither confusables nor the note come from the model (the schema has no such fields);
    // they're merged in here. A note can only be written by hand and has no place at capture
    // time, so it always starts as null
    const draft = { ...rest, contrasts: contrastsById.get(id) ?? [], remark: null };

    await db.update(inbox).set({ draft }).where(eq(inbox.id, id));
    processed += 1;
  }

  return NextResponse.json({ processed, requested: rows.length });
}
