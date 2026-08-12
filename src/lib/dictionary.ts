import data from './dictionary-data.json';
import { phoneticOf } from './phonetics';

/**
 * 英汉查表 —— 给对比词配一个 hover 就能看到的中文，**不消耗 token**。
 *
 * 数据源：**ECDICT**（https://github.com/skywind3000/ECDICT，MIT，77 万词条），
 * 由 `scripts/build-dictionary.mjs` 精简成「词 → 首行释义」的 JSON。
 *
 * 🔴 **只在服务端 import。** 这张表 2.18MB，绝不能进浏览器 —— 页面上实际显示的
 * 对比词就那么几十个，服务端查好、随数据一起发下去就够了（几百字节）。
 * client component 里不许 import 这个文件。
 */
const table = data as Record<string, string>;

/** 查不到返回 null —— 界面上就不给 tooltip，不显示空气泡 */
export function glossOf(word: string): string | null {
  return table[word.trim().toLowerCase()] ?? null;
}

/**
 * 对比词 hover 时显示的一行：**美式音标 + 中文**，例如 `/ˈɔltɚ/ v. 改变`。
 *
 * 两个都查不到就不收进结果 —— 前端拿不到值就不套 Tooltip，不弹空气泡。
 * 只有一个的时候就只给那一个，不留空占位。
 *
 * 返回普通对象而不是 Map：它要跨越 server → client 边界随 props 序列化，
 * Map 传不过去。
 */
export function contrastHintsFor(words: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of words) {
    const ipa = phoneticOf(word);
    const gloss = glossOf(word);
    const hint = [ipa ? `/${ipa}/` : null, gloss].filter(Boolean).join('  ');
    if (hint) out[word] = hint;
  }
  return out;
}

/**
 * 看着像不像一个正经的英文词。
 *
 * 同音词是从音标表机械算出来的，会捞到一些不该当对比词的东西：
 * `pour → por`（西班牙语，字幕语料里有）、`bare → bache`（人名）。
 * ECDICT 的释义自带标记，拿它们筛掉这一类。
 */
export function looksLikeRealWord(word: string): boolean {
  const gloss = glossOf(word);
  if (!gloss) return false;
  if (/^(abbr|prep|art)\./.test(gloss)) return false;
  return !/(人名|姓氏|地名|省名|城市|、如)/.test(gloss);
}
