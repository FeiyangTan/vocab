import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

/**
 * 运行时走 Neon 的 **pooled** 连接串（主机名带 -pooler）。
 * 迁移走 direct 串，那个只在 drizzle.config.ts 里用。
 *
 * 用 neon-serverless（WebSocket Pool）而不是 neon-http，因为**需要事务**：
 * 审核确认一条要连写 words + encounters + cards + inbox 四处，中途失败会留下孤儿行。
 *
 * 懒加载：next build 在 collecting page data 阶段会 import 每个路由模块。
 * 如果在模块顶层读 DATABASE_URL，构建期就被迫依赖运行时密钥了 —— 第一次
 * 真正查询时才建连接。
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 未配置');
    cached = drizzle(new Pool({ connectionString: url }), { schema });
  }
  return cached;
}

export { schema };
