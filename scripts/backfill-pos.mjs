/**
 * A one-off script: fill in the part of speech for existing encounters.
 *
 *   psql "$DATABASE_URL" -tAc "COPY (SELECT e.id, w.lemma, e.raw_text, e.note
 *     FROM encounters e JOIN words w ON w.id=e.word_id WHERE e.pos IS NULL) TO STDOUT WITH CSV" \
 *     | node --env-file=.env.local scripts/backfill-pos.mjs > /tmp/pos.sql
 *
 * Like `backfill-zipf.mjs`, it **only writes SQL to stdout and never connects to the
 * database** (Neon's driver needs WebSocket setup inside a plain Node script, which isn't
 * worth it for a one-off). psql runs it, and you get to read what will be written first.
 *
 * 🔴 Writes `pos` only and **never touches `note`** — the definitions have already been
 * reviewed, and the model has no business rewriting them.
 *
 * 🔴 The `SYSTEM` prompt and the schema `description` fields below stay in Chinese: they are
 * what is sent to the model, and they are what makes it reason about Chinese definitions.
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
  // An id the model echoes back must be one from this batch — never let its output decide
  // which row gets written
  for (const item of parsed.items) {
    if (wanted.has(item.id) && typeof item.pos === 'string') results.push(item);
  }
  process.stderr.write(`${Math.min(i + BATCH, rows.length)} / ${rows.length}\n`);
}

const withPos = results.filter((r) => r.pos.trim());
process.stderr.write(`got ${results.length}, of which ${withPos.length} have a part of speech\n`);

if (withPos.length === 0) process.exit(0);

const values = withPos
  // Single quotes — JSON.stringify emits double quotes, which Postgres reads as an
  // **identifier** rather than a string
  .map((r) => `(${r.id}::bigint, '${r.pos.trim().slice(0, 12).replaceAll("'", "''")}'::text)`)
  .join(',\n  ');

process.stdout.write(`UPDATE encounters AS e
SET pos = v.pos
FROM (VALUES
  ${values}
) AS v(id, pos)
WHERE e.id = v.id;
`);
