/**
 * Claude API price table, used to **estimate** dollars from token counts.
 *
 * 🔴 **An estimate, not a bill.** Prices change (Sonnet 5's promotional rate expires
 * 2026-08-31), and this accounts for none of: batch discounts, the 1.1x data-residency
 * premium, fast-mode premiums, or per-search web-search billing. For exact amounts,
 * check the Claude Console.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 * **Verified 2026-08-07.** Update that date whenever you touch a price.
 *
 * Units: USD per million tokens.
 */
export const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  // Sonnet 5 is on a promotional $2/$10; it returns to $3/$15 after 2026-08-31
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
 * Estimate the dollar cost. null when the model isn't in the table — **never substitute
 * another model's price**, which produces a number that looks real and is wrong.
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

/** The amounts are tiny, so a fixed four decimals reads better than adaptive precision */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
