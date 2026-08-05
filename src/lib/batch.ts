/**
 * 一次 `POST /api/inbox/process` 最多处理几条。
 *
 * 不是随便定的：一次塞太多条，Claude 的输出会变长、更容易出错，
 * 而且受 `max_tokens` 上限制约。
 *
 * 前端也要这个数 —— 按钮得如实说「这一下只处理 10 条」，
 * 而不是把待整理总数写上去。
 */
export const PROCESS_BATCH_SIZE = 10;
