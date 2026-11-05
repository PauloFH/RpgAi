import { expect, it } from 'vitest';
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
