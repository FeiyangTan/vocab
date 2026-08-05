import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * 运行时走 Neon 的 **pooled** 连接串（主机名带 -pooler）。
 * 迁移走 direct 串，那个只在 drizzle.config.ts 里用。
 *
 * 注意：neon-http 驱动不支持事务。Phase 4 的 /api/inbox/process 要一次写
 * words + encounters + cards，如果那时需要原子性，换成 drizzle-orm/neon-serverless
 * （WebSocket Pool）。现在不提前换。
 */

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL 未配置');

export const db = drizzle(neon(url), { schema });
export { schema };
