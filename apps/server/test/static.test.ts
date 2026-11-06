import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, makeTempDir, testConfig } from './helpers';

describe('static web app', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function appWithDist() {
    const dir = await makeTempDir({
      'index.html': '<!doctype html><title>RpgAi</title>',
      'assets/app.js': 'console.log(1)',
    });
    const t = await createTestApp({ config: { ...testConfig(), webDist: dir } });
    closers.push(t.close);
    return t;
  }

  it('serve o index.html para rotas do app e não engole a API', async () => {
    const t = await appWithDist();
    expect((await t.app.inject({ url: '/c/qualquer' })).body).toContain('<title>RpgAi</title>');
    expect((await t.app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });

  it('serve arquivos reais e mantém 404 nos prefixos da API', async () => {
    const t = await appWithDist();
    expect((await t.app.inject({ url: '/assets/app.js' })).body).toBe('console.log(1)');
    expect((await t.app.inject({ url: '/api/nada' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/auth/nada' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/files/nada' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/ws/nada' })).statusCode).toBe(404);
  });

  it('não aplica o fallback a métodos que não são GET', async () => {
    const t = await appWithDist();
    const res = await t.app.inject({ method: 'POST', url: '/c/qualquer', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<title>RpgAi</title>');
  });

  it('sem webDist não serve nada', async () => {
    const t = await createTestApp();
    closers.push(t.close);
    expect((await t.app.inject({ url: '/c/qualquer' })).statusCode).toBe(404);
  });
});
