import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { suggestContrasts } from '@/lib/claude';
import { cleanContrasts, MAX_CONTRASTS } from '@/lib/contrasts';
import { contrastHintsFor, looksLikeRealWord } from '@/lib/dictionary';
import { COMMON_ZIPF, isCommon, isCommonEnoughForHomophone } from '@/lib/frequency';
import { homophonesOf } from '@/lib/phonetics';

/**
 * 让 Claude 找形近/音近的对比词并**直接加进去**。
 * `POST /api/words/{id}/contrasts/suggest`
 *
 * 🔴 **合并而不是覆盖** —— 和确认接口里那条规则一样。手动加的对比词是人自己
 * 栽过跟头才记下的，绝不能被模型的建议冲掉。
 *
 * 调用失败返回 502，库里什么都不动 —— 宁可让人重试，也不要写进半截结果。
 */
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const db = getDb();
  const [word] = await db
    .select({ id: words.id, lemma: words.lemma, contrasts: words.contrasts })
    .from(words)
    .where(eq(words.id, id))
    .limit(1);
  if (!word) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }

  let suggested: string[];
  try {
    suggested = await suggestContrasts(word.lemma);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }

  /*
   * 两道过滤，都只作用在**模型的建议**上：
   * 1. 挡掉目标词本身（模型有时不听话）
   * 2. 挡掉不够常用的 —— prompt 里已经要求「雅思范围内」，但那只是请求；
   *    这一道是保证。拿生僻词当对比词毫无意义，人根本不会把没见过的词和它搞混。
   *
   * 🔴 `word.contrasts`（手动加的）**不过这两道**。生僻与否轮不到系统判断。
   */
  const lower = word.lemma.trim().toLowerCase();
  const fresh = suggested.filter((w) => w.trim().toLowerCase() !== lower && isCommon(w));
  const dropped = suggested.length - fresh.length;

  /*
   * **同音词单独算，不指望模型想得起来。**
   *
   * 音标完全相同就是同音词 —— 从 CMUdict 的音标表机械枚举，精确且不会漏
   *（`flee/flea`、`forth/fourth`、`whine/wine` 这些模型未必每次都给）。
   *
   * 常用度用**更松的那条线**（`HOMOPHONE_ZIPF`）：3.5 是为了卡模型的凑数，
   * 而同音词是算出来的事实，拿 3.5 会误伤 `pore`(2.68)、`oar`(2.93) 这些真同音词，
   * 而它们恰恰最容易拼错。再加一道「像不像正经英文词」，挡掉音标表里混进来的
   * 外语词和人名（`pour → por` 是西班牙语缩写，`bare → bache` 是人名）。
   */
  const homophones = homophonesOf(word.lemma).filter(
    (w) => isCommonEnoughForHomophone(w) && looksLikeRealWord(w),
  );

  // 同音词排在模型建议前面 —— 它们是确定的，模型给的是猜的
  const contrasts =
    cleanContrasts([...word.contrasts, ...homophones, ...fresh])?.slice(0, MAX_CONTRASTS) ??
    word.contrasts;
  const added = contrasts.filter((w) => !word.contrasts.includes(w));

  if (added.length > 0) {
    await db.update(words).set({ contrasts }).where(eq(words.id, id));
  }

  return NextResponse.json({
    ok: true,
    contrasts,
    added,
    glosses: contrastHintsFor(contrasts),
    // 一个都没剩时前端要说清楚是「没找到」而不是「没反应」
    dropped,
    threshold: COMMON_ZIPF,
  });
}
