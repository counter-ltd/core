import { defineConfig } from 'drizzle-kit';
import { loadRootEnv, loadServerEnv } from '@counter/config/env';

loadRootEnv();
const env = loadServerEnv();

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run drizzle-kit (migrations are Node/Bun-only).');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
