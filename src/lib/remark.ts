/** 手滑粘一大段进来的防线，不是产品功能 */
export const MAX_REMARK = 500;

/**
 * 清洗备注：trim、截断，空的一律归成 null。
 *
 * 三个写入口共用 —— `PUT /api/words/{id}/remark`（词已存在）、
 * `POST /api/inbox/{id}/confirm` 和 `POST /api/inbox/confirm-batch`
 * （词还不存在，随确认一起创建）。
 *
 * **中间的换行保留** —— 备注可能是几行，只 trim 首尾。
 * 空串和 null 是一回事，都当没写过，别在库里留一堆空字符串。
 */
export function cleanRemark(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const remark = value.trim();
  if (!remark) return null;
  return remark.slice(0, MAX_REMARK);
}
