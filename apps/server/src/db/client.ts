import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

// Both the PGlite and node-postgres Drizzle instances extend PgDatabase, so
// queries and transactions are typed against that common base.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

type Driver =
  | { kind: 'pglite'; db: ReturnType<typeof drizzlePglite<typeof schema>> }
  | { kind: 'pg'; db: ReturnType<typeof drizzlePg<typeof schema>> };

// The migrators are driver-specific, so remember which driver built each Db.
const drivers = new WeakMap<object, Driver>();

// Without these a stuck statement holds its room's queue, and enough of them the whole
// pool, forever. The client-side limit is a backstop for when the server never answers.
const POOL_TIMEOUTS = {
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
};

export async function createDb(url: string): Promise<{ db: Db; close(): Promise<void> }> {
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    if (target !== 'memory') mkdirSync(target, { recursive: true });
    const client = new PGlite(target === 'memory' ? undefined : target);
    const db = drizzlePglite(client, { schema });
    drivers.set(db, { kind: 'pglite', db });
    return { db, close: () => client.close() };
  }
  const pool = new pg.Pool({ connectionString: url, ...POOL_TIMEOUTS });
  // An idle client that fails (server restart, network) emits this; unheard, it ends the process.
  pool.on('error', (err) => console.error('[db] idle client failed', err));
  const db = drizzlePg(pool, { schema });
  drivers.set(db, { kind: 'pg', db });
  return { db, close: () => pool.end() };
}

export async function runMigrations(
  db: Db,
  migrationsFolder: string = fileURLToPath(new URL('./migrations', import.meta.url)),
): Promise<void> {
  const driver = drivers.get(db);
  if (!driver) throw new Error('Db was not created by createDb');
  if (driver.kind === 'pglite') await migratePglite(driver.db, { migrationsFolder });
  else await migratePg(driver.db, { migrationsFolder });
}
