import data from './phonetics-data.json';

/**
 * 美式音标（IPA）—— 由 `scripts/build-phonetics.mjs` 从 **CMUdict** 生成。
 *
 * 🔴 **只在服务端 import。** 这张表约 1MB，和中文查表一样绝不能进浏览器：
 * 页面上实际显示的就当前那 30 个词，服务端查好随数据发下去就够了。
 *
 * 为什么不用 ECDICT 的 `phonetic`：那是**英式**的（`car → kɑ:`、`better → 'betә`，
 * 都没有儿化的 r）。覆盖率虽高，但拿英式冒充美式是错的。
 */
const table = data as Record<string, string>;

/** 查不到返回 null —— CMUdict 收词约 92.8%，词组和生僻词会漏，不拿英式凑数 */
export function phoneticOf(word: string): string | null {
  return table[word.trim().toLowerCase()] ?? null;
}

/** 批量查，只返回查得到的。普通对象而非 Map —— 要跨 server → client 序列化 */
export function phoneticsFor(words: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of words) {
    const ipa = phoneticOf(word);
    if (ipa) out[word] = ipa;
  }
  return out;
}

/**
 * IPA → 同音词组。懒建一次，和主表共用同一份数据。
 *
 * 「同音词」在这里的定义是**音标完全相同** —— 精确、可枚举，不用求模型去回忆。
 * AI 那条路会漏（模型不一定想得起 `flee/flea`），这条不会。
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
