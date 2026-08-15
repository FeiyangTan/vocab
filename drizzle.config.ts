import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit doesn't use Next's env loading, so read .env.local directly
config({ path: '.env.local' });

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error(
    'DATABASE_URL_DIRECT is not configured (migrations must use the direct string, not -pooler)',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
