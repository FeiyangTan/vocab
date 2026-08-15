import { PRICES } from './pricing';

/**
 * Which model each of the two AI paths uses — chosen on `/usage`, stored in the `settings`
 * table.
 *
 * It lives on the usage page because that page already **groups estimated spend by model**:
 * pick a model next to the spend, and the next call is recorded under the new model's name,
 * so cheaper-or-costlier is visible at a glance.
 *
 * 🔴 **This file must stay client-safe** — the list and the validators are imported directly
 * by the `'use client'` picker on `/usage`. Import `@/db` here and drizzle plus the Neon
 * driver get bundled into the browser (measured: it fails the Vercel build outright).
 * The database side lives in `src/db/settings.ts`.
 */

/** The two paths that call Claude */
export const PURPOSES = ['process', 'contrast'] as const;
export type Purpose = (typeof PURPOSES)[number];

export const PURPOSE_LABEL: Record<Purpose, string> = {
  process: 'Draft',
  contrast: 'Confusables',
};

/**
 * The selectable models.
 *
 * 🔴 **Every one must exist in `PRICES`** (asserted at runtime below). If it doesn't,
 * `/usage` shows "no price" and excludes it from the total — and seeing the spend is that
 * page's entire purpose. To add a model later, add its pricing in `pricing.ts` first.
 *
 * Only three tiers are listed rather than all six in `PRICES` (opus-4.8 / 4.5 / fable are
 * also there) — those are same-tier noise variants that only make the choice harder.
 */
export const MODEL_CHOICES = [
  { id: 'claude-opus-5', tier: 'Best', note: '$5 / $25', effort: true },
  {
    id: 'claude-sonnet-5',
    tier: 'Balanced',
    note: '$2 / $10 (promo ends 2026-08-31, then $3/$15)',
    effort: true,
  },
  { id: 'claude-haiku-4-5-20251001', tier: 'Cheapest', note: '$1 / $5', effort: false },
] as const;

export type ModelId = (typeof MODEL_CHOICES)[number]['id'];

/**
 * Whether this model accepts `output_config.effort`.
 *
 * 🔴 **Measured, not assumed**: passing effort to Haiku 4.5 returns
 * `400 This model does not support the effort parameter.` — the whole call fails, it is not
 * quietly ignored. effort is a Claude 5-family parameter, and Haiku 4.5 is a 4.x generation.
 *
 * `format: { type: 'json_schema' }` works on both, so structured output needs no changes.
 */
export function supportsEffort(model: ModelId): boolean {
  return MODEL_CHOICES.find((c) => c.id === model)?.effort ?? false;
}

// Fail at development time rather than letting production spend be quietly miscounted
for (const choice of MODEL_CHOICES) {
  if (!PRICES[choice.id]) {
    throw new Error(`Model ${choice.id} is missing from the price table in pricing.ts — add its pricing first`);
  }
}

/**
 * The defaults. **Deliberately not the strongest model** — matched to task difficulty:
 *
 * - `process` (drafting) is the quality-critical path: lemmatisation, a definition and part
 *   of speech written for the specific context, and a cloze that must **align** with the
 *   original sentence (currently 224/224 align, and the highlight on inflected words in the
 *   words page depends entirely on it). So it drops only one tier, to Sonnet.
 * - `contrast` is low risk: homophones are already derived mechanically by `homophonesOf`
 *   from the CMUdict phonetics table, the model only supplies look-alikes, and those still
 *   pass through `isCommon` (Zipf ≥ 3.5) and `looksLikeRealWord`. At worst, going to the
 *   cheapest tier yields a few fewer suggestions.
 */
export const DEFAULT_MODEL: Record<Purpose, ModelId> = {
  process: 'claude-sonnet-5',
  contrast: 'claude-haiku-4-5-20251001',
};

export function isValidModel(value: unknown): value is ModelId {
  return MODEL_CHOICES.some((c) => c.id === value);
}

export function isValidPurpose(value: unknown): value is Purpose {
  return PURPOSES.some((p) => p === value);
}
