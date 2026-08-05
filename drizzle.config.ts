import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit 不走 Next 的 env 加载，得自己读 .env.local
config({ path: '.env.local' });

const url = process.env.DATABASE_URL_DIRECT;
if (!url) throw new Error('DATABASE_URL_DIRECT 未配置（迁移必须走直连串，不能走 -pooler）');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
