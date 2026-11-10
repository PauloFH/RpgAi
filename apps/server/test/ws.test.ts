import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { MapInfo } from '@rpgai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionLog, campaignMembers } from '../src/db/schema';
import { CampaignRoom } from '../src/table/room';
import { createTestApp, login, seedCampaign } from './helpers';
import { closeCode, connect, wsSetup } from './ws-setup';

afterEach(() => {
  vi.restoreAllMocks();
});

const isSnapshot = (m: { t: string }) => m.t === 'snapshot';

describe('conexão em tempo real', () => {
  it('recusa sem login e quem não é membro', async () => {
    const { t, url, campaignId } = await wsSetup();
    expect(await closeCode(url, '', campaignId)).toBe(4401);
    const other = await login(t.app, 'Intruso');
    expect(await closeCode(url, other.cookie, campaignId)).toBe(4403);
  });
  it('ação do mestre chega aos dois; erro só a quem mandou', async () => {
    const { gm, pl, m1 } = await wsSetup();
    await gm.next(m => m.t === 'snapshot'); await pl.next(m => m.t === 'snapshot');
    gm.send({ t: 'cmd', id: 'c1', action: { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1 } });
    expect(await gm.next(m => m.t === 'ack')).toEqual({ t: 'ack', id: 'c1' });
    expect(await pl.next(m => m.t === 'event')).toMatchObject({ event: { type: 'token.upserted', token: { name: 'Goblin' } } });
    pl.send({ t: 'cmd', id: 'c2', action: { type: 'undo' } });
    expect(await pl.next(m => m.t === 'error')).toMatchObject({ id: 'c2', code: 'forbidden' });
  });
  it('lixo não derruba a conexão', async () => {
    const { pl } = await wsSetup();
    pl.raw('isso não é json');
    expect(await pl.next(m => m.t === 'error')).toMatchObject({ id: null, code: 'invalid' });
    pl.send({ t: 'cmd', id: 'c3', action: { type: 'chat.send', text: 'ainda aqui' } });
    expect(await pl.next(m => m.t === 'ack')).toEqual({ t: 'ack', id: 'c3' });
  });
  it('token escondido não chega e token que vai para a camada do mestre some', async () => {
    const { gm, pl, m1 } = await wsSetup();
    gm.send({ t: 'cmd', id: 'a', action: { type: 'token.create', mapId: m1, name: 'Emboscada', x: 2, y: 2, layer: 'gm' } });
    gm.send({ t: 'cmd', id: 'b', action: { type: 'token.create', mapId: m1, name: 'Visível', x: 3, y: 3 } });
    // The hidden token, created first, produced no message at all.
    const ev = await pl.next(m => m.t === 'event');
    expect(ev.event).toMatchObject({ type: 'token.upserted', token: { name: 'Visível' } });
    gm.send({ t: 'cmd', id: 'c', action: { type: 'token.update', tokenId: ev.event.token.id, layer: 'gm' } });
    expect(await pl.next(m => m.t === 'event')).toEqual({ t: 'event', event: { type: 'token.removed', tokenId: ev.event.token.id } });
  });
  it('mudar o mapa do jogador manda snapshot novo', async () => {
    const { gm, pl, m2, player } = await wsSetup({ secondMap: true });
    await pl.next(m => m.t === 'snapshot');
    gm.send({ t: 'cmd', id: 'm', action: { type: 'member.setMap', userId: player.userId, mapId: m2 } });
    const snap = await pl.next(m => m.t === 'snapshot');
    expect(snap.state.maps.map((x: MapInfo) => x.id)).toEqual([m2]);
  });
  it('quem volta depois de cair vê a mesa atual', async () => {
    const { gm, pl, m1, reconnectPlayer } = await wsSetup();
    gm.send({ t: 'cmd', id: 'a', action: { type: 'token.create', mapId: m1, name: 'Lia', x: 0, y: 0 } });
    const created = await pl.next(m => m.t === 'event');
    pl.close();
    gm.send({ t: 'cmd', id: 'b', action: { type: 'token.update', tokenId: created.event.token.id, x: 6, y: 6 } });
    await gm.next(m => m.t === 'ack' && m.id === 'b');
    const back = await reconnectPlayer();
    const snap = await back.next(m => m.t === 'snapshot');
    expect(snap.state.tokens).toEqual([expect.objectContaining({ x: 6, y: 6 })]);
  });
  it('dono recebe not_found ao mover token que não vê: camada do mestre ou outro mapa', async () => {
    const { gm, pl, m1, m2, player } = await wsSetup({ secondMap: true });
    const create = (id: string, mapId: string) => ({ t: 'cmd', id, action: { type: 'token.create', mapId, name: id, x: 0, y: 0, ownerIds: [player.userId] } });
    gm.send(create('hidden', m1));
    const hidden = (await pl.next((m) => m.t === 'event' && m.event.type === 'token.upserted')).event.token;
    gm.send({ t: 'cmd', id: 'layer', action: { type: 'token.update', tokenId: hidden.id, layer: 'gm' } });
    await pl.next((m) => m.t === 'event' && m.event.type === 'token.removed');
    pl.send({ t: 'cmd', id: 'move1', action: { type: 'token.update', tokenId: hidden.id, x: 1, y: 1 } });
    expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: 'move1', code: 'not_found' });

    gm.send(create('elsewhere', m2));
    const created = await gm.next((m) => m.t === 'event' && m.event.type === 'token.upserted' && m.event.token.name === 'elsewhere');
    pl.send({ t: 'cmd', id: 'move2', action: { type: 'token.update', tokenId: created.event.token.id, x: 1, y: 1 } });
    expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: 'move2', code: 'not_found' });
  });
  it('membro removido é desconectado', async () => {
    const { gm, pl, player } = await wsSetup();
    gm.send({ t: 'cmd', id: 'r', action: { type: 'member.remove', userId: player.userId } });
    expect(await pl.closed()).toBe(4403);
  });
});

describe('o que o jogador não pode saber', () => {
  type Client = Awaited<ReturnType<typeof connect>>;
  const cmd = (id: string, action: object) => ({ t: 'cmd', id, action });
  const isChat = (m: { t: string; event?: { type: string } }) => m.t === 'event' && m.event?.type === 'chat.added';

  /** All `client` receives before a public message `from` sends now, minus acks and undo state. */
  const untilMarker = async (client: Client, from: Client, marker: string) => {
    from.send(cmd(marker, { type: 'chat.send', text: marker }));
    const seen: unknown[] = [];
    for (;;) {
      const m = await client.next();
      if (isChat(m) && m.event.message.text === marker) return seen;
      if (m.t !== 'ack' && m.event?.type !== 'undo.available') seen.push(m);
    }
  };
  const addThird = async (s: Awaited<ReturnType<typeof wsSetup>>) => {
    const third = await login(s.t.app, 'Davi');
    const invite = await s.t.app.inject({ method: 'POST', url: `/api/campaigns/${s.campaignId}/invites`, headers: { cookie: s.gmSession.cookie } });
    const { token } = invite.json() as { token: string };
    await s.t.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: third.cookie } });
    return { third, client: await connect(s.url, third.cookie, s.campaignId) };
  };

  it('token escondido não manda nada ao ser criado, movido, excluído ou trazido de volta', async () => {
    const { gm, pl, m1 } = await wsSetup();
    await pl.next(isSnapshot);
    gm.send(cmd('c', { type: 'token.create', mapId: m1, name: 'Emboscada', x: 1, y: 1, layer: 'gm' }));
    const created = await gm.next((m) => m.t === 'event' && m.event.type === 'token.upserted');
    const tokenId = created.event.token.id;
    gm.send(cmd('m', { type: 'token.update', tokenId, x: 2, y: 2 }));
    gm.send(cmd('d', { type: 'token.delete', tokenId }));
    gm.send(cmd('u', { type: 'undo' }));
    expect(await untilMarker(pl, gm, 'fim')).toEqual([]);
  });
  it('token visível que vai para a camada do mestre vira token.removed uma única vez', async () => {
    const { gm, pl, m1 } = await wsSetup();
    await pl.next(isSnapshot);
    gm.send(cmd('c', { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1 }));
    const { event } = await pl.next((m) => m.t === 'event' && m.event.type === 'token.upserted');
    gm.send(cmd('h', { type: 'token.update', tokenId: event.token.id, layer: 'gm' }));
    gm.send(cmd('m', { type: 'token.update', tokenId: event.token.id, x: 3, y: 3 }));
    gm.send(cmd('d', { type: 'token.delete', tokenId: event.token.id }));
    expect(await untilMarker(pl, gm, 'fim')).toEqual([{ t: 'event', event: { type: 'token.removed', tokenId: event.token.id } }]);
  });
  it('quem conecta depois só é avisado sobre o que veio no snapshot dele', async () => {
    const { gm, m1, reconnectPlayer, pl } = await wsSetup();
    gm.send(cmd('c', { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1 }));
    const { event } = await pl.next((m) => m.t === 'event' && m.event.type === 'token.upserted');
    gm.send(cmd('s', { type: 'token.create', mapId: m1, name: 'Oculto', x: 1, y: 1, layer: 'gm' }));
    const hidden = await gm.next((m) => m.t === 'event' && m.event.type === 'token.upserted' && m.event.token.name === 'Oculto');
    const tab = await reconnectPlayer();
    await tab.next(isSnapshot);
    gm.send(cmd('d1', { type: 'token.delete', tokenId: hidden.event.token.id }));
    gm.send(cmd('d2', { type: 'token.delete', tokenId: event.token.id }));
    expect(await untilMarker(tab, gm, 'fim')).toEqual([{ t: 'event', event: { type: 'token.removed', tokenId: event.token.id } }]);
  });
  it('mestre rebaixado pelo socket deixa de receber o que é escondido', async () => {
    const { gm, pl, m1, m2, gmSession, player } = await wsSetup({ secondMap: true });
    await Promise.all([gm.next(isSnapshot), pl.next(isSnapshot)]);
    gm.send(cmd('s', { type: 'token.create', mapId: m1, name: 'Oculto', x: 1, y: 1, layer: 'gm' }));
    await gm.next((m) => m.t === 'ack' && m.id === 's');
    gm.send(cmd('p', { type: 'member.setRole', userId: player.userId, role: 'gm' }));
    await pl.next((m) => m.t === 'snapshot' && m.state.me.role === 'gm');
    pl.send(cmd('d', { type: 'member.setRole', userId: gmSession.userId, role: 'player' }));
    const snap = await gm.next(isSnapshot);
    expect(snap.state.me).toEqual({ userId: gmSession.userId, role: 'player' });
    expect(snap.state.canUndo).toBe(false);
    expect(snap.state.tokens).toEqual([]);
    expect(snap.state.maps.map((x: MapInfo) => x.id)).toEqual([m1]);
    pl.send(cmd('h', { type: 'token.create', mapId: m1, name: 'Outro oculto', x: 2, y: 2, layer: 'gm' }));
    pl.send(cmd('o', { type: 'token.create', mapId: m2, name: 'Em outro mapa', x: 2, y: 2 }));
    expect(await untilMarker(gm, pl, 'fim')).toEqual([]);
    gm.send(cmd('u', { type: 'undo' }));
    expect(await gm.next((m) => m.t === 'error')).toMatchObject({ id: 'u', code: 'forbidden' });
  });
  it('depois de trocar de mapa, nada do mapa antigo chega', async () => {
    const { gm, pl, m1, m2, player } = await wsSetup({ secondMap: true });
    await pl.next(isSnapshot);
    gm.send(cmd('old', { type: 'token.create', mapId: m1, name: 'Antigo', x: 1, y: 1 }));
    const { event } = await pl.next((m) => m.t === 'event' && m.event.type === 'token.upserted');
    gm.send(cmd('move', { type: 'member.setMap', userId: player.userId, mapId: m2 }));
    const snap = await pl.next(isSnapshot);
    expect(snap.state.tokens).toEqual([]);
    gm.send(cmd('a', { type: 'token.update', tokenId: event.token.id, x: 5, y: 5 }));
    gm.send(cmd('b', { type: 'token.create', mapId: m1, name: 'Novo no antigo', x: 2, y: 2 }));
    gm.send(cmd('c', { type: 'token.delete', tokenId: event.token.id }));
    gm.send(cmd('r', { type: 'map.update', mapId: m1, name: 'Renomeado' }));
    expect(await untilMarker(pl, gm, 'meio')).toEqual([]);
    gm.send(cmd('d', { type: 'token.create', mapId: m2, name: 'Aqui', x: 1, y: 1 }));
    expect(await untilMarker(pl, gm, 'fim')).toEqual([{ t: 'event', event: { type: 'token.upserted', token: expect.objectContaining({ name: 'Aqui' }) } }]);
  });
  it('sussurro e rolagem secreta só chegam a quem pode ver', async () => {
    const s = await wsSetup();
    const { gm, pl, player, gmSession } = s;
    const { client: davi, third } = await addThird(s);
    await Promise.all([gm.next(isSnapshot), pl.next(isSnapshot), davi.next(isSnapshot)]);

    gm.send(cmd('w', { type: 'chat.send', text: '/w Lia segredo' }));
    await gm.next((m) => m.t === 'ack' && m.id === 'w');
    pl.send(cmd('g', { type: 'chat.send', text: '/gr 1d20' }));
    pl.send(cmd('fim', { type: 'chat.send', text: 'fim' }));
    const chatBeforeEnd = async (client: Client) => {
      const messages = [];
      for (;;) {
        const { event } = await client.next(isChat);
        if (event.message.text === 'fim') return messages;
        messages.push(event.message);
      }
    };
    const [toGm, toPlayer, toThird] = await Promise.all([chatBeforeEnd(gm), chatBeforeEnd(pl), chatBeforeEnd(davi)]);
    const expected = [
      { kind: 'whisper', text: 'segredo', recipients: [gmSession.userId, player.userId] },
      { kind: 'roll', secret: true },
    ];
    expect(toGm).toMatchObject(expected);
    expect(toPlayer).toMatchObject(expected);
    expect(toThird).toEqual([]);

    const snap = await (await connect(s.url, third.cookie, s.campaignId)).next(isSnapshot);
    expect(snap.state.chat.map((m: { text: string }) => m.text)).toEqual(['fim']);
  });
  it('membro que muda de mapa não revela o mapa aos outros jogadores', async () => {
    const s = await wsSetup({ secondMap: true });
    const { gm, pl, m2, player } = s;
    const { client: davi, third } = await addThird(s);
    await Promise.all([gm.next(isSnapshot), pl.next(isSnapshot), davi.next(isSnapshot)]);
    gm.send(cmd('m', { type: 'member.setMap', userId: player.userId, mapId: m2 }));
    const toGm = await gm.next((m) => m.t === 'event' && m.event.type === 'member.upserted' && m.event.member.userId === player.userId);
    expect(toGm.event.member.currentMapId).toBe(m2);
    const toOther = await davi.next((m) => m.t === 'event' && m.event.type === 'member.upserted');
    expect(toOther.event.member).toMatchObject({ userId: player.userId, currentMapId: null });
    const own = await pl.next(isSnapshot);
    const mapOfPlayer = (state: { members: Array<{ userId: string; currentMapId: string | null }> }) =>
      state.members.find((m) => m.userId === player.userId)!.currentMapId;
    expect(mapOfPlayer(own.state)).toBe(m2);
    const later = await (await connect(s.url, third.cookie, s.campaignId)).next(isSnapshot);
    expect(mapOfPlayer(later.state)).toBeNull();
  });
});

describe('desfazer com dois mestres', () => {
  it('cada mestre recebe o próprio canUndo, no snapshot e nos eventos', async () => {
    const { t, url, gm, pl, campaignId, gmSession } = await wsSetup();
    await Promise.all([gm.next(isSnapshot), pl.next(isSnapshot)]);
    gm.send({ t: 'cmd', id: 'u', action: { type: 'undo' } }); // tira o map.create: nada a desfazer
    await gm.next((m) => m.t === 'event' && m.event.type === 'undo.available' && m.event.canUndo === false);

    // Written directly so that no action enters the log: only the whisper below will be there.
    const session = await login(t.app, 'Davi');
    await t.db.insert(campaignMembers).values({ campaignId, userId: session.userId, role: 'gm' });
    const second = await connect(url, session.cookie, campaignId);
    expect(await second.next(isSnapshot)).toMatchObject({ state: { me: { role: 'gm' }, canUndo: false } });

    gm.send({ t: 'cmd', id: 'w', action: { type: 'chat.send', text: '/w Lia segredo [[1d20]]' } });
    const undoState = (m: { t: string; event?: { type: string } }) => m.t === 'event' && m.event?.type === 'undo.available';
    expect((await gm.next(undoState)).event.canUndo).toBe(true);
    expect((await second.next(undoState)).event.canUndo).toBe(false);

    const snapshotOf = async (cookie: string) => (await (await connect(url, cookie, campaignId)).next(isSnapshot)).state.canUndo;
    expect(await snapshotOf(gmSession.cookie)).toBe(true);
    expect(await snapshotOf(session.cookie)).toBe(false);

    second.send({ t: 'cmd', id: 'x', action: { type: 'undo' } });
    expect(await second.next((m) => m.t === 'error')).toMatchObject({ id: 'x', code: 'nothing_to_undo' });
  });
});

describe('recusa de conexão', () => {
  it('fecha com 4403 para id malformado, ausente ou de campanha que não existe', async () => {
    const { url, gmSession } = await wsSetup();
    expect(await closeCode(url, gmSession.cookie, 'nao-e-uuid')).toBe(4403);
    expect(await closeCode(url, gmSession.cookie, "'; drop table users; --")).toBe(4403);
    expect(await closeCode(url, gmSession.cookie, '')).toBe(4403);
    expect(await closeCode(url, gmSession.cookie, randomUUID())).toBe(4403);
  });
  it('quem não é membro não carrega a sala na memória', async () => {
    const { t, url, campaignId } = await wsSetup();
    const load = vi.spyOn(CampaignRoom, 'load');
    const { id: otherCampaign } = (
      await t.app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers: { cookie: (await login(t.app, 'Dona')).cookie },
        payload: { name: 'Outra', rulesVersion: '2024' },
      })
    ).json() as { id: string };
    const intruder = await login(t.app, 'Intruso');
    expect(await closeCode(url, intruder.cookie, otherCampaign)).toBe(4403);
    expect(await closeCode(url, intruder.cookie, campaignId)).toBe(4403);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('mensagens recebidas', () => {
  it('comandos enviados logo ao abrir não se perdem e seguem a ordem de chegada', async () => {
    const { url, campaignId, player } = await wsSetup();
    const tab = await connect(url, player.cookie, campaignId);
    for (const id of ['1', '2', '3']) tab.send({ t: 'cmd', id, action: { type: 'chat.send', text: `msg ${id}` } });
    expect(await tab.next(isSnapshot)).toMatchObject({ t: 'snapshot' });
    const acks: string[] = [];
    const texts: string[] = [];
    while (texts.length < 3) {
      const m = await tab.next((m) => m.t === 'ack' || m.t === 'event');
      if (m.t === 'ack') acks.push(m.id);
      else texts.push(m.event.message.text);
    }
    expect(acks).toEqual(['1', '2', '3']);
    expect(texts).toEqual(['msg 1', 'msg 2', 'msg 3']);
  });
  it('nome só de espaços é recusado pelo socket, e nome com espaços nas pontas é aparado', async () => {
    const { gm, m1 } = await wsSetup();
    await gm.next(isSnapshot);
    gm.raw(JSON.stringify({ t: 'cmd', id: 'a', action: { type: 'token.create', mapId: m1, name: '   ', x: 0, y: 0 } }));
    expect(await gm.next((m) => m.t === 'error')).toMatchObject({ id: 'a', code: 'invalid' });
    gm.raw(JSON.stringify({ t: 'cmd', id: 'b', action: { type: 'map.update', mapId: m1, name: '   ' } }));
    expect(await gm.next((m) => m.t === 'error')).toMatchObject({ id: 'b', code: 'invalid' });
    gm.raw(JSON.stringify({ t: 'cmd', id: 'c', action: { type: 'campaign.update', name: ' \t ' } }));
    expect(await gm.next((m) => m.t === 'error')).toMatchObject({ id: 'c', code: 'invalid' });
    gm.raw(JSON.stringify({ t: 'cmd', id: 'd', action: { type: 'token.create', mapId: m1, name: '  Lia  ', x: 0, y: 0 } }));
    expect(await gm.next((m) => m.t === 'event' && m.event.type === 'token.upserted')).toMatchObject({ event: { token: { name: 'Lia' } } });
  });
  it('recusa como inválido o que não é comando, devolvendo o id quando dá para ler', async () => {
    const { pl } = await wsSetup();
    for (const garbage of ['null', '[]', '12', '{"t":"ping"}', '{"t":"cmd","id":7,"action":{"type":"undo"}}']) {
      pl.raw(garbage);
      expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: null, code: 'invalid' });
    }
    pl.raw(Buffer.from([1, 2, 3]));
    expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: null, code: 'invalid' });
    pl.send({ t: 'cmd', id: 'x', action: { type: 'token.create' } });
    expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: 'x', code: 'invalid' });
    pl.send({ t: 'cmd', id: 'y', action: { type: 'nao-existe' } });
    expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: 'y', code: 'invalid' });
    pl.send({ t: 'cmd', id: 'z', action: { type: 'chat.send', text: 'ainda aqui' } });
    expect(await pl.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'z' });
  });
  it('mensagem acima de 64 KiB fecha só aquela conexão', async () => {
    const { gm, pl } = await wsSetup();
    pl.raw('x'.repeat(64 * 1024 + 1));
    expect(await pl.closed()).toBeGreaterThanOrEqual(1006);
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'sigo aqui' } });
    expect(await gm.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'a' });
  });
  it('exceção ao tratar uma mensagem responde internal e não afeta nenhuma conexão', async () => {
    const { gm, pl } = await wsSetup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await pl.next(isSnapshot);
    vi.spyOn(CampaignRoom.prototype, 'dispatch').mockRejectedValueOnce(new Error('boom'));
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'vai falhar' } });
    expect(await gm.next((m) => m.t === 'error')).toMatchObject({ id: 'a', code: 'internal' });
    expect(logged).toHaveBeenCalled();
    gm.send({ t: 'cmd', id: 'b', action: { type: 'chat.send', text: 'agora vai' } });
    expect(await gm.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'b' });
    expect(await pl.next((m) => m.t === 'event')).toMatchObject({ event: { type: 'chat.added', message: { text: 'agora vai' } } });
  });
  it('grava a ação com via web', async () => {
    const { t, gm, gmSession, campaignId } = await wsSetup();
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'oi' } });
    await gm.next((m) => m.t === 'ack');
    const [row] = await t.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.campaignId, campaignId))
      .orderBy(desc(actionLog.id))
      .limit(1);
    expect(row).toMatchObject({ actorId: gmSession.userId, via: 'web', type: 'chat.send' });
  });
});

describe('o que cada conexão recebe', () => {
  it('quem mandou recebe o ack antes dos eventos', async () => {
    const { gm } = await wsSetup();
    await gm.next(isSnapshot);
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'oi' } });
    expect(await gm.next()).toEqual({ t: 'ack', id: 'a' });
    expect(await gm.next()).toMatchObject({ t: 'event', event: { type: 'chat.added' } });
    expect(await gm.next()).toMatchObject({ t: 'event', event: { type: 'undo.available', canUndo: true } });
  });
  it('todas as abas da mesma pessoa recebem; aba fechada não atrapalha', async () => {
    const { gm, pl, url, campaignId, player } = await wsSetup();
    const tab = await connect(url, player.cookie, campaignId);
    await tab.next(isSnapshot);
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'para as abas' } });
    const added = { t: 'event', event: { type: 'chat.added', message: { text: 'para as abas' } } };
    expect(await pl.next((m) => m.t === 'event')).toMatchObject(added);
    expect(await tab.next((m) => m.t === 'event')).toMatchObject(added);
    tab.close();
    await tab.closed();
    gm.send({ t: 'cmd', id: 'b', action: { type: 'chat.send', text: 'só uma aba' } });
    expect(await pl.next((m) => m.t === 'event')).toMatchObject({ event: { message: { text: 'só uma aba' } } });
  });
  it('não vaza para conexões de outra campanha', async () => {
    const { t, url, gm, gmSession } = await wsSetup();
    const { id: other } = (
      await t.app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers: { cookie: gmSession.cookie },
        payload: { name: 'Outra', rulesVersion: '2014' },
      })
    ).json() as { id: string };
    const there = await connect(url, gmSession.cookie, other);
    await there.next(isSnapshot);
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'aqui' } });
    await gm.next((m) => m.t === 'ack');
    there.send({ t: 'cmd', id: 'b', action: { type: 'chat.send', text: 'lá' } });
    expect(await there.next()).toEqual({ t: 'ack', id: 'b' });
    expect(await there.next()).toMatchObject({ event: { type: 'chat.added', message: { text: 'lá' } } });
  });
  it('quem está em resnapshot recebe um único snapshot no lugar dos eventos, com a visão nova', async () => {
    const { gm, pl, player, m1 } = await wsSetup();
    await pl.next(isSnapshot);
    gm.send({ t: 'cmd', id: 'h', action: { type: 'token.create', mapId: m1, name: 'Escondido', x: 1, y: 1, layer: 'gm' } });
    await gm.next((m) => m.t === 'ack' && m.id === 'h');
    gm.send({ t: 'cmd', id: 'p', action: { type: 'member.setRole', userId: player.userId, role: 'gm' } });
    const snap = await pl.next();
    expect(snap).toMatchObject({ t: 'snapshot', state: { me: { role: 'gm' }, canUndo: true } });
    expect(snap.state.tokens).toEqual([expect.objectContaining({ name: 'Escondido' })]);
    gm.send({ t: 'cmd', id: 'o', action: { type: 'chat.send', text: 'depois' } });
    expect(await pl.next()).toMatchObject({ t: 'event', event: { type: 'chat.added' } });
    // The viewer used for events is the new one: undo.available only goes to a GM.
    expect(await pl.next()).toMatchObject({ t: 'event', event: { type: 'undo.available' } });
  });
  it('quem conecta durante uma ação não recebe de novo o que já veio no snapshot', async () => {
    const { gm, url, campaignId, player } = await wsSetup();
    await gm.next(isSnapshot);
    // Holds the action in the gap a real dispatch has: state changed, result not published yet.
    let applied!: () => void;
    const stateChanged = new Promise<void>((resolve) => (applied = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const proto = CampaignRoom.prototype as unknown as { run(...args: unknown[]): Promise<unknown> };
    const run = proto.run;
    vi.spyOn(proto, 'run').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      const result = await run.apply(this, args);
      applied();
      await released;
      return result;
    });
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'no meio' } });
    await stateChanged;
    const tab = await connect(url, player.cookie, campaignId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();

    const snap = await tab.next();
    expect(snap.t).toBe('snapshot');
    expect(snap.state.chat.map((m: { text: string }) => m.text)).toEqual(['no meio']);
    gm.send({ t: 'cmd', id: 'b', action: { type: 'chat.send', text: 'depois' } });
    expect(await tab.next()).toMatchObject({ event: { type: 'chat.added', message: { text: 'depois' } } });
  });
  it('membro removido perde todas as abas e não recebe mais nada', async () => {
    const { gm, pl, player, url, campaignId } = await wsSetup();
    const tab = await connect(url, player.cookie, campaignId);
    await Promise.all([pl.next(isSnapshot), tab.next(isSnapshot)]);
    gm.send({ t: 'cmd', id: 'r', action: { type: 'member.remove', userId: player.userId } });
    expect(await Promise.all([pl.closed(), tab.closed()])).toEqual([4403, 4403]);
    expect(pl.unread()).toEqual([]);
    expect(tab.unread()).toEqual([]);
    expect(await closeCode(url, player.cookie, campaignId)).toBe(4403);
  });
});

describe('entrada por convite', () => {
  const invite = async (app: Awaited<ReturnType<typeof createTestApp>>['app'], cookie: string, campaignId: string) => {
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie } });
    return (res.json() as { token: string }).token;
  };
  const accept = (app: Awaited<ReturnType<typeof createTestApp>>['app'], cookie: string, token: string) =>
    app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie } });

  it('com a sala carregada, o mestre vê o novo membro e ele já pode jogar', async () => {
    const { t, url, gm, gmSession, campaignId } = await wsSetup();
    await gm.next(isSnapshot);
    const newcomer = await login(t.app, 'Novata');
    const token = await invite(t.app, gmSession.cookie, campaignId);
    expect((await accept(t.app, newcomer.cookie, token)).statusCode).toBe(200);
    expect(await gm.next((m) => m.t === 'event')).toEqual({
      t: 'event',
      event: {
        type: 'member.upserted',
        member: { userId: newcomer.userId, displayName: 'Novata', avatarUrl: null, role: 'player', currentMapId: null },
      },
    });

    const client = await connect(url, newcomer.cookie, campaignId);
    const snap = await client.next(isSnapshot);
    expect(snap.state.me).toEqual({ userId: newcomer.userId, role: 'player' });
    client.send({ t: 'cmd', id: 'c', action: { type: 'chat.send', text: 'cheguei' } });
    expect(await client.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'c' });
    expect(await gm.next((m) => m.t === 'event')).toMatchObject({ event: { type: 'chat.added', message: { text: 'cheguei' } } });
  });
  it('aceitar de novo não avisa ninguém e entrar não vira ação desfazível', async () => {
    const { t, gm, gmSession, player, campaignId } = await wsSetup();
    await gm.next(isSnapshot);
    const before = await t.db.select().from(actionLog).where(eq(actionLog.campaignId, campaignId));
    const token = await invite(t.app, gmSession.cookie, campaignId);
    await accept(t.app, player.cookie, token);
    const newcomer = await login(t.app, 'Novata');
    await accept(t.app, newcomer.cookie, token);
    expect(await gm.next()).toMatchObject({ event: { type: 'member.upserted', member: { userId: newcomer.userId } } });
    expect(await t.db.select().from(actionLog).where(eq(actionLog.campaignId, campaignId))).toHaveLength(before.length);
  });
  it('membro que entrou mas não chegou à sala carregada consegue conectar, e os outros ficam sabendo', async () => {
    const { t, url, gm, gmSession, campaignId } = await wsSetup();
    await gm.next(isSnapshot);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const joined = vi.spyOn(CampaignRoom.prototype, 'memberJoined').mockRejectedValueOnce(new Error('Query read timeout'));
    const newcomer = await login(t.app, 'Novata');
    const token = await invite(t.app, gmSession.cookie, campaignId);
    expect((await accept(t.app, newcomer.cookie, token)).statusCode).toBe(200);
    expect(joined).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();

    const client = await connect(url, newcomer.cookie, campaignId);
    const snap = await client.next();
    expect(snap).toMatchObject({ t: 'snapshot', state: { me: { userId: newcomer.userId, role: 'player' } } });
    expect(await gm.next((m) => m.t === 'event')).toMatchObject({ event: { type: 'member.upserted', member: { userId: newcomer.userId } } });
    client.send({ t: 'cmd', id: 'c', action: { type: 'chat.send', text: 'cheguei' } });
    expect(await client.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'c' });
  });
  it('quem saiu do banco e da sala continua recusado', async () => {
    const { url, gm, pl, player, campaignId } = await wsSetup();
    gm.send({ t: 'cmd', id: 'r', action: { type: 'member.remove', userId: player.userId } });
    expect(await pl.closed()).toBe(4403);
    expect(await closeCode(url, player.cookie, campaignId)).toBe(4403);
  });
  it('não carrega a sala quando ela ainda não está na memória', async () => {
    const t = await createTestApp();
    try {
      const { campaignId, gm } = await seedCampaign(t);
      const load = vi.spyOn(CampaignRoom, 'load');
      const newcomer = await login(t.app, 'Novata');
      const token = await invite(t.app, gm.cookie, campaignId);
      expect((await accept(t.app, newcomer.cookie, token)).statusCode).toBe(200);
      expect(load).not.toHaveBeenCalled();
    } finally {
      await t.close();
    }
  });
});

describe('limites', () => {
  const chat = (id: string) => ({ t: 'cmd', id, action: { type: 'chat.send', text: id } });
  /** The next dispatch hangs until released; the ones after it succeed at once. */
  const holdDispatch = () => {
    let release!: () => void;
    const dispatch = vi.spyOn(CampaignRoom.prototype, 'dispatch');
    dispatch.mockImplementation(async () => ({ ok: true, events: [], resnapshot: [] }));
    dispatch.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, events: [], resnapshot: [] }))),
    );
    return { dispatch, release: () => release() };
  };

  it('aceita até 256 mensagens pendentes por conexão', async () => {
    const { gm } = await wsSetup();
    await gm.next(isSnapshot);
    const { dispatch, release } = holdDispatch();
    for (let i = 0; i < 256; i++) gm.send(chat(String(i)));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    for (let i = 0; i < 256; i++) expect(await gm.next()).toEqual({ t: 'ack', id: String(i) });
    gm.send(chat('depois'));
    expect(await gm.next()).toEqual({ t: 'ack', id: 'depois' });
  });
  it('fecha com 4408 a conexão que passa de 256 pendentes, e só ela', async () => {
    const { gm, pl } = await wsSetup();
    await gm.next(isSnapshot);
    const { dispatch, release } = holdDispatch();
    for (let i = 0; i < 300; i++) gm.send(chat(String(i)));
    expect(await gm.closed()).toBe(4408);
    release();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(256));
    pl.send(chat('sigo aqui'));
    expect(await pl.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'sigo aqui' });
    expect(dispatch).toHaveBeenCalledTimes(257);
  });
  it('mensagens pendentes de conexões diferentes não somam', async () => {
    const { gm, pl } = await wsSetup();
    const { release } = holdDispatch();
    for (let i = 0; i < 200; i++) {
      gm.send(chat(`g${i}`));
      pl.send(chat(`p${i}`));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    expect(await gm.next((m) => m.id === 'g199')).toEqual({ t: 'ack', id: 'g199' });
    expect(await pl.next((m) => m.id === 'p199')).toEqual({ t: 'ack', id: 'p199' });
  });
  it('recusa campo a mais no envelope, devolvendo o id', async () => {
    const { pl } = await wsSetup();
    pl.send({ ...chat('p'), padding: 'x'.repeat(1000) });
    expect(await pl.next((m) => m.t === 'error')).toMatchObject({ id: 'p', code: 'invalid' });
    pl.send(chat('q'));
    expect(await pl.next((m) => m.t === 'ack')).toEqual({ t: 'ack', id: 'q' });
  });
  it('derruba a conexão que não consome o que recebe, e só ela', async () => {
    const { t, gm, pl, url, campaignId, player } = await wsSetup();
    await pl.next(isSnapshot);
    const known = new Set(t.app.websocketServer.clients);
    const slow = await connect(url, player.cookie, campaignId);
    await slow.next(isSnapshot);
    const serverSide = [...t.app.websocketServer.clients].find((s) => !known.has(s))!;
    Object.defineProperty(serverSide, 'bufferedAmount', { value: 8 * 1024 * 1024 + 1 });
    gm.send(chat('a'));
    expect(await slow.closed()).toBe(1006);
    expect(await pl.next((m) => m.t === 'event')).toMatchObject({ event: { type: 'chat.added' } });
  });
  it('não derruba quem está exatamente no teto de 8 MiB', async () => {
    const { t, gm, pl, url, campaignId, player } = await wsSetup();
    await pl.next(isSnapshot);
    const known = new Set(t.app.websocketServer.clients);
    const tab = await connect(url, player.cookie, campaignId);
    await tab.next(isSnapshot);
    const serverSide = [...t.app.websocketServer.clients].find((s) => !known.has(s))!;
    Object.defineProperty(serverSide, 'bufferedAmount', { value: 8 * 1024 * 1024 });
    gm.send(chat('a'));
    expect(await tab.next((m) => m.t === 'event')).toMatchObject({ event: { type: 'chat.added' } });
  });
});

describe('origem', () => {
  it('fecha com 4403 quem vem de outra origem, antes de olhar a sessão', async () => {
    const { url, campaignId, gmSession } = await wsSetup();
    const foreign = ['https://irmao.localhost:5173', 'http://localhost:5174', 'https://localhost:5173', 'null'];
    for (const origin of foreign) {
      expect(await (await connect(url, gmSession.cookie, campaignId, origin)).closed()).toBe(4403);
    }
    expect(await (await connect(url, '', campaignId, foreign[0])).closed()).toBe(4403);
  });
  it('aceita a origem do site e cliente sem origem', async () => {
    const { url, campaignId, gmSession } = await wsSetup();
    const browser = await connect(url, gmSession.cookie, campaignId, 'http://localhost:5173');
    expect(await browser.next()).toMatchObject({ t: 'snapshot' });
    const noOrigin = await connect(url, gmSession.cookie, campaignId);
    expect(await noOrigin.next()).toMatchObject({ t: 'snapshot' });
  });
});

describe('logout', () => {
  const logout = (t: Awaited<ReturnType<typeof createTestApp>>, cookie: string) =>
    t.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });

  it('fecha com 4401 todas as conexões da pessoa, e só as dela', async () => {
    const { t, gm, pl, player, url, campaignId } = await wsSetup();
    const tab = await connect(url, player.cookie, campaignId);
    await Promise.all([pl.next(isSnapshot), tab.next(isSnapshot), gm.next(isSnapshot)]);
    expect((await logout(t, player.cookie)).statusCode).toBe(204);
    expect(await Promise.all([pl.closed(), tab.closed()])).toEqual([4401, 4401]);
    expect(await closeCode(url, player.cookie, campaignId)).toBe(4401);
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'sigo aqui' } });
    expect(await gm.next()).toEqual({ t: 'ack', id: 'a' });
  });
  it('logout sem sessão válida não derruba ninguém', async () => {
    const { t, pl } = await wsSetup();
    await pl.next(isSnapshot);
    expect((await logout(t, 'sid=nao-existe')).statusCode).toBe(204);
    pl.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'sigo aqui' } });
    expect(await pl.next()).toEqual({ t: 'ack', id: 'a' });
  });
  it('comandos que ainda esperavam a vez não rodam depois do logout', async () => {
    const { t, pl, player } = await wsSetup();
    await pl.next(isSnapshot);
    let release!: () => void;
    const dispatch = vi.spyOn(CampaignRoom.prototype, 'dispatch').mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, events: [], resnapshot: [] }))),
    );
    pl.send({ t: 'cmd', id: '1', action: { type: 'chat.send', text: 'primeiro' } });
    pl.send({ t: 'cmd', id: '2', action: { type: 'chat.send', text: 'na fila' } });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await logout(t, player.cookie);
    expect(await pl.closed()).toBe(4401);
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('quem estava conectando durante o logout também é fechado, sem receber snapshot', async () => {
    const { t, gm, player, url, campaignId } = await wsSetup();
    await gm.next(isSnapshot);
    let applied!: () => void;
    const busy = new Promise<void>((resolve) => (applied = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const proto = CampaignRoom.prototype as unknown as { run(...args: unknown[]): Promise<unknown> };
    const run = proto.run;
    vi.spyOn(proto, 'run').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      const result = await run.apply(this, args);
      applied();
      await released;
      return result;
    });
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'segura a sala' } });
    await busy;
    const tab = await connect(url, player.cookie, campaignId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await logout(t, player.cookie);
    release();
    expect(await tab.closed()).toBe(4401);
    expect(tab.unread()).toEqual([]);
  });
});

describe('encerramento', () => {
  it('fechar o app derruba as conexões, espera a ação em andamento e não deixa porta aberta', async () => {
    const { t, gm, pl } = await wsSetup();
    await gm.next(isSnapshot);
    let release!: (result: { ok: false; code: 'internal'; message: string }) => void;
    const dispatch = vi
      .spyOn(CampaignRoom.prototype, 'dispatch')
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'em andamento' } });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());

    let closed = false;
    const closing = t.close().then(() => (closed = true));
    expect(await pl.closed()).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(false);
    release({ ok: false, code: 'internal', message: 'x' });
    await closing;
    expect(t.app.server.listening).toBe(false);
  });
  it('fechar o app não espera para sempre uma ação travada', async () => {
    const { t, gm } = await wsSetup();
    await gm.next(isSnapshot);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatch = vi.spyOn(CampaignRoom.prototype, 'dispatch').mockImplementationOnce(() => new Promise(() => undefined));
    gm.send({ t: 'cmd', id: 'a', action: { type: 'chat.send', text: 'travou' } });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let closed = false;
      void t.close().then(() => (closed = true));
      for (let i = 0; i < 300 && !closed; i++) {
        await vi.advanceTimersByTimeAsync(1000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(logged).toHaveBeenCalled();
    expect(t.app.server.listening).toBe(false);
  });
});
