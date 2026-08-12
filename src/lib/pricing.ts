/**
 * Claude API 单价表，用来把 token 数**估算**成美元。
 *
 * 🔴 **是估算不是账单。** 单价会变（比如 Sonnet 5 的优惠价 2026-08-31 到期），
 * 而且这里没有算 batch 折扣、data residency 的 1.1x、fast mode 溢价、
 * web search 按次收费这些。要准确金额去 Claude Console 看。
 *
 * 数据来源：https://platform.claude.com/docs/en/about-claude/pricing
 * **核对日期：2026-08-07**。改单价时把这个日期一起更新。
 *
 * 单位：美元 / 百万 token。
 */
export const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  // Sonnet 5 现在是优惠价 $2/$10，2026-08-31 之后恢复 $3/$15
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export type Tokens = {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/**
 * 估算美元花费。表里没有这个模型就返回 null —— **不拿别的模型的价格顶替**，
 * 那样算出来的数字看着像真的，其实是错的。
 */
export function estimateCost(t: Tokens): number | null {
  const p = PRICES[t.model];
  if (!p) return null;
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * p.cacheRead +
      t.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

/** 金额很小，固定四位小数比自适应精度好读 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
