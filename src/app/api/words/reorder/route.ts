import { inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';

/**
 * Reorder. `PUT /api/words/reorder` body `{ ids: number[] }` — the current list's new order.
 *
 * 🔴 **Only the ids passed in are reordered; nothing outside the list moves.**
 *
 * `sort_order` is one global sequence, but what's on screen is usually a filtered subset
 * (dragging among the 35 in `videos` must not disturb the other 187). The approach is to
 * **shuffle only within this batch's own set of values**: take their existing sort_orders,
 * sort them ascending, and hand them back out in the new order. The set of values is
 * unchanged, so every one of these words keeps its relative position against every word
 * outside the list.
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((v): v is number => typeof v === 'number' && Number.isInteger(v))
    : null;
  if (!ids || ids.length === 0 || ids.length !== new Set(ids).size) {
    return NextResponse.json({ error: 'ids must be an array of unique integers' }, { status: 400 });
  }

  try {
    const updated = await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ id: words.id, sortOrder: words.sortOrder })
        .from(words)
        .where(inArray(words.id, ids));
      if (rows.length !== ids.length) throw new Error('MISSING');

      // This batch's existing positions, ascending — handed back out in the new order
      const slots = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
      const pairs = ids.map((id, i) => ({ id, sortOrder: slots[i] }));

      await tx.execute(sql`
        UPDATE ${words} AS w
        SET sort_order = v.sort_order
        FROM (VALUES ${sql.join(
          pairs.map((p) => sql`(${p.id}::bigint, ${p.sortOrder}::int)`),
          sql`, `,
        )}) AS v(id, sort_order)
        WHERE w.id = v.id
      `);

      return pairs.length;
    });

    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'MISSING') {
      return NextResponse.json({ error: 'Some ids do not exist' }, { status: 404 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
