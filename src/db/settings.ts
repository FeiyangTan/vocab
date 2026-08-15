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
