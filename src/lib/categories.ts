/** 分类名长度上限。不是产品功能，是手滑粘一大段进来的防线 */
export const MAX_CATEGORY_NAME = 40;

/**
 * 清洗分类名：trim、把中间的连续空白折成一个空格、截断。
 *
 * 两个写入口共用 —— `POST /api/categories`（新建）和
 * `PATCH /api/categories/{id}`（改名）。返回 null 表示这个名字不能用。
 */
export function cleanCategoryName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return name.slice(0, MAX_CATEGORY_NAME);
}

/**
 * 路径参数 / 请求体里的分类 id 解析成正整数。
 *
 * 只保证「格式对」，**不保证库里存在** —— 存在性由调用方查库确认，
 * 因为报错文案和事务边界在每个路由里不一样。
 */
export function parseCategoryId(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * 复习范围：某个分类，或者 `'all'`（不挑分类，四个分类混着过）。
 *
 * 两种复习模式共用。分类 id 和 `'all'` 走同一个参数位，所以 `/review/5` 和
 * `/review/all` 能落在同一个动态路由上，不用为「全部」再开一套页面。
 */
export type Scope = number | 'all';

/** `parseCategoryId` 的超集：多认一个 `'all'`。 */
export function parseScope(value: unknown): Scope | null {
  if (value === 'all') return 'all';
  return parseCategoryId(value);
}
