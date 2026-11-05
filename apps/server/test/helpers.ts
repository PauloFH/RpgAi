import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app';
import type { Config } from '../src/config';
import { createDb, runMigrations, type Db } from '../src/db/client';

export function testConfig(): Config {
  return {
    port: 0,
    publicUrl: 'http://localhost:5173',
    databaseUrl: 'pglite:memory',
    uploadDir: mkdtempSync(join(tmpdir(), 'rpgai-uploads-')),
    maxUploadBytes: 20 * 1024 * 1024,
    devLogin: true,
    production: false,
    discord: null,
    webDist: null,
  };
}

export async function createTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<{ app: FastifyInstance; db: Db; deps: AppDeps; close(): Promise<void> }> {
  const owned = overrides.db ? null : await createDb('pglite:memory');
  const db = overrides.db ?? owned!.db;
  if (owned) await runMigrations(db);
  const deps: AppDeps = {
    discord: null,
    files: {},
    rng: (faces) => faces,
    ...overrides,
    config: overrides.config ?? testConfig(),
    db,
  };
  const app = await buildApp(deps);
  return {
    app,
    db,
    deps,
    close: async () => {
      await app.close();
      await owned?.close();
    },
  };
}

export async function login(
  app: FastifyInstance,
  name: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name } });
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (res.statusCode !== 200 || !sid) throw new Error(`dev-login failed: ${res.statusCode} ${res.body}`);
  return { cookie: `sid=${sid.value}`, userId: (res.json() as { userId: string }).userId };
}
