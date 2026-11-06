import { describe, expect, it, vi } from 'vitest';
import { actionLog, campaignMembers, chatMessages, users } from '../src/db/schema';
import { CampaignRoom } from '../src/table/room';
import { setup } from './room-setup';

describe('chat', () => {
  it('/r rola no servidor e todos veem', async () => {
    const { room, P } = await setup({ rng: (f) => (f === 20 ? 17 : f) });
    await room.dispatch(P, { type: 'chat.send', text: '/r 1d20+5 Ataque' });
    expect(room.state().chat.at(-1)).toMatchObject({ kind: 'roll', label: 'Ataque', recipients: null, rolls: [{ total: 22 }] });
  });
  it('/gr do jogador vai só para ele e para os mestres', async () => {
    const { room, G, P } = await setup();
    await room.dispatch(P, { type: 'chat.send', text: '/gr 1d20' });
    const last = room.state().chat.at(-1)!;
    expect(last.secret).toBe(true);
    expect(new Set(last.recipients)).toEqual(new Set([P.userId, G.userId]));
  });
  it('/gr do mestre não repete o mestre', async () => {
    const { room, G } = await setup();
    await room.dispatch(G, { type: 'chat.send', text: '/gr 1d20' });
    expect(room.state().chat.at(-1)!.recipients).toEqual([G.userId]);
  });
  it('/w acha o membro pelo nome e falha para nome desconhecido', async () => {
    const { room, G, P } = await setup();
    await room.dispatch(G, { type: 'chat.send', text: '/w lia cuidado' });
    expect(room.state().chat.at(-1)).toMatchObject({ kind: 'whisper', text: 'cuidado', recipients: [G.userId, P.userId] });
    expect(await room.dispatch(G, { type: 'chat.send', text: '/w Ninguém oi' })).toMatchObject({ code: 'invalid' });
  });
  it('rolagens embutidas e dados inválidos', async () => {
    const { room, P, t } = await setup();
    await room.dispatch(P, { type: 'chat.send', text: 'ataco [[1d20]] e causo [[2d6]]' });
    expect(room.state().chat.at(-1)!.rolls).toHaveLength(2);
    const chatBefore = room.state().chat.length;
    const logBefore = (await t.db.select().from(actionLog)).length;
    expect(await room.dispatch(P, { type: 'chat.send', text: '/r 1d0' })).toMatchObject({ code: 'dice' });
    expect(await room.dispatch(P, { type: 'chat.send', text: '/r 1000000d6' })).toMatchObject({ code: 'dice' });
    expect(room.state().chat).toHaveLength(chatBefore);
    expect(await t.db.select().from(actionLog)).toHaveLength(logBefore);
  });
  it('rolagens embutidas acima do limite são recusadas e não gravam nada', async () => {
    const rolled = vi.fn((faces: number) => faces);
    const { room, P, t } = await setup({ rng: rolled });
    const chatBefore = room.state().chat.length;
    const logBefore = (await t.db.select().from(actionLog)).length;
    expect(await room.dispatch(P, { type: 'chat.send', text: '[[100d6]]'.repeat(222) })).toMatchObject({ ok: false, code: 'dice' });
    expect(rolled).not.toHaveBeenCalled();
    expect(room.state().chat).toHaveLength(chatBefore);
    expect(await t.db.select().from(chatMessages)).toHaveLength(0);
    expect(await t.db.select().from(actionLog)).toHaveLength(logBefore);
  });
  it('comando desconhecido é inválido e não grava nada', async () => {
    const { room, P, t } = await setup();
    const before = room.state().chat.length;
    const logBefore = (await t.db.select().from(actionLog)).length;
    expect(await room.dispatch(P, { type: 'chat.send', text: '/xyz' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(room.state().chat).toHaveLength(before);
    expect(await t.db.select().from(actionLog)).toHaveLength(logBefore);
  });
  it('desfazer uma rolagem a deixa marcada no chat', async () => {
    const { room, G } = await setup();
    await room.dispatch(G, { type: 'chat.send', text: '/r 1d20' });
    const r = await room.dispatch(G, { type: 'undo' });
    expect(room.state().chat.at(-1)!.undone).toBe(true);
    expect(r.ok && r.events.some((e) => e.type === 'chat.updated')).toBe(true);
  });
  it('envio emite chat.added e a mensagem sobrevive a recarregar a sala', async () => {
    const { room, P, t, campaignId } = await setup();
    const r = await room.dispatch(P, { type: 'chat.send', text: 'olá' });
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['chat.added', 'undo.available']);
    const fresh = await CampaignRoom.load(t.db, campaignId, t.deps.rng);
    expect(fresh.state().chat.at(-1)).toMatchObject({ text: 'olá', kind: 'text', authorId: P.userId });
  });
  it('desfazer ignora sussurro entre outros membros e desfaz a ação anterior do mestre', async () => {
    const { room, G, P, t, campaignId, m1 } = await setup();
    const [other] = await t.db.insert(users).values({ displayName: 'Davi' }).returning();
    await t.db.insert(campaignMembers).values({ campaignId, userId: other!.id, role: 'player' });
    const fresh = await CampaignRoom.load(t.db, campaignId, t.deps.rng);
    await fresh.dispatch(G, { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1, size: 1, color: '#c9483f', layer: 'tokens', ownerIds: [] });
    await fresh.dispatch(P, { type: 'chat.send', text: '/w Davi psiu' });
    const whisper = fresh.state().chat.at(-1)!;
    expect(whisper.recipients).toEqual([P.userId, other!.id]);
    expect(fresh.canUndo()).toBe(true);
    const r = await fresh.dispatch(G, { type: 'undo' });
    expect(r.ok).toBe(true);
    expect(fresh.state().chat.at(-1)!.undone).toBe(false);
    expect(fresh.state().tokens).toHaveLength(0);
    expect(fresh.state().chat.at(-1)!.undone).toBe(false);
  });
});
