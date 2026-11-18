import { describe, expect, it } from 'vitest';
import { createTestApp, login, seedCampaign } from './helpers';

describe('campanhas', () => {
  it('cria campanha, convida e o jogador entra', async () => {
    const t = await createTestApp();
    const gm = await login(t.app, 'Mestre');
    const pl = await login(t.app, 'Lia');
    const c = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: gm.cookie }, payload: { name: 'Estalagem do Corvo', rulesVersion: '2024' } });
    expect(c.statusCode).toBe(201);
    const { id } = c.json();
    const inv = await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/invites`, headers: { cookie: gm.cookie } });
    const { token, url } = inv.json();
    expect(url).toBe(`http://localhost:5173/convite/${token}`);
    const prev = await t.app.inject({ url: `/api/invites/${token}`, headers: { cookie: pl.cookie } });
    expect(prev.json()).toEqual({ campaignId: id, campaignName: 'Estalagem do Corvo', alreadyMember: false });
    await t.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: pl.cookie } });
    const list = await t.app.inject({ url: '/api/campaigns', headers: { cookie: pl.cookie } });
    expect(list.json()).toEqual([{ id, name: 'Estalagem do Corvo', role: 'player', rulesVersion: '2024' }]);
  });
  it('jogador não cria convite e convite revogado não funciona', async () => {
    const t = await createTestApp();
    const { campaignId, gm, player } = await seedCampaign(t);
    expect((await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: player.cookie } })).statusCode).toBe(403);
    const { token } = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: gm.cookie } })).json();
    await t.app.inject({ method: 'DELETE', url: `/api/campaigns/${campaignId}/invites/${token}`, headers: { cookie: gm.cookie } });
    const other = await login(t.app, 'Intruso');
    expect((await t.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
  });
  it('gerar um novo convite revoga os anteriores da campanha, e só os dela', async () => {
    const t = await createTestApp();
    const { campaignId, gm } = await seedCampaign(t);
    const newInvite = async (id: string) =>
      (await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/invites`, headers: { cookie: gm.cookie } })).json().token as string;
    const { id: otherCampaign } = (
      await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: gm.cookie }, payload: { name: 'Outra', rulesVersion: '2014' } })
    ).json();
    const otherToken = await newInvite(otherCampaign);
    const oldToken = await newInvite(campaignId);
    const newToken = await newInvite(campaignId);
    const guest = await login(t.app, 'Convidada');
    const status = async (token: string) => (await t.app.inject({ url: `/api/invites/${token}`, headers: { cookie: guest.cookie } })).statusCode;
    expect(await status(oldToken)).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/invites/${oldToken}/accept`, headers: { cookie: guest.cookie } })).statusCode).toBe(404);
    expect(await status(newToken)).toBe(200);
    expect(await status(otherToken)).toBe(200);
    await t.close();
  });
  it('quem não é membro recebe 404 e corpo inválido é 400', async () => {
    const t = await createTestApp();
    const { campaignId } = await seedCampaign(t);
    const other = await login(t.app, 'Intruso');
    expect((await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: other.cookie }, payload: { name: '', rulesVersion: '3' } })).statusCode).toBe(400);
  });
  it('aceitar convite sendo mestre mantém o papel; id malformado é 404', async () => {
    const t = await createTestApp();
    const { campaignId, gm } = await seedCampaign(t);
    const { token } = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: gm.cookie } })).json();
    const acc = await t.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: gm.cookie } });
    expect(acc.json()).toEqual({ campaignId });
    const list = await t.app.inject({ url: '/api/campaigns', headers: { cookie: gm.cookie } });
    expect(list.json()[0].role).toBe('gm');
    expect((await t.app.inject({ method: 'POST', url: '/api/campaigns/xyz/invites', headers: { cookie: gm.cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/campaigns' })).statusCode).toBe(401);
  });
});
