import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { actionLog, campaignMembers, chatMessages, users } from '../src/db/schema';
import { CampaignRoom, UNDO_PAGE_SIZE } from '../src/table/room';
import { setup } from './room-setup';

describe('leitura do log para desfazer', () => {
  /**
   * `count` whispers between two players, written directly: much faster than dispatching them.
   * They stand for whispers with a roll: a plain-text one would have no inverse in the log.
   */
  async function hiddenWhispers(t: Awaited<ReturnType<typeof setup>>['t'], campaignId: string, from: string, to: string, count: number) {
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      await t.db.insert(chatMessages).values({ id, campaignId, authorId: from, kind: 'whisper', text: `psiu ${i}`, recipients: [from, to] });
      await t.db.insert(actionLog).values({ campaignId, actorId: from, via: 'web', type: 'chat.send', payload: {}, inverse: { op: 'chat.markUndone', messageId: id } });
    }
  }
  async function withThirdPlayer(s: Awaited<ReturnType<typeof setup>>) {
    const [other] = await s.t.db.insert(users).values({ displayName: 'Davi' }).returning();
    await s.t.db.insert(campaignMembers).values({ campaignId: s.campaignId, userId: other!.id, role: 'player' });
    return other!.id;
  }

  it.each([UNDO_PAGE_SIZE - 1, UNDO_PAGE_SIZE, UNDO_PAGE_SIZE + 1, UNDO_PAGE_SIZE * 2 + 5])(
    'desfazer atravessa %i sussurros invisíveis até a ação anterior',
    async (count) => {
      const s = await setup();
      const davi = await withThirdPlayer(s);
      await s.room.dispatch(s.G, { type: 'token.create', mapId: s.m1, name: 'Goblin', x: 1, y: 1, size: 1, color: '#c9483f', layer: 'tokens', ownerIds: [] });
      await hiddenWhispers(s.t, s.campaignId, s.P.userId, davi, count);
      const fresh = await CampaignRoom.load(s.t.db, s.campaignId, s.t.deps.rng);
      expect(fresh.canUndo(s.G.userId)).toBe(true);
      expect(await fresh.dispatch(s.G, { type: 'undo' })).toMatchObject({ ok: true });
      expect(fresh.state().tokens).toEqual([]);
      const whispers = await s.t.db.select().from(actionLog).where(eq(actionLog.type, 'chat.send'));
      expect(whispers.every((row) => !row.undone)).toBe(true);
    },
    30_000,
  );
  it('um log só de sussurros invisíveis não dá nada para desfazer, em várias páginas', async () => {
    const s = await setup();
    const davi = await withThirdPlayer(s);
    await s.room.dispatch(s.G, { type: 'undo' }); // tira o map.create
    await hiddenWhispers(s.t, s.campaignId, s.P.userId, davi, UNDO_PAGE_SIZE + 3);
    const fresh = await CampaignRoom.load(s.t.db, s.campaignId, s.t.deps.rng);
    expect(fresh.canUndo()).toBe(false);
    expect(await fresh.dispatch(s.G, { type: 'undo' })).toMatchObject({ code: 'nothing_to_undo' });
  }, 30_000);
  it('lê o log por páginas: o custo não cresce com o tamanho dele', async () => {
    const s = await setup();
    await s.t.db.insert(actionLog).values(
      Array.from({ length: UNDO_PAGE_SIZE * 3 }, () => ({ campaignId: s.campaignId, actorId: s.G.userId, via: 'web', type: 'campaign.update', payload: {}, inverse: { op: 'campaign.set', fields: {} } })),
    );
    const client = (s.t.db as unknown as { $client: { query(...args: unknown[]): Promise<{ rows: unknown[] }> } }).$client;
    const query = client.query.bind(client);
    const logRows: number[] = [];
    const spy = vi.spyOn(client, 'query').mockImplementation(async (...args) => {
      const result = await query(...args);
      if (String(args[0]).includes('from "action_log"')) logRows.push(result.rows.length);
      return result;
    });
    await CampaignRoom.load(s.t.db, s.campaignId, s.t.deps.rng);
    spy.mockRestore();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toBeLessThanOrEqual(UNDO_PAGE_SIZE);
  });
  it('sussurros invisíveis em sequência custam poucas consultas', async () => {
    const s = await setup();
    const davi = await withThirdPlayer(s);
    await hiddenWhispers(s.t, s.campaignId, s.P.userId, davi, UNDO_PAGE_SIZE);
    const select = vi.spyOn(s.t.db, 'select');
    await CampaignRoom.load(s.t.db, s.campaignId, s.t.deps.rng);
    const calls = select.mock.calls.length;
    select.mockRestore();
    // 5 to load the room (campaign, members, maps, tokens, chat) + at most 2 log pages with their messages.
    expect(calls).toBeLessThanOrEqual(5 + 4);
  }, 30_000);
});

describe('canUndo exato por mestre', () => {
  it('com dois mestres, o sussurro que um deles não vê só conta para o outro', async () => {
    const { room, G, P, t, campaignId } = await setup();
    await room.dispatch(G, { type: 'undo' }); // log sem nada desfazível
    const [second] = await t.db.insert(users).values({ displayName: 'Davi' }).returning();
    await t.db.insert(campaignMembers).values({ campaignId, userId: second!.id, role: 'gm' });
    await room.memberJoined(second!.id);
    await room.dispatch(G, { type: 'chat.send', text: '/w Lia segredo [[1d20]]' });

    expect(room.canUndo(G.userId)).toBe(true);
    expect(room.canUndo(second!.id)).toBe(false);
    expect(room.canUndo(P.userId)).toBe(false);
    const secondGm = { userId: second!.id, via: 'web' } as const;
    expect(await room.dispatch(secondGm, { type: 'undo' })).toMatchObject({ code: 'nothing_to_undo' });
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ ok: true });
    expect(room.canUndo(G.userId)).toBe(false);
  });
  it('mestre promovido por um desfazer passa a contar', async () => {
    const { room, G, P } = await setup();
    await room.dispatch(G, { type: 'member.setRole', userId: P.userId, role: 'gm' });
    await room.dispatch(P, { type: 'member.setRole', userId: G.userId, role: 'player' });
    expect(room.canUndo(G.userId)).toBe(false);
    await room.dispatch(P, { type: 'undo' }); // G volta a ser mestre
    expect(room.canUndo(G.userId)).toBe(true);
    expect(room.canUndo(P.userId)).toBe(true);
  });
});

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
    expect(await room.dispatch(G, { type: 'chat.send', text: '/w Ninguém oi' })).toMatchObject({ code: 'unknown_member' });
  });
  it('nome com espaço sem aspas é membro desconhecido; com aspas funciona', async () => {
    const { room, G, t, campaignId } = await setup();
    const [paulo] = await t.db.insert(users).values({ displayName: 'Paulo Roberto' }).returning();
    await t.db.insert(campaignMembers).values({ campaignId, userId: paulo!.id, role: 'player' });
    await room.memberJoined(paulo!.id);
    expect(await room.dispatch(G, { type: 'chat.send', text: '/w Paulo Roberto oi' })).toMatchObject({ ok: false, code: 'unknown_member' });
    expect(await room.dispatch(G, { type: 'chat.send', text: '/w "Paulo Roberto" oi' })).toMatchObject({ ok: true });
    expect(room.state().chat.at(-1)).toMatchObject({ kind: 'whisper', recipients: [G.userId, paulo!.id] });
  });
  it('sussurro malformado é bad_whisper', async () => {
    const { room, G } = await setup();
    for (const text of ['/w', '/w Lia', '/w "Lia oi']) {
      expect(await room.dispatch(G, { type: 'chat.send', text })).toMatchObject({ ok: false, code: 'bad_whisper' });
    }
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
  it('comando desconhecido é recusado com seu código e não grava nada', async () => {
    const { room, P, t } = await setup();
    const before = room.state().chat.length;
    const logBefore = (await t.db.select().from(actionLog)).length;
    expect(await room.dispatch(P, { type: 'chat.send', text: '/xyz' })).toMatchObject({ ok: false, code: 'unknown_command' });
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
  it('mensagem de texto fica fora do desfazer: ele vai para a ação anterior', async () => {
    const { room, G, P, m1, t } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1, size: 1, color: '#c9483f', layer: 'tokens', ownerIds: [] });
    await room.dispatch(P, { type: 'chat.send', text: 'olá' });
    await room.dispatch(G, { type: 'chat.send', text: '/w Lia segredo' });
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ ok: true });
    expect(room.state().tokens).toHaveLength(0);
    expect(room.state().chat.every((m) => !m.undone)).toBe(true);
    const sent = await t.db.select().from(actionLog).where(eq(actionLog.type, 'chat.send'));
    expect(sent).toHaveLength(2);
    expect(sent.every((row) => row.inverse === null && !row.undone)).toBe(true);
  });
  it('desfazer passa pelo texto e marca a rolagem anterior', async () => {
    const { room, G, P } = await setup();
    await room.dispatch(P, { type: 'chat.send', text: '/r 1d20' });
    await room.dispatch(P, { type: 'chat.send', text: 'olá' });
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ ok: true });
    expect(room.state().chat.map((m) => m.undone)).toEqual([true, false]);
  });
  it('só mensagens de texto no log: nada para desfazer', async () => {
    const { room, G, P } = await setup();
    await room.dispatch(G, { type: 'undo' }); // tira o map.create
    const r = await room.dispatch(P, { type: 'chat.send', text: 'olá' });
    expect(r.ok && r.events.at(-1)).toEqual({ type: 'undo.available', canUndo: false });
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ code: 'nothing_to_undo' });
  });
  it.each(['/gr 1d20', 'ataco [[1d20]]', '/w Lia olha [[1d20]]'])('rolagem continua desfazível: %s', async (text) => {
    const { room, G } = await setup();
    await room.dispatch(G, { type: 'chat.send', text });
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ ok: true });
    expect(room.state().chat.at(-1)!.undone).toBe(true);
  });
  it('muitas mensagens de texto não escondem a ação anterior', async () => {
    const { room, G, P, t, campaignId, m1 } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1, size: 1, color: '#c9483f', layer: 'tokens', ownerIds: [] });
    await t.db.insert(actionLog).values(
      Array.from({ length: UNDO_PAGE_SIZE * 2 + 1 }, () => ({ campaignId, actorId: P.userId, via: 'web', type: 'chat.send', payload: {}, inverse: null })),
    );
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ ok: true });
    expect(room.state().tokens).toHaveLength(0);
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
    await fresh.dispatch(P, { type: 'chat.send', text: '/w Davi psiu [[1d20]]' });
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
