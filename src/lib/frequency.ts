import subtlex from 'subtlex-word-frequencies';

/**
 * 词频指标 —— 给每个词一个客观的「有多常见」，用来当默认排序。
 *
 * 数据源：**SUBTLEX-US**（Brysbaert & New, 2009），5000 万词的电影/电视字幕语料，
 * 74,286 条。经 npm 包 `subtlex-word-frequencies`（ISC）分发，原始数据是
 * CC BY-SA 类授权。
 *
 * 选字幕语料不选书面语料（COCA / Google Ngrams）有具体理由：字幕反映的是
 * **口语和日常使用频率**，而这个词库的分类本来就是电影和童书。
 *
 * 实测对现有词库覆盖 95.9%，没覆盖到的全是词组和专名（`winter solstice`、
 * `PostgreSQL`）—— 那些**返回 null，不硬凑**。把词组拆开取平均是假精确。
 */

/** SUBTLEX 语料的总词次，用来把原始计数换算成 Zipf */
let corpusTotal = 0;
let table: Map<string, number> | null = null;

/**
 * 74k 条只在第一次用到时建一次表，之后走模块级缓存。
 * 只有确认接口和回填脚本会走到这儿 —— 词汇页读的是库里存好的值。
 */
function lookup(): Map<string, number> {
  if (table) return table;
  const next = new Map<string, number>();
  for (const entry of subtlex as { word: string; count: number }[]) {
    const key = entry.word.toLowerCase();
    // 同一个词大小写不同会有多条（`I` / `i`），合并计数
    next.set(key, (next.get(key) ?? 0) + entry.count);
    corpusTotal += entry.count;
  }
  table = next;
  return table;
}

/**
 * Zipf 值：`log10(出现次数 / 语料总词次 × 10⁹)`，心理语言学里的标准刻度。
 *
 * 用它不用原始计数，是因为原始值跨度从 1 到 200 万，没法直接分档；
 * Zipf 是线性可读的：`the` 7.5、`water` 5.4、`altar` 3.7、`knitter` 1.6。
 *
 * 查不到返回 null —— null 是「未收录」，和「频率为 0」不是一回事。
 */
export function zipfOf(lemma: string): number | null {
  const map = lookup();
  const count = map.get(lemma.trim().toLowerCase());
  if (!count) return null;
  return Math.round(Math.log10((count / corpusTotal) * 1e9) * 100) / 100;
}

export type Band = { level: number; label: string };

/** 界面上显示的档位。level 0 = 未收录，1–5 由罕见到极常见 */
export function frequencyBand(zipf: number | null): Band {
  if (zipf === null) return { level: 0, label: 'unlisted' };
  if (zipf >= 5) return { level: 5, label: 'very common' };
  if (zipf >= 4) return { level: 4, label: 'common' };
  if (zipf >= 3) return { level: 3, label: 'mid' };
  if (zipf >= 2) return { level: 2, label: 'rare' };
  return { level: 1, label: 'very rare' };
}

/**
 * 「常用词」的界限，只用来**约束 AI 生成的对比词**。
 *
 * Zipf ≥ 3.5 在 SUBTLEX 里约 9,200 个词形 —— 词形会因为屈折变化多于词族，
 * 所以折算成词族大致是雅思那个量级（常说的 7000–8000）。
 *
 * 这个数不是拍的，是拿实际建议校准过的：它正好切掉 `crip`(2.45)、`crips`(2.58)、
 * `halter`(2.72)、`alto`(3.14) 这类噪音，留下 `alter`(3.69)、`bear`(4.77)
 * 这些真正会搞混的。
 *
 * 🔴 **只过滤 AI 的建议，绝不过滤人手动加的**。手动加的是本人栽过跟头才记下的，
 * 生僻与否轮不到系统判断（jimmy 自己加的 `crypt` 3.15、`crispy` 3.37 都在线下）。
 */
export const COMMON_ZIPF = 3.5;

/** 够不够常用到值得当对比词。查不到的一律不算 —— 没法确认常用性 */
export function isCommon(word: string): boolean {
  const zipf = zipfOf(word);
  return zipf !== null && zipf >= COMMON_ZIPF;
}

/**
 * 同音词的常用度下限，比 `COMMON_ZIPF` 松。
 *
 * 3.5 那条线是给**模型建议**定的 —— 模型会凑数，需要卡紧。但同音词是从音标表
 * **算出来的事实**：`pore` 确实和 `pour` 同音，这不是猜的。拿 3.5 卡会误伤一批
 * 真同音词（`pore` 2.68、`oar` 2.93、`bowled` 2.79）—— 而它们恰恰是最容易拼错的那种。
 */
export const HOMOPHONE_ZIPF = 2.5;

export function isCommonEnoughForHomophone(word: string): boolean {
  const zipf = zipfOf(word);
  return zipf !== null && zipf >= HOMOPHONE_ZIPF;
}
