import { sql, type SQL } from 'drizzle-orm';
import type { Scope } from './categories';

/**
 * 「快速过词」的队列规则。看单词 → 认识 / 不认识 / 删除，把范围内的词刷空为一轮。
 *
 * 队列**存在服务端**（`words.triage_order` / `words.triage_done`），前端一次只拿
 * 一个词 —— 和挖空复习同一个道理（见 `src/app/api/review/route.ts` 的注释：
 * iOS 上 PWA 后台会被系统清掉，进度不能攒在内存里）。顺带把「刷新不丢进度」
 * 变成白送的：前端根本没有队列可丢。
 *
 * 范围（`Scope`）可以是一个分类，也可以是 `'all'`。**一轮的状态是共享的** ——
 * 在 videos 里标过「认识」的词，进「全部」也不会再出现。「本轮已认识」是**词**的
 * 属性，不是「从哪个门进来的」属性。
 *
 * 🔴 **这一套完全不碰 `cards`。** 快速过词是按词频把一批词过一遍的分拣动作，
 * 挖空复习是间隔重复，两边各写各的字段。
 */

/** 标「不认识」时往后挪多少个位置 */
export const PUSH_BACK = 10;

/** scope 的 WHERE 片段。`'all'` 时是恒真，拼进 SQL 里不用到处写 if */
function within(scope: Scope): SQL {
  return scope === 'all' ? sql`true` : sql`category_id = ${scope}`;
}

/**
 * 队列位置的口径：**全局词频名次**。
 *
 * 🔴 名次算在**全部词**上，不是算在 scope 内 —— 这是「全部」能工作的前提。
 * 每个分类各自编号 1..N 的话，四个分类合起来时四个 #1 会挤在最前面，就不是
 * 词频序了。算成全局名次之后这个数在哪儿都能比：
 * - 合起来 → `ORDER BY triage_order` 就是全局词频序
 * - 限定到一个分类 → 全局名次的子集，相对顺序仍是该分类的词频序（名次会稀疏，
 *   但没有任何地方依赖它连续）
 *
 * 排序口径和 `POST /api/words/reorder-by-frequency` 一模一样（常见的在前、
 * SUBTLEX 没收录的 null 排最后、同分按字母序稳定）。
 */
const globalRank = sql`
  SELECT id, row_number() OVER (ORDER BY zipf DESC NULLS LAST, lemma) AS rn FROM words
`;

/**
 * 给范围内**还没排过位置**的词打上名次，让它们进入当前这一轮。
 *
 * 每次取词前调一下（`GET /api/triage` 里数出来为 0 就不发这条 SQL）。有两个作用：
 * 1. 第一次进来时把整批词排进队列 —— 所以不用先按个「开始」
 * 2. 轮进行中在收集箱新确认的词能就地入队 —— 你（jimmy）随时在加词，
 *    让它们干等下一轮没道理
 *
 * **不碰 `triage_done`** —— 已经标过「认识」的词不该被重新拉回队列，那是
 * 「再来一轮」才做的事。
 */
export function stampUnqueued(scope: Scope) {
  return sql`
    UPDATE words AS w SET triage_order = v.rn
    FROM (${globalRank}) AS v
    WHERE w.id = v.id AND w.triage_order IS NULL AND ${within(scope)}
  `;
}

/**
 * 「再来一轮」：范围内全部重打名次 + 清掉「认识」。
 *
 * 所以**一轮结束就忘干净**，上一轮认识的词下一轮照样出现。这个模式是
 *「把一批词过一遍」，不是长期记忆调度（那是挖空复习的活）。
 *
 * 🔴 **按 scope 生效**：从某个分类点「再来一轮」只重置那个分类，不能让在
 * videos 点一下把《Hocus and Pocus》132 个词的进度也冲掉。
 */
export function resetRound(scope: Scope) {
  return sql`
    UPDATE words AS w SET triage_order = v.rn, triage_done = false
    FROM (${globalRank}) AS v
    WHERE w.id = v.id AND ${within(scope)}
  `;
}

/**
 * 标「不认识」：在队列里退后 `PUSH_BACK` 位。
 *
 * 不能写成 `triage_order += 10` —— 那是在**值域**上加，和「队列里第几个」不是
 * 一回事（位置值会被反复插队搞出空洞和小数）。真正要做的是找到后面第 10 个和
 * 第 11 个，把自己插到它俩中间，所以 `triage_order` 是 double precision。
 *
 * 「后面第 10 个」是**在 scope 内**数的：全部模式下跨分类数，分类模式下只在本
 * 分类数。两个都对 —— 各自符合当时屏幕上那个队列。
 *
 * 三种情况，靠 COALESCE 依次兜底：
 * 1. 后面 ≥10 个 —— 插到第 10、11 之间（没有第 11 就是第 10 + 1）
 * 2. 后面不足 10 个 —— 放最后（你（jimmy）定的规则）
 * 3. 后面一个都没有 —— **原地不动**。这是规则的直接推论：「不认识」永远不出队，
 *    所以只剩一个词的时候按不认识，下一个还是它。界面上直说，不假装它动了。
 */
export function pushBack(scope: Scope, wordId: number) {
  return sql`
    WITH q AS (
      SELECT triage_order AS o, row_number() OVER (ORDER BY triage_order) AS rn
      FROM words
      WHERE ${within(scope)}
        AND NOT triage_done
        AND triage_order IS NOT NULL
        AND triage_order > (SELECT triage_order FROM words WHERE id = ${wordId})
    )
    UPDATE words SET triage_order = COALESCE(
      (SELECT CASE WHEN n.o IS NULL THEN t.o + 1 ELSE (t.o + n.o) / 2 END
         FROM q t LEFT JOIN q n ON n.rn = ${PUSH_BACK + 1}
        WHERE t.rn = ${PUSH_BACK}),
      (SELECT max(o) + 1 FROM q),
      triage_order
    )
    WHERE id = ${wordId}
  `;
}
