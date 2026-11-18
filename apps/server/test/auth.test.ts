import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCTION_LOGGER } from '../src/app';
import type { DiscordClient } from '../src/auth/discord';
import { sessions, users } from '../src/db/schema';
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

describe('login pelo Discord que não dá certo volta à página inicial com o motivo', () => {
  const expectFailure = async (t: Awaited<ReturnType<typeof createTestApp>>, res: Awaited<ReturnType<typeof t.app.inject>>, code: string) => {
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/?login_error=${code}`);
    expect(res.cookies.find((c) => c.name === 'sid')).toBeUndefined();
    expect(await t.db.select().from(sessions)).toHaveLength(0);
    expect(await t.db.select().from(users)).toHaveLength(0);
  };

  it('state diferente', async () => {
    const t = await createTestApp({ discord: fakeDiscord });
    const res = await t.app.inject({ url: '/auth/discord/callback?code=good&state=x', cookies: { oauth_state: 'y' } });
    await expectFailure(t, res, 'bad_state');
  });
  it('sem cookie de state, sem state ou sem código', async () => {
    const t = await createTestApp({ discord: fakeDiscord });
    await expectFailure(t, await t.app.inject({ url: '/auth/discord/callback?code=good&state=x' }), 'bad_state');
    await expectFailure(t, await t.app.inject({ url: '/auth/discord/callback?code=good', cookies: { oauth_state: 'x' } }), 'bad_state');
    await expectFailure(t, await t.app.inject({ url: '/auth/discord/callback?state=x', cookies: { oauth_state: 'x' } }), 'bad_state');
  });
  it('a pessoa cancelou no Discord', async () => {
    const t = await createTestApp({ discord: fakeDiscord });
    const res = await t.app.inject({
      url: '/auth/discord/callback?error=access_denied&error_description=x&state=s',
      cookies: { oauth_state: 's' },
    });
    await expectFailure(t, res, 'access_denied');
  });
  it('erro com state errado conta como state errado, e não ecoa o que veio na URL', async () => {
    const t = await createTestApp({ discord: fakeDiscord });
    const denied = await t.app.inject({ url: '/auth/discord/callback?error=access_denied&state=x', cookies: { oauth_state: 'y' } });
    await expectFailure(t, denied, 'bad_state');
    const other = await t.app.inject({ url: '/auth/discord/callback?error=%3Cscript%3E&state=s', cookies: { oauth_state: 's' } });
    await expectFailure(t, other, 'discord_error');
  });
  it('código e state certos mas erro do Discord', async () => {
    const t = await createTestApp({ discord: fakeDiscord });
    const res = await t.app.inject({ url: '/auth/discord/callback?code=ruim&state=s', cookies: { oauth_state: 's' } });
    await expectFailure(t, res, 'discord_error');
  });
  it('Discord não configurado, na ida e na volta', async () => {
    const t = await createTestApp();
    await expectFailure(t, await t.app.inject({ url: '/auth/discord' }), 'discord_not_configured');
    await expectFailure(t, await t.app.inject({ url: '/auth/discord/callback?code=good&state=s' }), 'discord_not_configured');
  });
});

it('falha do Discord fica registrada no log, sem o código recebido', async () => {
  const t = await createTestApp({ discord: fakeDiscord });
  const logged = vi.spyOn(t.app.log, 'error').mockImplementation(() => undefined);
  await t.app.inject({
    url: '/auth/discord/callback?code=codigo-secreto&state=s',
    cookies: { oauth_state: 's' },
  });
  expect(logged).toHaveBeenCalledTimes(1);
  expect(logged).toHaveBeenCalledWith({ err: expect.any(Error) }, expect.any(String));
  const [fields, message] = logged.mock.calls[0] as unknown as [{ err: Error }, string];
  expect(`${fields.err.message} ${message}`).not.toContain('codigo-secreto');
});

it('em produção o app registra as requisições', async () => {
  const off = await createTestApp();
  expect(off.app.log.level).not.toBe('info');
  const on = await createTestApp({ config: { ...testConfig(), production: true, devLogin: false } });
  expect(on.app.log.level).toBe('info');
});

it('o log de requisições não contém a query, onde vem o código do Discord', async () => {
  const lines: string[] = [];
  const app = Fastify({ logger: { ...PRODUCTION_LOGGER, stream: { write: (line: string) => void lines.push(line) } } });
  app.get('/auth/discord/callback', async () => 'ok');
  await app.inject({ url: '/auth/discord/callback?code=codigo-secreto&state=s' });
  await app.close();
  const output = lines.join('');
  expect(output).toContain('/auth/discord/callback');
  expect(output).not.toContain('codigo-secreto');
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
