import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadRootEnv, loadServerEnv } from '@counter/config/env';

loadRootEnv();
const env = loadServerEnv();

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run migrations (this is a Node/Bun-only script).');
}

// A dedicated single connection for migrations, closed when finished.
const migrationClient = postgres(env.DATABASE_URL, { max: 1 });

console.log('Running migrations…');
await migrate(drizzle(migrationClient), { migrationsFolder: `${import.meta.dir}/../drizzle` });
console.log('Migrations complete.');

await migrationClient.end();
process.exit(0);
