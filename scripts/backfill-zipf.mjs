/**
 * A one-off script: compute `zipf` for the existing words and re-stamp `sort_order` in
 * descending frequency.
 *
 * The backfill has to run in JS — the frequency table is an npm package, and SQL has no
 * access to it.
 *
 * **It only writes SQL to stdout and never connects to the database** —
 * `@neondatabase/serverless` needs extra WebSocket setup inside a plain Node script, which
 * isn't worth the trouble for a one-off; handing it to psql is simpler, and lets you read
 * what is about to run first.
 *
 *   psql "$DATABASE_URL" -tAc "COPY (SELECT id, lemma FROM words) TO STDOUT WITH CSV" \
 *     | node scripts/backfill-zipf.mjs | psql "$DATABASE_URL"
 *
 * 🔴 This **overwrites `sort_order`**. Export a full snapshot of words before running it.
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

// This package's entry point is a .json, and importing that under ESM needs an import
// attribute; createRequire sidesteps it, which is simpler inside a script
const subtlex = createRequire(import.meta.url)('subtlex-word-frequencies');

let total = 0;
const table = new Map();
for (const { word, count } of subtlex) {
  const key = word.toLowerCase();
  table.set(key, (table.get(key) ?? 0) + count);
  total += count;
}
const zipfOf = (lemma) => {
  const count = table.get(lemma.trim().toLowerCase());
  return count ? Math.round(Math.log10((count / total) * 1e9) * 100) / 100 : null;
};

const rows = [];
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  // CSV: id,lemma — a lemma may contain a comma (`remote control` doesn't, but split on the
  // first one to be safe)
  const at = line.indexOf(',');
  const id = Number(line.slice(0, at));
  let lemma = line.slice(at + 1);
  if (lemma.startsWith('"') && lemma.endsWith('"')) lemma = lemma.slice(1, -1).replaceAll('""', '"');
  rows.push({ id, lemma, zipf: zipfOf(lemma) });
}

// Common words first; those not in the corpus (null) last, ties broken stably by alphabet
rows.sort((a, b) => (b.zipf ?? -1) - (a.zipf ?? -1) || a.lemma.localeCompare(b.lemma));

const missing = rows.filter((r) => r.zipf === null);
process.stderr.write(
  `${rows.length} words, ${missing.length} not in the corpus: ${missing.map((r) => r.lemma).join(', ')}\n`,
);
process.stderr.write(
  `first 5: ${rows.slice(0, 5).map((r) => `${r.lemma}(${r.zipf})`).join(' ')}\n` +
    `last 5: ${rows.slice(-5).map((r) => `${r.lemma}(${r.zipf})`).join(' ')}\n`,
);

const values = rows
  .map((r, i) => `(${r.id}::bigint, ${r.zipf === null ? 'NULL' : r.zipf}::real, ${i + 1}::int)`)
  .join(',\n  ');

process.stdout.write(`UPDATE words AS w
SET zipf = v.zipf, sort_order = v.sort_order
FROM (VALUES
  ${values}
) AS v(id, zipf, sort_order)
WHERE w.id = v.id;
`);
