/** 手滑粘一大段进来的防线，不是产品功能 */
export const MAX_CONTRASTS = 8;

/**
 * 清洗对比词数组：trim、丢空串、去重、截断。
 *
 * 两个写入口共用 —— `PUT /api/words/{id}/contrasts`（词已存在）和
 * `POST /api/inbox/{id}/confirm`（词还不存在，随确认一起创建）。
 * 返回 null 表示输入根本不是数组。
 */
export function cleanContrasts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const word = item.trim();
    if (word && !seen.has(word)) seen.add(word);
    if (seen.size >= MAX_CONTRASTS) break;
  }
  return [...seen];
}
