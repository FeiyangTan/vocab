import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories, inbox } from '@/db/schema';
import { COOKIE_NAME, isValidInboxToken, isValidSession } from '@/lib/auth';
import { parseCategoryId } from '@/lib/categories';

/**
 * Where captures land. **Accepts either identity**:
 *
 * - `?t=<token>` — for the iOS Shortcut. The token goes in the query rather than a header
 *   because adding headers in Shortcuts is painful.
 * - the login cookie — for adding by hand on the web, so the frontend needn't embed the token
 *   in JS.
 *
 * This route is in proxy.ts's PUBLIC_PATHS (the proxy lets it through), so both checks have
 * to happen here.
 *
 * Stored verbatim: no lemmatisation, no dedupe, no filing, no cloze. All of that belongs to
 * the drafting stage — any processing at capture time eats into the three-second budget.
 *
 * The one exception is `split: true`, which splits on newlines; **only the web input box
 * sends that field**. The Shortcut doesn't → the iOS path's behaviour is byte-for-byte
 * unchanged (sharing a web page, iOS sends "page text + newline + URL", and splitting that
 * would produce a junk URL-only item every single time).
 *
 * `category_id` is likewise optional: the web box sends it, the Shortcut doesn't. Absent
 * means null, and the review page falls back to the default category — filing is still not a
 * question capture has to answer.
 */

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('t');
  const authorized =
    isValidInboxToken(token) ||
    (await isValidSession((await cookies()).get(COOKIE_NAME)?.value));

  if (!authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let rawText: string;
  let source = 'unknown';
  let split = false;
  let categoryId: number | null = null;
  try {
    const body = (await request.json()) as {
      raw_text?: unknown;
      source?: unknown;
      split?: unknown;
      category_id?: unknown;
    };
    if (typeof body.raw_text !== 'string' || body.raw_text.trim().length === 0) {
      return NextResponse.json({ error: 'raw_text cannot be empty' }, { status: 400 });
    }
    rawText = body.raw_text;
    if (typeof body.source === 'string' && body.source.length > 0) source = body.source;
    split = body.split === true;
    if (body.category_id !== undefined && body.category_id !== null) {
      categoryId = parseCategoryId(body.category_id);
      if (!categoryId) {
        return NextResponse.json({ error: 'category_id must be a category id' }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  // Splitting: trim each line, drop the empty ones.
  // Not splitting: trim only the ends — interior newlines must survive, which is the whole
  // point of "the whole block is one item" (line wraps copied from a PDF, and iOS's
  // "text + newline + URL" share, both depend on staying intact).
  const texts = split
    ? rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    : [rawText.trim()];

  if (texts.length === 0) {
    return NextResponse.json({ error: 'raw_text cannot be empty' }, { status: 400 });
  }

  const db = getDb();

  if (categoryId) {
    const [found] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);
    if (!found) {
      return NextResponse.json({ error: 'Category not found' }, { status: 400 });
    }
  }

  try {
    const rows = await db
      .insert(inbox)
      .values(texts.map((t) => ({ rawText: t, source, categoryId })))
      .returning({ id: inbox.id });
    return NextResponse.json({ ids: rows.map((r) => r.id), count: rows.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
