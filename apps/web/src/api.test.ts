import { expect, it, vi } from 'vitest';
import { api } from './api';

it('transforma erro do servidor em ApiError com código', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) as typeof fetch;
  await expect(api.post('/api/campaigns/x/invites')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
});
it('get devolve o JSON', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([{ id: '1' }]), { status: 200 })) as typeof fetch;
  expect(await api.get('/api/campaigns')).toEqual([{ id: '1' }]);
});
