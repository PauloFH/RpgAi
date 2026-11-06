import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { MapInfo } from '@rpgai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionLog } from '../src/db/schema';
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
    const ev = await pl.next(m => m.t === 'event' && m.event.type === 'token.upserted');
    expect(ev.event.token.name).toBe('Visível');
    gm.send({ t: 'cmd', id: 'c', action: { type: 'token.update', tokenId: ev.event.token.id, layer: 'gm' } });
    expect(await pl.next(m => m.t === 'event')).toEqual({ t: 'event', event: { type: 'token.removed', tokenId: ev.event.token.id } });
  });
  it('mudar o mapa do jogador manda snapshot novo', async () => {
    const { gm, pl, m2, player } = await wsSetup({ secondMap: true });
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
  it('membro removido é desconectado', async () => {
    const { gm, pl, player } = await wsSetup();
    gm.send({ t: 'cmd', id: 'r', action: { type: 'member.remove', userId: player.userId } });
    expect(await pl.closed()).toBe(4403);
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
    await pl.next((m) => m.t === 'event' && m.event.type === 'token.removed');
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
});
