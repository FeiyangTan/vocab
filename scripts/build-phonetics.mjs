/**
 * 从 CMUdict 生成**美式**音标表 `src/lib/phonetics-data.json`。
 *
 *   node scripts/build-phonetics.mjs
 *
 * 数据源：**CMU Pronouncing Dictionary**（卡内基梅隆，135,155 条，美式英语的
 * 标准免费来源），经 npm 包 `cmu-pronouncing-dictionary` 分发。
 *
 * 🔴 **不用 ECDICT 的 `phonetic` 字段** —— 那是**英式**的，一眼可辨：
 * `car → kɑ:`、`better → 'betә` 都没有儿化的 r。虽然它覆盖率更高，
 * 但拿英式冒充美式是错的。
 *
 * CMUdict 给的是 ARPAbet 音素，这里转成 IPA。精简范围和中文查表一致
 *（SUBTLEX 里 Zipf ≥ 2.0），生成约 0.95MB。
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { dictionary } = require('cmu-pronouncing-dictionary');
const subtlex = require('subtlex-word-frequencies');

const MIN_ZIPF = 2.0;

/** ARPAbet 39 个音素 → IPA（美式） */
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
 * ARPAbet → IPA。两处不能想当然：
 *
 * 1. **重音记号标在整个音节前，不是元音前。** 直接按音素输出会得到 `/wˈɔtɚ/`，
 *    正确的是 `/ˈwɔtɚ/` —— 得从元音往前回溯到辅音簇的开头。
 * 2. **弱读的 ER / AH 用 ɚ / ə**（`better` → `ˈbɛtɚ`），这是美式音标的标准写法。
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

  // 每个重读元音，把记号插到它所在音节的开头（上一个元音之后的位置）
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
  `CMUdict ${Object.keys(dictionary).length.toLocaleString()} 条 → 保留 ` +
    `${Object.keys(out).length.toLocaleString()} 条，` +
    `${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB → src/lib/phonetics-data.json`,
);
