import { expect, it } from 'vitest';
import type { DiscordClient } from '../src/auth/discord';
import { sessions } from '../src/db/schema';
import { createTestApp, login, testConfig } from './helpers';

const fakeDiscord: DiscordClient = {
  authorizeUrl: (s) => `https://discord.test/authorize?state=${s}`,
  exchangeCode: async (c) => (c === 'good' ? 'tok' : Promise.reject(new Error('bad'))),
  getUser: async () => ({ id: '42', username: 'paulo', global_name: 'Paulo', avatar: 'abc' }),
};

it('dev-login cria sessão e /api/me devolve o usuário', async () => {
  const t = await createTestApp();
  const { cookie } = await login(t.app, 'Mestre');
  const me = await t.app.inject({ url: '/api/me', headers: { cookie } });
  expect(me.json()).toMatchObject({ displayName: 'Mestre', avatarUrl: null });
});

it('sem cookie /api/me é 401', async () => {
  const t = await createTestApp();
  expect((await t.app.inject({ url: '/api/me' })).statusCode).toBe(401);
});

it('fluxo do Discord cria usuário com avatar', async () => {
  const t = await createTestApp({ discord: fakeDiscord });
  const start = await t.app.inject({ url: '/auth/discord' });
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const stateCookie = start.cookies.find((c) => c.name === 'oauth_state')!;
  const cb = await t.app.inject({
    url: `/auth/discord/callback?code=good&state=${state}`,
    cookies: { oauth_state: stateCookie.value },
  });
  expect(cb.statusCode).toBe(302);
  const sid = cb.cookies.find((c) => c.name === 'sid')!.value;
  const me = await t.app.inject({ url: '/api/me', cookies: { sid } });
  expect(me.json()).toMatchObject({
    displayName: 'Paulo',
    avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png',
  });
});

it('state diferente é recusado', async () => {
  const t = await createTestApp({ discord: fakeDiscord });
  const cb = await t.app.inject({
    url: '/auth/discord/callback?code=good&state=x',
    cookies: { oauth_state: 'y' },
  });
  expect(cb.statusCode).toBe(400);
});

it('dev-login não existe em produção', async () => {
  const t = await createTestApp({ config: { ...testConfig(), devLogin: false } });
  expect(
    (await t.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name: 'x' } })).statusCode,
  ).toBe(404);
});

it('logout invalida a sessão', async () => {
  const t = await createTestApp();
  const { cookie } = await login(t.app, 'A');
  await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
  expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
});

it('sessão expirada é recusada e apagada', async () => {
  const t = await createTestApp();
  const { cookie } = await login(t.app, 'B');
  await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
  expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  expect(await t.db.select().from(sessions)).toHaveLength(0);
});

it('dev-login não reaproveita usuário ligado ao Discord', async () => {
  const t = await createTestApp({ discord: fakeDiscord });
  const start = await t.app.inject({ url: '/auth/discord' });
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  await t.app.inject({
    url: `/auth/discord/callback?code=good&state=${state}`,
    cookies: { oauth_state: start.cookies.find((c) => c.name === 'oauth_state')!.value },
  });
  const a = await login(t.app, 'Paulo');
  const b = await login(t.app, 'Paulo');
  expect(a.userId).toBe(b.userId);
  const me = await t.app.inject({ url: '/api/me', headers: { cookie: a.cookie } });
  expect(me.json().avatarUrl).toBeNull();
});
