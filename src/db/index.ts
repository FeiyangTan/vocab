import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

/**
 * At runtime this uses Neon's **pooled** connection string (hostname contains -pooler).
 * Migrations use the direct string, which only drizzle.config.ts touches.
 *
 * neon-serverless (a WebSocket Pool) rather than neon-http, because **transactions are
 * required**: confirming one item writes to words + encounters + cards + inbox, and failing
 * partway would leave orphan rows.
 *
 * Loaded lazily: `next build` imports every route module during "collecting page data". If
 * DATABASE_URL were read at module top level, the build would be forced to depend on a
 * runtime secret — so the connection is only opened on the first real query.
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    cached = drizzle(new Pool({ connectionString: url }), { schema });
  }
  return cached;
}

export { schema };
