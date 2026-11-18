import { describe, expect, it } from 'vitest';
import type { ChatMessage, ClientState, MapInfo, Member, Token } from '@rpgai/shared';
import { reduceEvent, useTable } from './store';

const map = (id: string): MapInfo => ({ id, name: id, imageUrl: null, width: 10, height: 10, gridSize: 50, gridOffsetX: 0, gridOffsetY: 0 });
const tok = (id: string, mapId: string): Token => ({ id, mapId, name: id, x: 0, y: 0, size: 1, color: '#fff', imageUrl: null, layer: 'tokens', ownerIds: [] });
const msg = (id: string): ChatMessage => ({ id, authorId: 'u1', kind: 'text', text: id, label: null, rolls: [], secret: false, recipients: null, undone: false, createdAt: '2026-01-01T00:00:00Z' });
const member = (userId: string, name = userId): Member => ({ userId, displayName: name, avatarUrl: null, role: 'player', currentMapId: null });
const baseState = (over: Partial<ClientState> = {}): ClientState => ({
  campaign: { id: 'c1', name: 'C', rulesVersion: '2024', allowMixedVersions: false, defaultMapId: null, playersCanMove: true },
  me: { userId: 'u1', role: 'gm' },
  members: [],
  maps: [],
  tokens: [],
  chat: [],
  canUndo: false,
  ...over,
});

describe('reduceEvent', () => {
  it('aplica eventos de token, mapa, chat e desfazer', () => {
    let s = baseState({ maps: [map('m1')], tokens: [tok('a', 'm1')] });
    s = reduceEvent(s, { type: 'token.upserted', token: tok('b', 'm1') });
    s = reduceEvent(s, { type: 'token.upserted', token: { ...tok('a', 'm1'), x: 9 } });
    expect(s.tokens.map(t => [t.id, t.x])).toEqual([['a', 9], ['b', 0]]);
    s = reduceEvent(s, { type: 'map.removed', mapId: 'm1' });
    expect(s.maps).toEqual([]); expect(s.tokens).toEqual([]);
    s = reduceEvent(s, { type: 'chat.added', message: msg('1') });
    s = reduceEvent(s, { type: 'chat.updated', message: { ...msg('1'), undone: true } });
    expect(s.chat).toEqual([{ ...msg('1'), undone: true }]);
    expect(reduceEvent(s, { type: 'undo.available', canUndo: true }).canUndo).toBe(true);
  });

  it('membros, mapas, token.removed e campanha', () => {
    let s = baseState({ maps: [map('m1'), map('m2')], tokens: [tok('a', 'm1'), tok('b', 'm2')] });
    s = reduceEvent(s, { type: 'member.upserted', member: member('u2') });
    s = reduceEvent(s, { type: 'member.upserted', member: member('u2', 'Novo') });
    expect(s.members).toEqual([member('u2', 'Novo')]);
    s = reduceEvent(s, { type: 'member.removed', userId: 'u2' });
    expect(s.members).toEqual([]);
    s = reduceEvent(s, { type: 'map.upserted', map: { ...map('m1'), name: 'X' } });
    s = reduceEvent(s, { type: 'map.upserted', map: map('m3') });
    expect(s.maps.map(m => m.name)).toEqual(['X', 'm2', 'm3']);
    s = reduceEvent(s, { type: 'map.removed', mapId: 'm1' });
    expect(s.tokens.map(t => t.id)).toEqual(['b']);
    s = reduceEvent(s, { type: 'token.removed', tokenId: 'b' });
    expect(s.tokens).toEqual([]);
    s = reduceEvent(s, { type: 'campaign.updated', campaign: { ...s.campaign, name: 'Nova' } });
    expect(s.campaign.name).toBe('Nova');
  });

  it('nao muta o estado de entrada', () => {
    const s = baseState({ maps: [map('m1')], tokens: [tok('a', 'm1')], chat: [msg('1')] });
    const copy = structuredClone(s);
    reduceEvent(s, { type: 'token.upserted', token: tok('b', 'm1') });
    reduceEvent(s, { type: 'map.removed', mapId: 'm1' });
    reduceEvent(s, { type: 'chat.updated', message: { ...msg('1'), undone: true } });
    reduceEvent(s, { type: 'undo.available', canUndo: true });
    expect(s).toEqual(copy);
  });
});

describe('useTable', () => {
  it('evento antes do snapshot e ignorado', () => {
    useTable.setState({ state: null, status: 'connecting' });
    useTable.getState().applyEvent({ type: 'undo.available', canUndo: true });
    expect(useTable.getState().state).toBeNull();
    useTable.getState().applySnapshot(baseState());
    useTable.getState().applyEvent({ type: 'undo.available', canUndo: true });
    expect(useTable.getState().state?.canUndo).toBe(true);
    useTable.getState().setStatus('online');
    expect(useTable.getState().status).toBe('online');
  });
});
