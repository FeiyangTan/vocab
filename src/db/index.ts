import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * 运行时走 Neon 的 **pooled** 连接串（主机名带 -pooler）。
 * 迁移走 direct 串，那个只在 drizzle.config.ts 里用。
 *
 * 懒加载：next build 在 collecting page data 阶段会 import 每个路由模块。
 * 如果在模块顶层读 DATABASE_URL，构建期就被迫依赖运行时密钥了 —— 第一次
 * 真正查询时才建连接。
 *
 * 注意：neon-http 驱动不支持事务。Phase 4 的 /api/inbox/process 要一次写
 * words + encounters + cards，如果那时需要原子性，换成 drizzle-orm/neon-serverless
 * （WebSocket Pool）。现在不提前换。
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 未配置');
    cached = drizzle(neon(url), { schema });
  }
  return cached;
}

export { schema };
