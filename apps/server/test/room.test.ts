import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import type { Action } from '@rpgai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionLog, uploads } from '../src/db/schema';
import { CampaignRoom, type Actor } from '../src/table/room';
import { RoomRegistry } from '../src/table/registry';
import { seedCampaign } from './helpers';
import { setup } from './room-setup';

describe('CampaignRoom', () => {
  it('mestre cria mapa e token; jogador move o próprio token', async () => {
    const { room, G, P, m1 } = await setup();
    const r = await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Lia', x: 2, y: 3, size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [P.userId] });
    expect(r.ok).toBe(true);
    const tokenId = room.state().tokens[0]!.id;
    expect((await room.dispatch(P, { type: 'token.update', tokenId, x: 4, y: 4 })).ok).toBe(true);
    expect(room.state().tokens[0]).toMatchObject({ x: 4, y: 4 });
    expect(room.state().campaign.defaultMapId).toBe(m1);
  });
  it('jogador não move token alheio, não renomeia, não cria e não desfaz', async () => {
    const { room, G, P, m1 } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1, size: 1, color: '#c9483f', layer: 'tokens', ownerIds: [] });
    const tokenId = room.state().tokens[0]!.id;
    for (const a of [
      { type: 'token.update', tokenId, x: 2, y: 2 },
      { type: 'token.create', mapId: m1, name: 'X', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] },
      { type: 'undo' },
    ] as Action[]) expect(await room.dispatch(P, a)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(room.state().tokens[0]).toMatchObject({ x: 1, y: 1 });
  });
  it('dono não renomeia e não move com movimento travado', async () => {
    const { room, G, P, m1 } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Lia', x: 0, y: 0, size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [P.userId] });
    const tokenId = room.state().tokens[0]!.id;
    expect(await room.dispatch(P, { type: 'token.update', tokenId, name: 'Lia 2' })).toMatchObject({ code: 'forbidden' });
    await room.dispatch(G, { type: 'campaign.update', playersCanMove: false });
    expect(await room.dispatch(P, { type: 'token.update', tokenId, x: 1, y: 0 })).toMatchObject({ code: 'forbidden' });
    expect((await room.dispatch(G, { type: 'token.update', tokenId, x: 1, y: 0 })).ok).toBe(true);
  });
  it('posição fora do grid é inválida', async () => {
    const { room, G, m1 } = await setup();
    expect(await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 10, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] })).toMatchObject({ code: 'invalid' });
  });
  it('desfazer é linear e para quando acaba', async () => {
    const { room, G, m1 } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    const tokenId = room.state().tokens[0]!.id;
    await room.dispatch(G, { type: 'token.update', tokenId, x: 5, y: 5 });
    await room.dispatch(G, { type: 'undo' });
    expect(room.state().tokens[0]).toMatchObject({ x: 0, y: 0 });
    await room.dispatch(G, { type: 'undo' }); // desfaz o token.create
    await room.dispatch(G, { type: 'undo' }); // desfaz o map.create
    expect(room.state().maps).toEqual([]);
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ code: 'nothing_to_undo' });
  });
  it('desfazer a exclusão do mapa traz os tokens com os mesmos ids', async () => {
    const { room, G, m1 } = await setup();
    for (const n of ['A', 'B']) await room.dispatch(G, { type: 'token.create', mapId: m1, name: n, x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    const ids = room.state().tokens.map(t => t.id).sort();
    await room.dispatch(G, { type: 'map.delete', mapId: m1 });
    expect(room.state().tokens).toEqual([]);
    await room.dispatch(G, { type: 'undo' });
    expect(room.state().tokens.map(t => t.id).sort()).toEqual(ids);
    expect(room.state().campaign.defaultMapId).toBe(m1);
  });
  it('dois desfazer simultâneos desfazem uma ação só', async () => {
    const { room, G } = await setup(); // só o map.create no log
    const [a, b] = await Promise.all([room.dispatch(G, { type: 'undo' }), room.dispatch(G, { type: 'undo' })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });
  it('ações simultâneas validam contra o estado da ação anterior', async () => {
    const { room, G, m1 } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    const tokenId = room.state().tokens[0]!.id;
    const [del, upd] = await Promise.all([
      room.dispatch(G, { type: 'token.delete', tokenId }),
      room.dispatch(G, { type: 'token.update', tokenId, x: 1, y: 1 }),
    ]);
    expect(del.ok).toBe(true);
    expect(upd).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('não deixa a campanha sem mestre', async () => {
    const { room, G } = await setup();
    expect(await room.dispatch(G, { type: 'member.setRole', userId: G.userId, role: 'player' })).toMatchObject({ code: 'invalid' });
  });
  it('trocar o mapa do jogador pede snapshot novo para ele', async () => {
    const { room, G, P, m2 } = await setup({ secondMap: true });
    const r = await room.dispatch(G, { type: 'member.setMap', userId: P.userId, mapId: m2 });
    expect(r.ok && r.resnapshot).toEqual([P.userId]);
  });
  it('tudo persiste e o log registra quem e por onde', async () => {
    const { t, room, G, m1, campaignId } = await setup();
    await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 3, y: 3, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    const fresh = await CampaignRoom.load(t.db, campaignId, t.deps.rng);
    expect(fresh.state().tokens[0]).toMatchObject({ name: 'T', x: 3, y: 3 });
    const log = await t.db.select().from(actionLog);
    expect(log.every(l => l.actorId === G.userId && l.via === 'web')).toBe(true);
  });

  // Casos extras: bordas que o brief nomeia.
  it('map.create usa as dimensões do upload, monta imageUrl e o primeiro vira padrão', async () => {
    const { room, m1, m2, keys } = await setup({ secondMap: true });
    expect(room.state().maps.find((m) => m.id === m1)).toMatchObject({ width: 700, height: 700, gridSize: 70, imageKey: keys[0], imageUrl: `/files/${keys[0]}` });
    expect(room.state().campaign.defaultMapId).toBe(m1);
    expect(m2).not.toBe(m1);
  });
  it('upload, mapa, token e membro de outra campanha são not_found', async () => {
    const { t, room, G, m1 } = await setup();
    const other = await seedCampaign(t);
    const foreignKey = `${other.campaignId}/${randomUUID()}.png`;
    await t.db.insert(uploads).values({ key: foreignKey, campaignId: other.campaignId, contentType: 'image/png', sizeBytes: 1, width: 700, height: 700 });
    const otherRoom = await CampaignRoom.load(t.db, other.campaignId, t.deps.rng);
    const og: Actor = { userId: other.gm.userId, via: 'web' };
    await otherRoom.dispatch(og, { type: 'map.create', name: 'Outro', imageKey: foreignKey });
    const foreignMap = otherRoom.state().maps[0]!.id;
    await otherRoom.dispatch(og, { type: 'token.create', mapId: foreignMap, name: 'X', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    const foreignToken = otherRoom.state().tokens[0]!.id;
    const stranger = randomUUID();
    for (const a of [
      { type: 'map.create', name: 'M', imageKey: foreignKey },
      { type: 'map.delete', mapId: foreignMap },
      { type: 'token.create', mapId: foreignMap, name: 'X', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] },
      { type: 'token.create', mapId: m1, name: 'X', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [], imageKey: foreignKey },
      { type: 'token.update', tokenId: foreignToken, x: 1, y: 1 },
      { type: 'member.setRole', userId: stranger, role: 'gm' },
      { type: 'member.setMap', userId: G.userId, mapId: foreignMap },
    ] as Action[]) expect(await room.dispatch(G, a)).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('ação recusada não grava nada nem devolve eventos', async () => {
    const { t, room, G, P, m1 } = await setup();
    const before = await t.db.select().from(actionLog);
    const r = await room.dispatch(P, { type: 'map.delete', mapId: m1 });
    expect(r).toEqual({ ok: false, code: 'forbidden', message: expect.any(String) });
    expect(await room.dispatch(G, { type: 'campaign.update' })).toMatchObject({ code: 'invalid' });
    expect(await t.db.select().from(actionLog)).toEqual(before);
  });
  it('não-membro é recusado', async () => {
    const { room, m1 } = await setup();
    expect(await room.dispatch({ userId: randomUUID(), via: 'api' }, { type: 'map.delete', mapId: m1 })).toMatchObject({ code: 'forbidden' });
  });
  it('eventos terminam com undo.available e canUndo acompanha o log', async () => {
    const { room, G, m1 } = await setup();
    expect(room.canUndo()).toBe(true);
    const r = await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['token.upserted', 'undo.available']);
    await room.dispatch(G, { type: 'undo' });
    const last = await room.dispatch(G, { type: 'undo' });
    expect(last.ok && last.events.map((e) => e.type)).toContain('map.removed');
    expect(last.ok && last.events.at(-1)).toEqual({ type: 'undo.available', canUndo: false });
    expect(room.canUndo()).toBe(false);
  });
  it('excluir mapa limpa padrão e mapa atual dos membros; desfazer devolve tudo', async () => {
    const { room, G, P, m1, m2 } = await setup({ secondMap: true });
    await room.dispatch(G, { type: 'member.setMap', userId: P.userId, mapId: m2 });
    const del = await room.dispatch(G, { type: 'map.delete', mapId: m2 });
    expect(del.ok && del.resnapshot).toEqual([P.userId]); // volta para o padrão m1
    expect(room.state().members.find((m) => m.userId === P.userId)!.currentMapId).toBeNull();
    await room.dispatch(G, { type: 'undo' });
    expect(room.state().members.find((m) => m.userId === P.userId)!.currentMapId).toBe(m2);
    await room.dispatch(G, { type: 'map.delete', mapId: m1 });
    expect(room.state().campaign.defaultMapId).toBeNull();
  });
  it('map.setDefault pede snapshot de quem segue o padrão', async () => {
    const { room, G, P, m2 } = await setup({ secondMap: true });
    const r = await room.dispatch(G, { type: 'map.setDefault', mapId: m2 });
    expect(r.ok && r.resnapshot).toEqual([P.userId]);
    expect(room.state().campaign.defaultMapId).toBe(m2);
  });
  it('remover membro pede snapshot dele, desfazer devolve; último mestre não sai', async () => {
    const { room, G, P } = await setup();
    expect(await room.dispatch(G, { type: 'member.remove', userId: G.userId })).toMatchObject({ code: 'invalid' });
    const r = await room.dispatch(G, { type: 'member.remove', userId: P.userId });
    expect(r.ok && r.resnapshot).toEqual([P.userId]);
    expect(room.isMember(P.userId)).toBe(false);
    await room.dispatch(G, { type: 'undo' });
    expect(room.isMember(P.userId)).toBe(true);
    expect(room.state().members.find((m) => m.userId === P.userId)).toMatchObject({ displayName: 'Lia', role: 'player' });
  });
  it('promover jogador a mestre pede snapshot dele', async () => {
    const { room, G, P } = await setup();
    const r = await room.dispatch(G, { type: 'member.setRole', userId: P.userId, role: 'gm' });
    expect(r.ok && r.resnapshot).toEqual([P.userId]);
    expect((await room.dispatch(G, { type: 'member.setRole', userId: G.userId, role: 'player' })).ok).toBe(true);
  });
  it('registry carrega a sala uma vez', async () => {
    const { t, campaignId } = await setup();
    const reg = new RoomRegistry(t.db, t.deps.rng);
    const [a, b] = await Promise.all([reg.get(campaignId), reg.get(campaignId)]);
    expect(a).toBe(b);
    expect(a.state().maps).toHaveLength(1);
  });
});

describe('fila da sala', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('volta a andar depois de uma chamada ao banco que falha ou estoura o tempo', async () => {
    const { t, room, G } = await setup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let timeOut!: (err: Error) => void;
    const transaction = vi
      .spyOn(t.db, 'transaction')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (timeOut = reject)));
    const stuck = room.dispatch(G, { type: 'chat.send', text: 'travou' });
    let nextDone = false;
    const next = room.dispatch(G, { type: 'chat.send', text: 'depois' }).finally(() => (nextDone = true));
    await vi.waitFor(() => expect(transaction).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nextDone).toBe(false);

    timeOut(new Error('Query read timeout'));
    expect(await stuck).toMatchObject({ ok: false, code: 'internal' });
    expect(await next).toMatchObject({ ok: true });
    expect(room.state().chat.map((m) => m.text)).toEqual(['depois']);
    expect(logged).toHaveBeenCalled();
  });
  it('ação já gravada não falha se a leitura do desfazer falhar depois', async () => {
    const { t, room, G } = await setup();
    expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ ok: true });
    expect(room.canUndo()).toBe(false);

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const commit = t.db.transaction.bind(t.db);
    vi.spyOn(t.db, 'transaction').mockImplementationOnce(async (work) => {
      const committed = await commit(work);
      // Only the read that follows the commit fails.
      vi.spyOn(t.db, 'select').mockImplementationOnce(() => {
        throw new Error('Query read timeout');
      });
      return committed;
    });
    const result = await room.dispatch(G, { type: 'chat.send', text: 'gravada' });

    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: 'chat.added', message: { text: 'gravada' } },
        { type: 'undo.available', canUndo: false },
      ],
    });
    expect(room.state().chat.map((m) => m.text)).toEqual(['gravada']);
    expect(room.canUndo()).toBe(false); // previous value kept
    expect(logged).toHaveBeenCalled();

    expect(await room.dispatch(G, { type: 'chat.send', text: 'depois' })).toMatchObject({ ok: true });
    expect(room.state().chat.map((m) => m.text)).toEqual(['gravada', 'depois']);
    expect(room.canUndo()).toBe(true); // the next successful read corrects it
  });
  it('memberJoined que falha não prende a fila', async () => {
    const { t, room, G } = await setup();
    vi.spyOn(t.db, 'select').mockImplementationOnce(() => {
      throw new Error('Query read timeout');
    });
    await expect(room.memberJoined(G.userId)).rejects.toThrow('Query read timeout');
    expect(await room.dispatch(G, { type: 'chat.send', text: 'sigo aqui' })).toMatchObject({ ok: true });
  });
});

describe('registro do desfazer', () => {
  it('grava quem desfez, por onde e quando, sem tocar em quem fez', async () => {
    const { t, room, G, P, m1 } = await setup();
    await room.dispatch(G, { type: 'member.setRole', userId: P.userId, role: 'gm' });
    await room.dispatch(P, { type: 'token.create', mapId: m1, name: 'T', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
    const before = Date.now();
    await room.dispatch({ userId: G.userId, via: 'api' }, { type: 'undo' });
    const rows = await t.db.select().from(actionLog).orderBy(desc(actionLog.id));
    expect(rows[0]).toMatchObject({ type: 'token.create', actorId: P.userId, via: 'web', undone: true, undoneBy: G.userId, undoneVia: 'api' });
    expect(rows[0]!.undoneAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(rows[1]).toMatchObject({ undone: false, undoneBy: null, undoneVia: null, undoneAt: null });
  });
});

describe('token que o jogador não vê', () => {
  const owned = async (s: Awaited<ReturnType<typeof setup>>, mapId: string) => {
    await s.room.dispatch(s.G, { type: 'token.create', mapId, name: 'Lia', x: 0, y: 0, size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [s.P.userId] });
    return s.room.state().tokens.at(-1)!;
  };

  it('dono não move o próprio token depois que ele vai para a camada do mestre', async () => {
    const s = await setup();
    const token = await owned(s, s.m1);
    await s.room.dispatch(s.G, { type: 'token.update', tokenId: token.id, layer: 'gm' });
    expect(await s.room.dispatch(s.P, { type: 'token.update', tokenId: token.id, x: 1, y: 1 })).toMatchObject({ ok: false, code: 'not_found' });
    expect(s.room.state().tokens[0]).toMatchObject({ x: 0, y: 0 });
  });
  it('dono não move o próprio token num mapa em que não está', async () => {
    const s = await setup({ secondMap: true });
    const token = await owned(s, s.m2); // o jogador segue no mapa padrão, m1
    expect(await s.room.dispatch(s.P, { type: 'token.update', tokenId: token.id, x: 1, y: 1 })).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('a resposta é igual à de um token que não existe, antes das outras checagens', async () => {
    const s = await setup();
    const token = await owned(s, s.m1);
    await s.room.dispatch(s.G, { type: 'token.update', tokenId: token.id, layer: 'gm' });
    await s.room.dispatch(s.G, { type: 'campaign.update', playersCanMove: false });
    const missing = await s.room.dispatch(s.P, { type: 'token.update', tokenId: randomUUID(), x: 1, y: 1 });
    for (const attempt of [
      { x: 1, y: 1 }, // sem permissão de mover
      { x: 99, y: 99 }, // fora do grid
      { name: 'Outro' }, // campo que o jogador não altera
      {}, // nada para alterar
    ]) {
      expect(await s.room.dispatch(s.P, { type: 'token.update', tokenId: token.id, ...attempt })).toEqual(missing);
    }
  });
  it('o mestre segue movendo tokens de qualquer camada e mapa', async () => {
    const s = await setup({ secondMap: true });
    const token = await owned(s, s.m2);
    await s.room.dispatch(s.G, { type: 'token.update', tokenId: token.id, layer: 'gm' });
    expect((await s.room.dispatch(s.G, { type: 'token.update', tokenId: token.id, x: 1, y: 1 })).ok).toBe(true);
  });
});
