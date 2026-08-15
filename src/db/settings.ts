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
 * `settings` 表的读写。
 *
 * 🔴 **和 `src/lib/models.ts` 分开是刻意的**：那边的名单和校验函数要被 `/usage`
 * 页那个 `'use client'` 选择器 import，所以必须不碰数据库。这些函数一 import
 * `@/db`，drizzle 和 Neon 驱动就会被打进浏览器包 —— 实测会让 Vercel 构建失败
 *（本地 `next build` 反而能过，所以只看本地构建是发现不了的）。
 */

const keyOf = (purpose: Purpose) => `model.${purpose}`;

/**
 * 取某条路径当前用的模型。
 *
 * 🔴 **查不到、或者库里的值不在白名单里，一律退回默认** —— 设置表被写脏
 *（手工改库、白名单缩了、表还没建）不该让 AI 调用挂掉。一个设置项不该有
 * 能力弄挂主流程。
 *
 * **不做缓存**：每次调用前多一次约 50ms 的查询，而 AI 调用本身要几秒，
 * 这点开销无所谓；加了缓存就会出现「刚在页面上改完但没生效」这种最难解释的 bug。
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

/** 一次把两条路径的当前模型都取回来，给 `/usage` 页渲染用 */
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

/* ---------------------------------------------------------------- 提示词 */

const promptKeyOf = (purpose: Purpose) => `prompt.${purpose}`;

/**
 * 取某条路径当前用的 system prompt。
 *
 * 和 `getModel` 一样的兜底哲学：**查不到、或者库里存的是空/超长的脏值，
 * 一律退回代码里的默认值**。提示词是每次调用都要发的东西，
 * 它坏了整条 AI 路径就废了 —— 一个设置项不该有能力弄挂主流程。
 *
 * 同样**不缓存**：AI 调用本身几秒起步，多这一次约 50ms 的查询无所谓；
 * 加了缓存就会出现「刚在页面上改完提示词但没生效」这种最难解释的 bug。
 */
export async function getPrompt(purpose: Purpose): Promise<string> {
  return (await readOverride(purpose)) ?? DEFAULT_PROMPT[purpose];
}

/**
 * `/usage` 页渲染用：每条路径的当前提示词 + **它是不是被改过**。
 *
 * `customized` 看的是**库里有没有那一行**，不是「文本和默认值一不一样」——
 * 他完全可能把内容手工改回和默认一模一样再存一次，那时「恢复默认」仍然该是亮的：
 * 库里那一行还在，以后代码里的默认提示词一改，这条不会跟上。
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

/** 库里那份自定义提示词；没有、或者是脏值，都当没有 */
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
 * 存一份自定义提示词，`null` = **恢复默认**。
 *
 * 🔴 恢复默认是**删掉那一行，而不是把默认文本写进库**。写进去的话，
 * 以后我在 `prompts.ts` 里改进了默认提示词，这条会被那份旧快照挡住 ——
 * 而且从页面上完全看不出来「你以为在用默认，其实用的是三个月前的默认」。
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
