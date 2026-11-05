import { describe, expect, it } from 'vitest';
import { createTestApp, login, pngBuffer, seedCampaign, testConfig, uploadFile } from './helpers';

describe('uploads', () => {
  it('mestre sobe PNG, membro lê, estranho não', async () => {
    const t = await createTestApp();
    const { campaignId, gm, player } = await seedCampaign(t);
    const up = await uploadFile(t.app, gm.cookie, campaignId, pngBuffer(700, 700), 'mapa.png');
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({ width: 700, height: 700 });
    const url = up.json().url;
    expect((await t.app.inject({ url, headers: { cookie: player.cookie } })).headers['content-type']).toBe('image/png');
    const other = await login(t.app, 'Intruso');
    expect((await t.app.inject({ url, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    await t.close();
  });
  it('recusa arquivo que não é imagem mesmo com extensão .png', async () => {
    const t = await createTestApp();
    const { campaignId, gm } = await seedCampaign(t);
    const up = await uploadFile(t.app, gm.cookie, campaignId, Buffer.from('não sou imagem'), 'falso.png');
    expect(up.statusCode).toBe(400);
    expect(up.json()).toEqual({ error: 'invalid_image' });
    await t.close();
  });
  it('recusa arquivo grande demais e upload de jogador', async () => {
    const t = await createTestApp({ config: { ...testConfig(), maxUploadBytes: 1000 } });
    const { campaignId, gm, player } = await seedCampaign(t);
    const big = await uploadFile(t.app, gm.cookie, campaignId, pngBuffer(700, 700), 'm.png');
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: 'too_large' });
    expect((await uploadFile(t.app, player.cookie, campaignId, pngBuffer(10, 10), 'm.png')).statusCode).toBe(403);
    await t.close();
  });
  it('não aceita path traversal na leitura', async () => {
    const t = await createTestApp();
    const { campaignId, gm } = await seedCampaign(t);
    for (const url of [`/files/${campaignId}/..%2F..%2Fx.png`, `/files/..%2F..%2Fx/${'a'.repeat(36)}.png`, `/files/${campaignId}/${'a'.repeat(36)}.png`]) {
      expect((await t.app.inject({ url, headers: { cookie: gm.cookie } })).statusCode).toBe(404);
    }
    await t.close();
  });
});
