import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { settings } from '@/db/schema';
import {
  DEFAULT_MODEL,
  isValidModel,
  PURPOSES,
  type ModelId,
  type Purpose,
} from '@/lib/models';
import { DEFAULT_PROMPT, validatePrompt } from '@/lib/prompts';

/**
 * Reads and writes for the `settings` table.
 *
 * 🔴 **The split from `src/lib/models.ts` is deliberate**: the list and validators over there
 * are imported by the `'use client'` picker on `/usage`, so they must not touch the database.
 * The moment these functions import `@/db`, drizzle and the Neon driver get bundled into the
 * browser — measured, that fails the Vercel build (local `next build` passes, so looking only
 * at local builds will not catch it).
 */

const keyOf = (purpose: Purpose) => `model.${purpose}`;

/**
 * The model currently in use for one path.
 *
 * 🔴 **Missing row, or a value outside the allow-list, always falls back to the default** — a
 * dirty settings table (edited by hand, an allow-list that shrank, a table not yet created)
 * must not take the AI calls down with it. One setting should never be able to break the
 * main flow.
 *
 * **No caching**: one extra ~50ms query before a call that itself takes seconds is
 * irrelevant, whereas a cache produces "I just changed it on the page and nothing happened",
 * which is the hardest kind of bug to explain.
 */
export async function getModel(purpose: Purpose): Promise<ModelId> {
  try {
    const [row] = await getDb()
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, keyOf(purpose)))
      .limit(1);
    return isValidModel(row?.value) ? row.value : DEFAULT_MODEL[purpose];
  } catch (error) {
    console.error('[settings] failed to read settings, falling back to defaults:', error);
    return DEFAULT_MODEL[purpose];
  }
}

/** Fetch both paths' current models at once, for rendering `/usage` */
export async function getAllModels(): Promise<Record<Purpose, ModelId>> {
  const entries = await Promise.all(
    PURPOSES.map(async (p) => [p, await getModel(p)] as const),
  );
  return Object.fromEntries(entries) as Record<Purpose, ModelId>;
}

export async function setModel(purpose: Purpose, model: ModelId): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key: keyOf(purpose), value: model })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: model, updatedAt: new Date() },
    });
}

/* ---------------------------------------------------------------- prompts */

const promptKeyOf = (purpose: Purpose) => `prompt.${purpose}`;

/**
 * The system prompt currently in use for one path.
 *
 * Same fallback philosophy as `getModel`: **a missing row, or a dirty stored value (empty or
 * over-long), always falls back to the default in code**. The prompt is sent on every single
 * call, so if it's broken the whole AI path is dead — and one setting should never be able to
 * break the main flow.
 *
 * **Also uncached**: an AI call takes seconds to begin with, so one extra ~50ms query is
 * irrelevant, whereas a cache produces "I just edited the prompt and nothing happened",
 * the hardest kind of bug to explain.
 */
export async function getPrompt(purpose: Purpose): Promise<string> {
  return (await readOverride(purpose)) ?? DEFAULT_PROMPT[purpose];
}

/**
 * For rendering `/usage`: each path's current prompt plus **whether it has been edited**.
 *
 * `customized` reflects **whether the row exists**, not whether the text differs from the
 * default — he could perfectly well edit the text back to character-for-character the default
 * and save it again, and "Reset to default" should still be lit: the row is still there, and
 * when the default prompt changes in code, that path will not follow.
 */
export async function getAllPrompts(): Promise<
  Record<Purpose, { text: string; customized: boolean }>
> {
  const entries = await Promise.all(
    PURPOSES.map(async (p) => {
      const override = await readOverride(p);
      return [p, { text: override ?? DEFAULT_PROMPT[p], customized: override !== null }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Purpose, { text: string; customized: boolean }>;
}

/** The custom prompt stored in the database; absent or dirty both count as absent */
async function readOverride(purpose: Purpose): Promise<string | null> {
  try {
    const [row] = await getDb()
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, promptKeyOf(purpose)))
      .limit(1);
    if (row?.value && validatePrompt(row.value) === null) return row.value;
    return null;
  } catch (error) {
    console.error('[settings] failed to read the prompt, falling back to the default:', error);
    return null;
  }
}

/**
 * Store a custom prompt; `null` = **reset to default**.
 *
 * 🔴 Resetting **deletes the row rather than writing the default text into the database**.
 * Writing it in would mean that improving a default prompt in `prompts.ts` later gets blocked
 * by that stale snapshot — and the page gives no hint of it: you'd believe you were on the
 * default while actually running the default from three months ago.
 */
export async function setPrompt(purpose: Purpose, text: string | null): Promise<void> {
  const db = getDb();
  if (text === null) {
    await db.delete(settings).where(eq(settings.key, promptKeyOf(purpose)));
    return;
  }
  await db
    .insert(settings)
    .values({ key: promptKeyOf(purpose), value: text })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: text, updatedAt: new Date() },
    });
}
