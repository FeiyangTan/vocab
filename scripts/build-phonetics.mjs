/**
 * Build the **US** phonetics table `src/lib/phonetics-data.json` from CMUdict.
 *
 *   node scripts/build-phonetics.mjs
 *
 * Source: the **CMU Pronouncing Dictionary** (Carnegie Mellon, 135,155 entries, the standard
 * free source for American English), distributed via the npm package
 * `cmu-pronouncing-dictionary`.
 *
 * 🔴 **ECDICT's `phonetic` field is not used** — it is **British**, recognisably so:
 * `car → kɑ:` and `better → 'betә` both lack the rhotic r. Its coverage is better, but passing
 * British off as American is simply wrong.
 *
 * CMUdict gives ARPAbet phonemes, converted to IPA here. The reduction matches the Chinese
 * lookup (Zipf ≥ 2.0 in SUBTLEX) and produces about 0.95MB.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { dictionary } = require('cmu-pronouncing-dictionary');
const subtlex = require('subtlex-word-frequencies');

const MIN_ZIPF = 2.0;

/** The 39 ARPAbet phonemes → IPA (American) */
const PHONEMES = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð',
  EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
  F: 'f', G: 'ɡ', HH: 'h', IH: 'ɪ', IY: 'i', JH: 'dʒ',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', OW: 'oʊ', OY: 'ɔɪ',
  P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ',
  UH: 'ʊ', UW: 'u', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

/**
 * ARPAbet → IPA. Two things you cannot assume:
 *
 * 1. **The stress mark goes before the whole syllable, not before the vowel.** Emitting
 *    phoneme by phoneme yields `/wˈɔtɚ/`, where the correct form is `/ˈwɔtɚ/` — so it has to
 *    walk back from the vowel to the start of the consonant cluster.
 * 2. **Unstressed ER / AH become ɚ / ə** (`better` → `ˈbɛtɚ`), which is the standard American
 *    notation.
 */
function toIPA(arpabet) {
  const tokens = [];
  for (const part of arpabet.split(' ')) {
    const m = part.match(/^([A-Z]+)([012])?$/);
    if (!m || !PHONEMES[m[1]]) continue;
    let symbol = PHONEMES[m[1]];
    if (m[1] === 'ER' && m[2] === '0') symbol = 'ɚ';
    if (m[1] === 'AH' && m[2] === '0') symbol = 'ə';
    tokens.push({ symbol, stress: m[2], vowel: m[2] !== undefined });
  }

  // For each stressed vowel, insert the mark at the start of its syllable (the position just
  // after the previous vowel)
  const marks = new Map();
  let prevVowel = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].vowel) continue;
    if (tokens[i].stress === '1' || tokens[i].stress === '2') {
      marks.set(prevVowel + 1, tokens[i].stress === '1' ? 'ˈ' : 'ˌ');
    }
    prevVowel = i;
  }

  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    if (marks.has(i)) out += marks.get(i);
    out += tokens[i].symbol;
  }
  return out;
}

let corpusTotal = 0;
const counts = new Map();
for (const { word, count } of subtlex) {
  const key = word.toLowerCase();
  counts.set(key, (counts.get(key) ?? 0) + count);
  corpusTotal += count;
}
const zipf = (word) => Math.log10((counts.get(word) / corpusTotal) * 1e9);

const out = {};
for (const word of Object.keys(dictionary)) {
  if (!counts.has(word) || zipf(word) < MIN_ZIPF) continue;
  const ipa = toIPA(dictionary[word]);
  if (ipa) out[word] = ipa;
}

const json = JSON.stringify(out);
writeFileSync('src/lib/phonetics-data.json', json);
console.error(
  `CMUdict ${Object.keys(dictionary).length.toLocaleString()} entries → kept ` +
    `${Object.keys(out).length.toLocaleString()}, ` +
    `${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB → src/lib/phonetics-data.json`,
);
