/**
 * 一次性脚本：给已有的 encounter 补词性。
 *
 *   psql "$DATABASE_URL" -tAc "COPY (SELECT e.id, w.lemma, e.raw_text, e.note
 *     FROM encounters e JOIN words w ON w.id=e.word_id WHERE e.pos IS NULL) TO STDOUT WITH CSV" \
 *     | node --env-file=.env.local scripts/backfill-pos.mjs > /tmp/pos.sql
 *
 * 和 `backfill-zipf.mjs` 一样**只往 stdout 吐 SQL，自己不连库**（Neon 的 driver
 * 在纯 Node 脚本里还要配 WebSocket，一次性脚本不值得），交给 psql 执行、
 * 顺便能先看一眼要写什么。
 *
 * 🔴 只写 `pos`，**绝不动 `note`** —— 释义是已经审核过的，模型不该重写它。
 */
import Anthropic from '@anthropic-ai/sdk';
import { createInterface } from 'node:readline';

const BATCH = 10;
const MODEL = 'claude-opus-5';

const SYSTEM = `给下面每条英语生词标注**词性**。

每条给你：id、词（lemma）、这个词出现的句子、已经写好的中文释义。

🔴 **按这个词在那句话里的实际用法判定，不是列出词典里的所有词性。**
avalanche 在「雪崩埋了那条路」里就是 n.，不要写成 n./vi./vt.
释义也是线索 —— 它就是针对那一句写的。

可用：n. / v. / a. / ad. / prep. / conj. / pron. / int. / num. / art.
及物不及物不用分，一律 v.；形容词一律 a.，副词一律 ad.

拿不准就给空字符串，别硬猜。**只回词性，不要改释义。**`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '原样回填输入里的 id' },
          pos: { type: 'string', description: '词性简写；拿不准给空串' },
        },
        required: ['id', 'pos'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function cells(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const rows = [];
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const [id, lemma, sentence, note] = cells(line);
  rows.push({ id: Number(id), lemma, sentence, note });
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const results = [];

for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(chunk, null, 2) }],
  });
  const text = response.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(text.text);
  const wanted = new Set(chunk.map((r) => r.id));
  // 模型回填的 id 必须是这一批发过去的 —— 别让它的输出决定写哪一行
  for (const item of parsed.items) {
    if (wanted.has(item.id) && typeof item.pos === 'string') results.push(item);
  }
  process.stderr.write(`${Math.min(i + BATCH, rows.length)} / ${rows.length}\n`);
}

const withPos = results.filter((r) => r.pos.trim());
process.stderr.write(`拿到 ${results.length} 条，其中有词性的 ${withPos.length} 条\n`);

if (withPos.length === 0) process.exit(0);

const values = withPos
  // 单引号 —— JSON.stringify 给的是双引号，Postgres 会当成**标识符**不是字符串
  .map((r) => `(${r.id}::bigint, '${r.pos.trim().slice(0, 12).replaceAll("'", "''")}'::text)`)
  .join(',\n  ');

process.stdout.write(`UPDATE encounters AS e
SET pos = v.pos
FROM (VALUES
  ${values}
) AS v(id, pos)
WHERE e.id = v.id;
`);
