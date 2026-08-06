import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';
import { PROCESS_BATCH_SIZE } from '@/lib/batch';
import { draftFromInbox } from '@/lib/claude';
import { splitContrastSuffix } from '@/lib/contrasts';

/**
 * 整理阶段：取若干条 pending 且还没处理过的，调 Claude 生成草稿写回 draft 列。
 *
 * **不改 status** —— 还是 pending，等审核页确认。写库是确认时才发生的事。
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

  // `carve (cave)` 里的括号要在**送给 Claude 之前**剥掉：留着的话它会把
  // "carve (cave)" 当成原句，cloze 里就带着括号，target 也可能挑错。
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
    // Claude 回填的 id 必须是我们发过去的那批之一，否则丢弃 —— 别让模型的输出决定写哪一行
    if (!wanted.has(d.id)) continue;
    const { id, ...rest } = d;
    // 对比词不来自模型（schema 里就没这个字段），在这儿并进去
    const draft = { ...rest, contrasts: contrastsById.get(id) ?? [] };
    await db.update(inbox).set({ draft }).where(eq(inbox.id, id));
    processed += 1;
  }

  return NextResponse.json({ processed, requested: rows.length });
}
