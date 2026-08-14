import { PRICES } from './pricing';

/**
 * 两条 AI 路径各用哪个模型 —— 在 `/usage` 页上选，存在 `settings` 表里。
 *
 * 放在用量页是因为那一页本来就**按模型分组显示花费估算**：在花费旁边挑模型，
 * 改完下一次调用就记在新模型名下，贵了还是便宜了一眼能对比。
 *
 * 🔴 **这个文件必须保持「客户端安全」** —— 名单和校验函数被 `/usage` 页那个
 * `'use client'` 的选择器直接 import。一旦在这儿 import `@/db`，drizzle 和
 * Neon 驱动就会被打进浏览器包（实测会让 Vercel 构建直接失败）。
 * 读写库的部分在 `src/db/settings.ts`。
 */

/** 两条会调 Claude 的路径 */
export const PURPOSES = ['process', 'contrast'] as const;
export type Purpose = (typeof PURPOSES)[number];

export const PURPOSE_LABEL: Record<Purpose, string> = {
  process: '整理草稿',
  contrast: '对比词匹配',
};

/**
 * 能选的模型。
 *
 * 🔴 **每一个都必须在 `PRICES` 里**（下面有运行时断言）。不在的话 `/usage`
 * 会显示「单价未知」、花费不计入总额 —— 而这一页的全部意义就是看花费。
 * 以后要加新模型，先去 `pricing.ts` 补单价。
 *
 * 只列三个档位，不把 `PRICES` 里全部六个都摆出来（还有 opus-4.8 / 4.5 / fable）——
 * 那些是同档位的噪音版本，选起来只会犹豫。
 */
export const MODEL_CHOICES = [
  { id: 'claude-opus-5', tier: '最强', note: '$5 / $25', effort: true },
  {
    id: 'claude-sonnet-5',
    tier: '均衡',
    note: '$2 / $10（优惠价 2026-08-31 到期，之后 $3/$15）',
    effort: true,
  },
  { id: 'claude-haiku-4-5-20251001', tier: '最便宜', note: '$1 / $5', effort: false },
] as const;

export type ModelId = (typeof MODEL_CHOICES)[number]['id'];

/**
 * 这个模型认不认 `output_config.effort`。
 *
 * 🔴 **实测出来的，不是猜的**：给 Haiku 4.5 传 effort 会直接
 * `400 This model does not support the effort parameter.` —— 整个调用失败，
 * 不是降级忽略。effort 是 Claude 5 家族的参数，Haiku 4.5 是 4.x 代。
 *
 * `format: { type: 'json_schema' }` 两边都支持，所以结构化输出那套不用改。
 */
export function supportsEffort(model: ModelId): boolean {
  return MODEL_CHOICES.find((c) => c.id === model)?.effort ?? false;
}

// 开发期就炸，别等到线上花费统计悄悄算错
for (const choice of MODEL_CHOICES) {
  if (!PRICES[choice.id]) {
    throw new Error(`模型 ${choice.id} 不在 pricing.ts 的单价表里，先去补单价`);
  }
}

/**
 * 默认值。**故意不是最强的那个** —— 按任务难度给：
 *
 * - `process` 整理草稿是质量关键路径：要词形还原、按语境写释义和词性、还要生成
 *   能和原句**对齐**的挖空句（现在 224/224 全对得上，词汇页里句中变形词的高亮
 *   完全靠它）。所以只降一档到 Sonnet。
 * - `contrast` 对比词风险低：同音词已经由 `homophonesOf` 从 CMUdict 音标表机械
 *   算出来了，模型只负责形近词，出来还要过 `isCommon`（Zipf ≥ 3.5）和
 *   `looksLikeRealWord` 两道筛。降到底最坏也就是建议少几个。
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
