/**
 * 从 ECDICT 生成精简的英汉查表 `src/lib/dictionary-data.json`。
 *
 * 源数据：https://github.com/skywind3000/ECDICT （MIT，77 万词条）
 *   curl -sLO https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
 *   node scripts/build-dictionary.mjs ecdict.csv
 *
 * 🔴 **源 CSV 63MB，不进仓库**；生成出来的 JSON（约 2.2MB）提交，
 * 这样线上不需要任何下载步骤。
 *
 * 精简规则：
 * - 只保留 SUBTLEX 里 **Zipf ≥ 2.0** 的词（约 45k）。更小的 3.5 那档会漏掉
 *   `crispy`、`crypt`、`adapt` 这些**手动加的**对比词 —— 而手动加的最需要提示。
 * - 每条只留 `translation` 的**首行**、截断 40 字：完整释义有好几行，tooltip 放不下。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const subtlex = require('subtlex-word-frequencies');

const source = process.argv[2];
if (!source) {
  console.error('用法: node scripts/build-dictionary.mjs <ecdict.csv 路径>');
  process.exit(1);
}

/** 只保留常用到值得放进查表的词。比 AI 建议那道 3.5 的线松，见文件头 */
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

/** ECDICT 的释义字段里有引号和逗号，得逐字符扫，不能 split(',') */
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
  // translation 是多行的，`\n` 在 CSV 里是字面的两个字符
  const gloss = (row[3] ?? '').split('\\n')[0].trim().slice(0, MAX_GLOSS);
  if (gloss) dict[word] = gloss;
}

const json = JSON.stringify(dict);
writeFileSync('src/lib/dictionary-data.json', json);
console.error(
  `扫描 ${scanned.toLocaleString()} 条，保留 ${Object.keys(dict).length.toLocaleString()} 条，` +
    `${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB → src/lib/dictionary-data.json`,
);
