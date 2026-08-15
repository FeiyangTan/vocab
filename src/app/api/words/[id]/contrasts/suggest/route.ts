import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { suggestContrasts } from '@/lib/claude';
import { cleanContrasts, MAX_CONTRASTS } from '@/lib/contrasts';
import { contrastHintsFor, looksLikeRealWord } from '@/lib/dictionary';
import { COMMON_ZIPF, isCommon, isCommonEnoughForHomophone } from '@/lib/frequency';
import { homophonesOf } from '@/lib/phonetics';

/**
 * Ask Claude for look-alike / sound-alike confusables and **add them directly**.
 * `POST /api/words/{id}/contrasts/suggest`
 *
 * 🔴 **Merged, not overwritten** — the same rule as in the confirm endpoint. A manually added
 * confusable is something he got wrong himself and wrote down, and the model's suggestions
 * must never wash it away.
 *
 * A failed call returns 502 and touches nothing in the database — better to make someone
 * retry than to write half a result.
 */
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const db = getDb();
  const [word] = await db
    .select({ id: words.id, lemma: words.lemma, contrasts: words.contrasts })
    .from(words)
    .where(eq(words.id, id))
    .limit(1);
  if (!word) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }

  let suggested: string[];
  try {
    suggested = await suggestContrasts(word.lemma);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }

  /*
   * Two filters, both applied **only to the model's suggestions**:
   * 1. drop the target word itself (the model doesn't always comply)
   * 2. drop anything not common enough — the prompt already asks for "within IELTS range",
   *    but that's a request; this is the guarantee. A rare word makes a useless confusable,
   *    because nobody confuses a word they've never seen with anything.
   *
   * 🔴 `word.contrasts` (added by hand) **passes through neither filter**. Whether something
   * is too rare is not the system's call to make.
   */
  const lower = word.lemma.trim().toLowerCase();
  const fresh = suggested.filter((w) => w.trim().toLowerCase() !== lower && isCommon(w));
  const dropped = suggested.length - fresh.length;

  /*
   * **Homophones are computed separately, rather than hoping the model remembers them.**
   *
   * Identical phonetics is what a homophone is — enumerated mechanically from CMUdict's
   * phonetics table, exact and exhaustive (`flee/flea`, `forth/fourth`, `whine/wine` are ones
   * the model won't reliably produce).
   *
   * Frequency uses **the looser line** (`HOMOPHONE_ZIPF`): 3.5 exists to stop the model from
   * padding, whereas a homophone is a computed fact, and 3.5 would wrongly cut real ones like
   * `pore`(2.68) and `oar`(2.93) — precisely the words most easily misspelled. On top of that
   * comes a "does this look like a real English word" check, which blocks the foreign words
   * and names that sit in the phonetics table (`pour → por` is a Spanish abbreviation,
   * `bare → bache` is a personal name).
   */
  const homophones = homophonesOf(word.lemma).filter(
    (w) => isCommonEnoughForHomophone(w) && looksLikeRealWord(w),
  );

  // Homophones come before the model's suggestions — they're certain, the model's are
  // guesses
  const contrasts =
    cleanContrasts([...word.contrasts, ...homophones, ...fresh])?.slice(0, MAX_CONTRASTS) ??
    word.contrasts;
  const added = contrasts.filter((w) => !word.contrasts.includes(w));

  if (added.length > 0) {
    await db.update(words).set({ contrasts }).where(eq(words.id, id));
  }

  return NextResponse.json({
    ok: true,
    contrasts,
    added,
    glosses: contrastHintsFor(contrasts),
    // When nothing survives, the frontend has to say "found none" rather than appear
    // unresponsive
    dropped,
    threshold: COMMON_ZIPF,
  });
}
