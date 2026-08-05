import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';

/**
 * 临时诊断路由：确认应用能用 pooled 连接串读到库。
 * Phase 3 的 /api/inbox 跑通后就删掉。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [row] = await getDb().select({ count: sql<number>`count(*)::int` }).from(inbox);
    return NextResponse.json({ ok: true, inboxCount: row.count });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
