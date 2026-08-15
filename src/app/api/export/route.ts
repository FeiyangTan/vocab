import { asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { cards, encounters, inbox, words } from '@/db/schema';

/**
 * Full-database export. Cookie-authenticated (the proxy guards this route by default).
 *
 * This is the **off-site layer** of the backup — Neon branch snapshots live inside Neon, and
 * go with it if the Neon project does. Opening this URL in a browser downloads a JSON file;
 * saving it to the Mac gives you a copy that exists outside Neon.
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
