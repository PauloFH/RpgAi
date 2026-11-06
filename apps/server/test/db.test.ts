import { expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { createTestApp } from './helpers';

it('aplica as migrações e responde health', async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/api/health' });
  expect(res.json()).toEqual({ ok: true });
  const rows = await t.db.select().from(users);
  expect(rows).toEqual([]);
  await t.close();
});

it('o pool do Postgres tem limite de tempo para conectar e para cada consulta', async () => {
  const { db, close } = await createDb('postgres://u:p@127.0.0.1:1/db');
  const { options } = (db as unknown as { $client: { options: Record<string, unknown> } }).$client;
  expect(options).toMatchObject({
    connectionTimeoutMillis: expect.any(Number),
    query_timeout: expect.any(Number),
    statement_timeout: expect.any(Number),
  });
  await close();
});
