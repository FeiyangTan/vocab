import { desc, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiUsage } from '@/db/schema';
import { getAllModels, getAllPrompts } from '@/db/settings';
import { PURPOSE_LABEL } from '@/lib/models';
import { estimateCost, formatUsd } from '@/lib/pricing';
import { ModelPicker } from './model-picker';
import { PromptEditor } from './prompt-editor';

export const dynamic = 'force-dynamic';

/** Purpose labels are shared with `src/lib/models.ts` — two copies would drift apart */
const labelOf = (purpose: string) =>
  (PURPOSE_LABEL as Record<string, string>)[purpose] ?? purpose;

/**
 * Claude API usage plus estimated spend.
 *
 * 🔴 Amounts are **estimated from the price table in `src/lib/pricing.ts`, and are not a
 * bill** — batch discounts, the data-residency premium, and per-search web-search billing are
 * all unaccounted for. For exact amounts, use the Console.
 *
 * There is also **no "balance remaining"** — Anthropic's Admin API exposes usage and spend
 * only, with no balance endpoint (and it isn't open to personal accounts anyway). The balance
 * is visible on the Console page and nowhere else.
 *
 * Recording starts the day this feature was added; earlier calls can't be recovered.
 */
export default async function UsagePage() {
  const db = getDb();
  const [models, prompts] = await Promise.all([getAllModels(), getAllPrompts()]);

  const sums = {
    input: sql<number>`coalesce(sum(${apiUsage.inputTokens}), 0)::int`,
    output: sql<number>`coalesce(sum(${apiUsage.outputTokens}), 0)::int`,
    cacheRead: sql<number>`coalesce(sum(${apiUsage.cacheReadTokens}), 0)::int`,
    cacheWrite: sql<number>`coalesce(sum(${apiUsage.cacheWriteTokens}), 0)::int`,
    calls: sql<number>`count(*)::int`,
  };

  const [total] = await db.select(sums).from(apiUsage);
  // Same timezone basis as the per-day grouping below, or you get "recording since 8/6"
  // above a first bar labelled 8/7
  const [first] = await db
    .select({
      day: sql<string>`to_char(min(${apiUsage.createdAt}) AT TIME ZONE 'UTC', 'YYYY/MM/DD')`,
    })
    .from(apiUsage);

  const byPurpose = await db
    .select({ purpose: apiUsage.purpose, ...sums })
    .from(apiUsage)
    .groupBy(apiUsage.purpose)
    .orderBy(desc(sums.input));

  // Spend is computed per **model** — prices differ several-fold, so a combined figure is
  // meaningless
  const byModel = await db
    .select({ model: apiUsage.model, ...sums })
    .from(apiUsage)
    .groupBy(apiUsage.model)
    .orderBy(desc(sums.input));

  const costs = byModel.map((row) => ({ ...row, cost: estimateCost(row) }));
  const totalCost = costs.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const unpriced = costs.filter((r) => r.cost === null).map((r) => r.model);

  const byDay = await db
    .select({
      day: sql<string>`to_char(${apiUsage.createdAt} AT TIME ZONE 'UTC', 'MM/DD')`,
      ...sums,
    })
    .from(apiUsage)
    .groupBy(sql`1`)
    .orderBy(desc(sql`1`))
    .limit(14);

  const peak = Math.max(1, ...byDay.map((d) => d.input + d.output));
  const n = (v: number) => v.toLocaleString();

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl font-medium tracking-tight">Usage</h1>
        {first?.day && (
          <span className="text-sm text-muted-foreground">Recording since {first.day} (UTC)</span>
        )}
      </div>

      {/*
        The model and prompts come first, and sit **outside the "nothing recorded yet" branch**
        — they are settings, not statistics, and having made no calls at all is exactly when
        you most want to set them.

        The order is "which model → what instructions → what it cost": the first two are the
        cause, the third the effect.
      */}
      <div className="mb-8 space-y-8">
        <ModelPicker current={models} />
        <PromptEditor current={prompts} />
      </div>

      {total.calls === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nothing recorded yet. The next AI draft or confusable match will show up here.
        </p>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="border-t border-border pt-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Total
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  In <span className="tabular-nums">{n(total.input)}</span>
                </span>
                <span>
                  Out <span className="tabular-nums">{n(total.output)}</span>
                </span>
                {total.cacheRead > 0 && (
                  <span className="text-muted-foreground">
                    Cache hits <span className="tabular-nums">{n(total.cacheRead)}</span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  <span className="tabular-nums">{n(total.calls)}</span> calls
                </span>
              </div>
              <div className="mt-2 text-lg tabular-nums">
                ~{formatUsd(totalCost)}
                <span className="ml-2 text-xs text-muted-foreground">estimated</span>
              </div>
            </div>
          </section>

          <section>
            <div className="border-t border-border pt-4">
              <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                By purpose
              </div>
              {byPurpose.map((row) => (
                <div key={row.purpose} className="flex justify-between gap-3 py-1 text-sm">
                  <span>{labelOf(row.purpose)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    in {n(row.input)} · out {n(row.output)} · {n(row.calls)} calls
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="border-t border-border pt-4">
              <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                By model
              </div>
              {costs.map((row) => (
                <div key={row.model} className="flex justify-between gap-3 py-1 text-sm">
                  <span className="font-mono text-xs">{row.model}</span>
                  <span className="text-muted-foreground tabular-nums">
                    in {n(row.input)} · out {n(row.output)} ·{' '}
                    {row.cost === null ? 'no price' : `~${formatUsd(row.cost)}`}
                  </span>
                </div>
              ))}
              {unpriced.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  {unpriced.join(', ')} not in the price table, excluded from the total — add pricing in
                  src/lib/pricing.ts
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="border-t border-border pt-4">
              <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Last 14 days
              </div>
              {byDay.map((row) => (
                <div key={row.day} className="flex items-center gap-3 py-1 text-sm">
                  <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                    {row.day}
                  </span>
                  {/* A plain CSS width percentage — no charting library for one bar */}
                  <span
                    className="h-2 shrink-0 rounded-px bg-primary/60"
                    style={{ width: `${((row.input + row.output) / peak) * 60}%` }}
                  />
                  <span className="text-muted-foreground tabular-nums">
                    {n(row.input + row.output)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            Only counts calls made by this app, starting the day this feature was added.
            <br />
            Amounts are estimated from the price table in{' '}
            <span className="font-mono">src/lib/pricing.ts</span> —{' '}
            <strong className="font-medium">not a bill</strong>. Batch discounts and similar
            factors are not accounted for. For exact amounts and your balance, check the
            Claude Console; Anthropic has no balance API.
          </p>
        </div>
      )}
    </main>
  );
}
