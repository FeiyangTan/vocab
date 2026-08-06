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

/**
 * `carve (cave)` 这种写法：括号里的自动变成前面那个词的对比词。
 *
 * **匹配得很窄，是故意的** —— 括号在真实句子里太常见了
 * （`The dropdown box (a UI control) was ambiguous.`），乱剥会把语境毁掉。
 * 只有同时满足下面几条才认：
 *
 * - 整行**以 `)` 结尾**，且只有一对括号（`)` 后面还有字就是句子，不是这个写法）
 * - 括号前的部分是个**词或短词组**（≤ 3 个词），不是一句话
 * - 括号内外都不为空
 *
 * 认不出来就原样返回，`contrasts` 是空数组 —— 宁可漏判让人手填，
 * 也不要把一句真实语境剥坏。
 *
 * 多个对比词用逗号 / 顿号 / 分号 / 斜杠分隔：`carve (cave, curve)`。
 * **不按空格拆**，这样 `(dropdown box)` 这种词组也能当一个对比词。
 */
export function splitContrastSuffix(raw: string): { text: string; contrasts: string[] } {
  const none = { text: raw, contrasts: [] as string[] };

  const trimmed = raw.trim();
  const match = /^([^()]+)[（(]([^()（）]+)[)）]$/.exec(trimmed);
  if (!match) return none;

  const head = match[1].trim();
  const inside = match[2].trim();
  if (!head || !inside) return none;

  // 括号前是一整句话时不认 —— 那多半是真实语境里的插入语
  if (head.split(/\s+/).length > 3) return none;

  const contrasts = cleanContrasts(inside.split(/[,，、;；/／]+/)) ?? [];
  if (contrasts.length === 0) return none;

  return { text: head, contrasts };
}
