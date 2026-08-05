import { asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { cards, encounters, inbox, words } from '@/db/schema';

/**
 * 全库导出。走 cookie 鉴权（proxy 默认拦截这条路由）。
 *
 * 这是备份的**异地那一层** —— Neon 分支快照存在 Neon 内部，Neon 项目本身没了就一起没。
 * 浏览器打开这个地址会直接下载一个 JSON 文件，存到 Mac 上就有了一份 Neon 之外的副本。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();

  const [inboxRows, wordRows, encounterRows, cardRows] = await Promise.all([
    db.select().from(inbox).orderBy(asc(inbox.id)),
    db.select().from(words).orderBy(asc(words.id)),
    db.select().from(encounters).orderBy(asc(encounters.id)),
    db.select().from(cards).orderBy(asc(cards.id)),
  ]);

  const now = new Date();
  const payload = {
    exported_at: now.toISOString(),
    counts: {
      inbox: inboxRows.length,
      words: wordRows.length,
      encounters: encounterRows.length,
      cards: cardRows.length,
    },
    inbox: inboxRows,
    words: wordRows,
    encounters: encounterRows,
    cards: cardRows,
  };

  const date = now.toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="vocab-backup-${date}.json"`,
    },
  });
}
