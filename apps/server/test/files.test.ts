import { describe, expect, it, vi } from 'vitest';
import { uploads } from '../src/db/schema';
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
  it('recusa o upload que passaria do limite da campanha, sem gravar nada', async () => {
    const png = pngBuffer(50, 50);
    const t = await createTestApp({ config: { ...testConfig(), maxCampaignUploadBytes: png.length * 2 } });
    const put = vi.spyOn(t.deps.files, 'put');
    const { campaignId, gm } = await seedCampaign(t);
    for (let i = 0; i < 2; i++) expect((await uploadFile(t.app, gm.cookie, campaignId, png, 'm.png')).statusCode).toBe(201);
    expect(put).toHaveBeenCalledTimes(2);

    const full = await uploadFile(t.app, gm.cookie, campaignId, png, 'm.png');
    expect(full.statusCode).toBe(413);
    expect(full.json()).toEqual({ error: 'campaign_storage_full' });
    expect(put).toHaveBeenCalledTimes(2);
    expect(await t.db.select().from(uploads)).toHaveLength(2);

    // The limit is per campaign: another one still has all of it.
    const { id: other } = (
      await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: gm.cookie }, payload: { name: 'Outra', rulesVersion: '2024' } })
    ).json();
    expect((await uploadFile(t.app, gm.cookie, other, png, 'm.png')).statusCode).toBe(201);
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
