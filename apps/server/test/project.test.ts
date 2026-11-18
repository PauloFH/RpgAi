import type { ChatMessage, MapInfo, Token, Viewer } from '@rpgai/shared';
import { describe, expect, it } from 'vitest';
import { projectEvent, snapshotFor, viewerFor } from '../src/table/project';
import type { ServerState } from '../src/table/room';

const player: Viewer = { userId: 'p', role: 'player', mapId: 'm1' };
const gm: Viewer = { userId: 'g', role: 'gm', mapId: null };

const tok = (o: Partial<Token> = {}): Token => ({ id: 't', mapId: 'm1', name: 'T', x: 0, y: 0, size: 1, color: '#000000', imageUrl: null, layer: 'tokens', ownerIds: [], ...o });
const map = (o: Partial<MapInfo> = {}): MapInfo => ({ id: 'm1', name: 'M', imageUrl: null, width: 700, height: 700, gridSize: 70, gridOffsetX: 0, gridOffsetY: 0, ...o });
const msg = (o: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'c', authorId: 'g', kind: 'text', text: 'x', label: null, rolls: [], secret: false, recipients: null, undone: false, createdAt: '2026-01-01T00:00:00.000Z', ...o });

function serverState(o: { maps?: string[]; tokens?: Token[]; chat?: ChatMessage[] } = {}): ServerState {
  return {
    campaign: { id: 'c1', name: 'C', rulesVersion: '2024', allowMixedVersions: false, defaultMapId: 'm1', playersCanMove: true },
    members: [
      { userId: 'g', displayName: 'Mestre', avatarUrl: null, role: 'gm', currentMapId: null },
      { userId: 'p', displayName: 'Lia', avatarUrl: null, role: 'player', currentMapId: 'm1' },
    ],
    maps: (o.maps ?? ['m1']).map((id) => ({ ...map({ id }), imageKey: `k/${id}.png` })),
    tokens: (o.tokens ?? []).map((t) => ({ ...t, imageKey: 'secret-key' })),
    chat: o.chat ?? [],
  };
}

const nothing: ReadonlySet<string> = new Set();

describe('projectEvent', () => {
  it('token conhecido que fica invisível vira remoção', () => {
    expect(projectEvent({ type: 'token.upserted', token: tok({ id: 't1', layer: 'gm' }) }, player, new Set(['t1']))).toEqual({ type: 'token.removed', tokenId: 't1' });
  });
  it('token invisível que o jogador nunca viu não gera nada', () => {
    expect(projectEvent({ type: 'token.upserted', token: tok({ id: 't1', layer: 'gm' }) }, player, nothing)).toBeNull();
    expect(projectEvent({ type: 'token.upserted', token: tok({ id: 't1', mapId: 'm2' }) }, player, nothing)).toBeNull();
  });
  it('token.removed só chega a quem conhecia o token', () => {
    const removed = { type: 'token.removed', tokenId: 'x' } as const;
    expect(projectEvent(removed, player, nothing)).toBeNull();
    expect(projectEvent(removed, player, new Set(['x']))).toEqual(removed);
  });
  it('mapa de outro lugar e undo.available não chegam ao jogador', () => {
    expect(projectEvent({ type: 'map.upserted', map: map({ id: 'm2' }) }, player, nothing)).toBeNull();
    expect(projectEvent({ type: 'map.removed', mapId: 'm2' }, player, nothing)).toBeNull();
    expect(projectEvent({ type: 'undo.available', canUndo: true }, player, nothing)).toBeNull();
  });
  it('mestre recebe tudo; eventos neutros passam', () => {
    const e = { type: 'undo.available', canUndo: true } as const;
    expect(projectEvent(e, gm, nothing)).toEqual(e);
    const t = { type: 'token.upserted', token: tok({ layer: 'gm' }) } as const;
    expect(projectEvent(t, gm, nothing)).toEqual(t);
    expect(projectEvent({ type: 'map.upserted', map: map() }, player, nothing)).toEqual({ type: 'map.upserted', map: map() });
  });
  it('chat não visível vira null', () => {
    const hidden = msg({ recipients: ['g', 'q'] });
    expect(projectEvent({ type: 'chat.added', message: hidden }, player, nothing)).toBeNull();
    expect(projectEvent({ type: 'chat.updated', message: hidden }, player, nothing)).toBeNull();
    expect(projectEvent({ type: 'chat.added', message: msg() }, player, nothing)).not.toBeNull();
  });
  it('jogador não vê em que mapa estão os outros membros; o próprio e o mestre sim', () => {
    const other = { userId: 'q', displayName: 'Davi', avatarUrl: null, role: 'player', currentMapId: 'm2' } as const;
    const self = { ...other, userId: 'p', displayName: 'Lia' };
    expect(projectEvent({ type: 'member.upserted', member: other }, player, nothing)).toEqual({ type: 'member.upserted', member: { ...other, currentMapId: null } });
    expect(projectEvent({ type: 'member.upserted', member: self }, player, nothing)).toEqual({ type: 'member.upserted', member: self });
    expect(projectEvent({ type: 'member.upserted', member: other }, gm, nothing)).toEqual({ type: 'member.upserted', member: other });
  });
});

describe('snapshotFor', () => {
  it('snapshot do jogador não contém nada escondido', () => {
    const s = serverState({ maps: ['m1', 'm2'], tokens: [tok({ id: 'a' }), tok({ id: 'b', layer: 'gm' }), tok({ id: 'c', mapId: 'm2' })], chat: [msg({ recipients: ['g', 'q'] })] });
    const snap = snapshotFor(s, 'p', true);
    expect(snap.maps.map((m) => m.id)).toEqual(['m1']);
    expect(snap.tokens.map((t) => t.id)).toEqual(['a']);
    expect(snap.chat).toEqual([]);
    expect(snap.canUndo).toBe(false);
    expect(JSON.stringify(snap)).not.toContain('imageKey');
    expect(JSON.stringify(snap)).not.toContain('secret-key');
  });
  it('no snapshot do jogador só o próprio mapa atual aparece; o mestre vê todos', () => {
    const s = serverState({ maps: ['m1', 'm2'] });
    s.members.push({ userId: 'q', displayName: 'Davi', avatarUrl: null, role: 'player', currentMapId: 'm2' });
    const mapOf = (viewer: string, member: string) => snapshotFor(s, viewer, false).members.find((m) => m.userId === member)!.currentMapId;
    expect(mapOf('p', 'q')).toBeNull();
    expect(mapOf('p', 'p')).toBe('m1');
    expect(mapOf('g', 'q')).toBe('m2');
    expect(mapOf('g', 'p')).toBe('m1');
  });
  it('mestre recebe tudo e o canUndo dado', () => {
    const s = serverState({ maps: ['m1', 'm2'], tokens: [tok({ id: 'a' }), tok({ id: 'b', layer: 'gm' })], chat: [msg({ recipients: ['g', 'q'] }), msg({ id: 'w', recipients: ['p', 'q'] })] });
    const snap = snapshotFor(s, 'g', true);
    expect(snap.maps).toHaveLength(2);
    expect(snap.tokens).toHaveLength(2);
    expect(snap.chat).toHaveLength(1);
    expect(snap.canUndo).toBe(true);
    expect(snap.me).toEqual({ userId: 'g', role: 'gm' });
    expect(JSON.stringify(snap)).not.toContain('imageKey');
  });
  it('snapshot limita o chat a 200 mensagens visíveis', () => {
    const s = serverState({ chat: Array.from({ length: 250 }, (_, i) => msg({ id: String(i), recipients: null })) });
    const snap = snapshotFor(s, 'p', false);
    expect(snap.chat).toHaveLength(200);
    expect(snap.chat.at(-1)!.id).toBe('249');
  });
  it('jogador sem mapa efetivo não recebe mapas nem tokens', () => {
    const s = serverState({ tokens: [tok()] });
    s.campaign.defaultMapId = null;
    s.members[1]!.currentMapId = null;
    const snap = snapshotFor(s, 'p', false);
    expect(snap.maps).toEqual([]);
    expect(snap.tokens).toEqual([]);
  });
});

describe('viewerFor', () => {
  it('devolve o viewer do membro e null para quem não é', () => {
    const s = serverState();
    expect(viewerFor(s, 'p')).toEqual({ userId: 'p', role: 'player', mapId: 'm1' });
    expect(viewerFor(s, 'zzz')).toBeNull();
  });
});
