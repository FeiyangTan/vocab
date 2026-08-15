import data from './dictionary-data.json';
import { phoneticOf } from './phonetics';

/**
 * English → Chinese lookup — gives each confusable a gloss you can see on hover,
 * **costing no tokens**.
 *
 * Source: **ECDICT** (https://github.com/skywind3000/ECDICT, MIT, 770k entries), reduced by
 * `scripts/build-dictionary.mjs` into a "word → first line of the gloss" JSON.
 *
 * 🔴 **Server-side import only.** The table is 2.18MB and must never reach the browser — a
 * page only ever shows a few dozen confusables, so looking them up on the server and sending
 * the results down with the data is enough (a few hundred bytes). Never import this file
 * from a client component.
 */
const table = data as Record<string, string>;

/** null when not found — the UI then skips the tooltip rather than popping an empty one */
export function glossOf(word: string): string | null {
  return table[word.trim().toLowerCase()] ?? null;
}

/**
 * The single line shown when hovering a confusable: **US phonetics + Chinese gloss**,
 * e.g. `/ˈɔltɚ/ v. 改变`.
 *
 * A word with neither is left out of the result — with no value the frontend skips the
 * Tooltip instead of popping an empty one. With only one of the two, just that one is used;
 * no empty placeholder.
 *
 * Returns a plain object rather than a Map: it has to serialise across the server → client
 * boundary as props, and a Map doesn't survive that.
 */
export function contrastHintsFor(words: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of words) {
    const ipa = phoneticOf(word);
    const gloss = glossOf(word);
    const hint = [ipa ? `/${ipa}/` : null, gloss].filter(Boolean).join('  ');
    if (hint) out[word] = hint;
  }
  return out;
}

/**
 * Does this look like a genuine English word?
 *
 * Homophones are derived mechanically from the phonetics table, which drags in things that
 * have no business being confusables: `pour → por` (Spanish, present in the subtitle corpus),
 * `bare → bache` (a personal name). ECDICT's glosses carry markers for exactly these, so
 * filter on them.
 *
 * 🔴 The Chinese in the regex below is **not translatable** — it matches ECDICT's own gloss
 * text (人名 = personal name, 姓氏 = surname, 地名 = place name, 省名 = province,
 * 城市 = city). Translating it silently disables the filter.
 */
export function looksLikeRealWord(word: string): boolean {
  const gloss = glossOf(word);
  if (!gloss) return false;
  if (/^(abbr|prep|art)\./.test(gloss)) return false;
  return !/(人名|姓氏|地名|省名|城市|、如)/.test(gloss);
}
