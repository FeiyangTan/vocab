import subtlex from 'subtlex-word-frequencies';

/**
 * Word frequency — an objective "how common is this" for every word, used as the default
 * sort order.
 *
 * Source: **SUBTLEX-US** (Brysbaert & New, 2009), a 50-million-word film/TV subtitle corpus,
 * 74,286 entries. Distributed via the npm package `subtlex-word-frequencies` (ISC); the
 * underlying data is CC BY-SA style.
 *
 * Choosing a subtitle corpus over a written one (COCA / Google Ngrams) has a specific
 * reason: subtitles reflect **spoken, everyday frequency**, and the categories in this
 * notebook are films and children's books to begin with.
 *
 * Measured coverage of the existing vocabulary is 95.9%; everything missed is a phrase or a
 * proper noun (`winter solstice`, `PostgreSQL`) — those **return null rather than guessing**.
 * Splitting a phrase and averaging its parts is false precision.
 */

/** Total tokens in the SUBTLEX corpus, used to convert raw counts into Zipf */
let corpusTotal = 0;
let table: Map<string, number> | null = null;

/**
 * The 74k entries are built into a table once, on first use, then cached at module level.
 * Only the confirm endpoint and the backfill script reach this — the words page reads the
 * value already stored in the database.
 */
function lookup(): Map<string, number> {
  if (table) return table;
  const next = new Map<string, number>();
  for (const entry of subtlex as { word: string; count: number }[]) {
    const key = entry.word.toLowerCase();
    // The same word appears more than once with different casing (`I` / `i`); merge counts
    next.set(key, (next.get(key) ?? 0) + entry.count);
    corpusTotal += entry.count;
  }
  table = next;
  return table;
}

/**
 * The Zipf value: `log10(count / corpus total × 10⁹)`, the standard scale in
 * psycholinguistics.
 *
 * Used instead of the raw count because raw values span 1 to 2,000,000, which can't be
 * banded directly; Zipf is linearly readable: `the` 7.5, `water` 5.4, `altar` 3.7,
 * `knitter` 1.6.
 *
 * null when not found — null means "not in the corpus", which is not the same as
 * "frequency zero".
 */
export function zipfOf(lemma: string): number | null {
  const map = lookup();
  const count = map.get(lemma.trim().toLowerCase());
  if (!count) return null;
  return Math.round(Math.log10((count / corpusTotal) * 1e9) * 100) / 100;
}

export type Band = { level: number; label: string };

/** The bands shown in the UI. level 0 = not in the corpus; 1–5 run rare → very common */
export function frequencyBand(zipf: number | null): Band {
  if (zipf === null) return { level: 0, label: 'unlisted' };
  if (zipf >= 5) return { level: 5, label: 'very common' };
  if (zipf >= 4) return { level: 4, label: 'common' };
  if (zipf >= 3) return { level: 3, label: 'mid' };
  if (zipf >= 2) return { level: 2, label: 'rare' };
  return { level: 1, label: 'very rare' };
}

/**
 * The "common word" threshold, used **only to constrain AI-generated confusables**.
 *
 * Zipf ≥ 3.5 is about 9,200 word forms in SUBTLEX — forms outnumber families because of
 * inflection, so in word families that lands roughly at IELTS scale (the usual 7,000–8,000).
 *
 * The number isn't a guess; it was calibrated against real suggestions. It cuts exactly the
 * noise — `crip`(2.45), `crips`(2.58), `halter`(2.72), `alto`(3.14) — while keeping the ones
 * genuinely confusable: `alter`(3.69), `bear`(4.77).
 *
 * 🔴 **Filters the AI's suggestions only, never what a person added by hand.** A manual entry
 * is something he got wrong himself and wrote down; whether it's rare is not the system's
 * call to make (jimmy's own `crypt` 3.15 and `crispy` 3.37 are both below this line).
 */
export const COMMON_ZIPF = 3.5;

/** Common enough to be worth showing as a confusable. Not in the corpus never counts —
 *  there's no way to confirm how common it is */
export function isCommon(word: string): boolean {
  const zipf = zipfOf(word);
  return zipf !== null && zipf >= COMMON_ZIPF;
}

/**
 * The frequency floor for homophones, looser than `COMMON_ZIPF`.
 *
 * The 3.5 line exists to constrain **the model's suggestions** — a model pads, so it needs a
 * tight bound. But homophones are a **computed fact** from the phonetics table: `pore`
 * really does rhyme with `pour`, that isn't a guess. Applying 3.5 here would wrongly cut a
 * batch of real homophones (`pore` 2.68, `oar` 2.93, `bowled` 2.79) — and those are exactly
 * the ones most easily misspelled.
 */
export const HOMOPHONE_ZIPF = 2.5;

export function isCommonEnoughForHomophone(word: string): boolean {
  const zipf = zipfOf(word);
  return zipf !== null && zipf >= HOMOPHONE_ZIPF;
}
