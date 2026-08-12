/**
 * 一次性脚本：给已有的词算 `zipf`，并按词频降序重排 `sort_order`。
 *
 * 回填必须走 JS —— 频率表是个 npm 包，SQL 里没有这张表。
 *
 * **只往 stdout 吐 SQL，自己不连库** —— `@neondatabase/serverless` 在纯 Node
 * 脚本里还要额外配 WebSocket，一次性脚本不值得为它折腾；交给 psql 更省事，
 * 顺便能先看一眼要执行什么。
 *
 *   psql "$DATABASE_URL" -tAc "COPY (SELECT id, lemma FROM words) TO STDOUT WITH CSV" \
 *     | node scripts/backfill-zipf.mjs | psql "$DATABASE_URL"
 *
 * 🔴 会**覆盖 `sort_order`**。跑之前先导出 words 全表快照。
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

// 这个包的入口就是一个 .json，ESM 下 import 它要加 import attribute；
// 用 createRequire 绕开，脚本里更省事
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
  // CSV：id,lemma —— lemma 里可能有逗号（`remote control` 没有，但保险起见只切第一个）
  const at = line.indexOf(',');
  const id = Number(line.slice(0, at));
  let lemma = line.slice(at + 1);
  if (lemma.startsWith('"') && lemma.endsWith('"')) lemma = lemma.slice(1, -1).replaceAll('""', '"');
  rows.push({ id, lemma, zipf: zipfOf(lemma) });
}

// 常见的排前面；未收录的（null）排最后，同分按字母序保持稳定
rows.sort((a, b) => (b.zipf ?? -1) - (a.zipf ?? -1) || a.lemma.localeCompare(b.lemma));

const missing = rows.filter((r) => r.zipf === null);
process.stderr.write(
  `词总数 ${rows.length}，未收录 ${missing.length}：${missing.map((r) => r.lemma).join(', ')}\n`,
);
process.stderr.write(
  `前 5：${rows.slice(0, 5).map((r) => `${r.lemma}(${r.zipf})`).join(' ')}\n` +
    `后 5：${rows.slice(-5).map((r) => `${r.lemma}(${r.zipf})`).join(' ')}\n`,
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
