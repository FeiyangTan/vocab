/**
 * Build the reduced English → Chinese lookup `src/lib/dictionary-data.json` from ECDICT.
 *
 * Source: https://github.com/skywind3000/ECDICT (MIT, 770k entries)
 *   curl -sLO https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
 *   node scripts/build-dictionary.mjs ecdict.csv
 *
 * 🔴 **The source CSV is 63MB and is not committed**; the generated JSON (about 2.2MB) is,
 * so production needs no download step at all.
 *
 * Reduction rules:
 * - keep only words at **Zipf ≥ 2.0** in SUBTLEX (about 45k). The tighter 3.5 line would drop
 *   `crispy`, `crypt`, `adapt` — all **manually added** confusables, and manual ones are
 *   exactly the ones that most need a hint.
 * - keep only the **first line** of `translation`, truncated to 40 characters: a full gloss
 *   runs several lines and won't fit a tooltip.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const subtlex = require('subtlex-word-frequencies');

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/build-dictionary.mjs <path to ecdict.csv>');
  process.exit(1);
}

/** Keep only words common enough to be worth a lookup entry. Looser than the 3.5 line used
 *  for AI suggestions — see the file header */
const MIN_ZIPF = 2.0;
const MAX_GLOSS = 40;

let corpusTotal = 0;
const counts = new Map();
for (const { word, count } of subtlex) {
  const key = word.toLowerCase();
  counts.set(key, (counts.get(key) ?? 0) + count);
  corpusTotal += count;
}
const zipf = (word) => Math.log10((counts.get(word) / corpusTotal) * 1e9);

/** ECDICT's gloss field contains quotes and commas, so it has to be scanned character by
 *  character; split(',') won't do */
function cells(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(source, 'utf8').split('\n');
const dict = {};
let scanned = 0;

for (let i = 1; i < lines.length; i++) {
  const row = cells(lines[i]);
  const word = row[0]?.toLowerCase();
  if (!word) continue;
  scanned++;
  if (!counts.has(word) || zipf(word) < MIN_ZIPF) continue;
  // translation is multi-line, and `\n` appears in the CSV as two literal characters
  const gloss = (row[3] ?? '').split('\\n')[0].trim().slice(0, MAX_GLOSS);
  if (gloss) dict[word] = gloss;
}

const json = JSON.stringify(dict);
writeFileSync('src/lib/dictionary-data.json', json);
console.error(
  `scanned ${scanned.toLocaleString()}, kept ${Object.keys(dict).length.toLocaleString()}, ` +
    `${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB → src/lib/dictionary-data.json`,
);
