import data from './phonetics-data.json';

/**
 * US phonetics (IPA) — generated from **CMUdict** by `scripts/build-phonetics.mjs`.
 *
 * 🔴 **Server-side import only.** This table is about 1MB and, like the Chinese gloss table,
 * must never reach the browser: a page only ever shows the ~30 words currently on screen,
 * so looking them up on the server and sending the results down is enough.
 *
 * Why not ECDICT's `phonetic`: that one is **British** (`car → kɑ:`, `better → 'betә`, no
 * rhotic r). Coverage is good, but passing British off as American is simply wrong.
 */
const table = data as Record<string, string>;

/** null when not found — CMUdict covers about 92.8%; phrases and rare words fall through,
 *  and British phonetics are not an acceptable substitute */
export function phoneticOf(word: string): string | null {
  return table[word.trim().toLowerCase()] ?? null;
}

/** Bulk lookup, returning only what was found. A plain object rather than a Map — it has to
 *  serialise across the server → client boundary */
export function phoneticsFor(words: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of words) {
    const ipa = phoneticOf(word);
    if (ipa) out[word] = ipa;
  }
  return out;
}

/**
 * IPA → homophone group. Built lazily once, over the same data as the main table.
 *
 * "Homophone" here means **identical phonetics** — exact and enumerable, no need to ask a
 * model to recall them. The AI path misses some (it won't always think of `flee/flea`);
 * this one doesn't.
 */
let homophones: Map<string, string[]> | null = null;

export function homophonesOf(word: string): string[] {
  if (!homophones) {
    homophones = new Map();
    for (const [w, ipa] of Object.entries(table)) {
      const group = homophones.get(ipa);
      if (group) group.push(w);
      else homophones.set(ipa, [w]);
    }
  }
  const key = word.trim().toLowerCase();
  const ipa = table[key];
  if (!ipa) return [];
  return (homophones.get(ipa) ?? []).filter((w) => w !== key);
}
