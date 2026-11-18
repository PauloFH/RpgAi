import { describe, expect, it } from 'vitest';
import type { ClientState, MapInfo, Token } from '@rpgai/shared';
import { canDragToken, centerCell, viewedMap } from './mapView';

const map = (id: string, over: Partial<MapInfo> = {}): MapInfo => ({ id, name: id, imageUrl: null, width: 700, height: 350, gridSize: 70, gridOffsetX: 0, gridOffsetY: 0, ...over });
const state = (role: 'gm' | 'player', maps: MapInfo[], defaultMapId: string | null = null): ClientState => ({
  campaign: { id: 'c', name: 'C', rulesVersion: '2024', allowMixedVersions: false, defaultMapId, playersCanMove: true },
  me: { userId: 'u', role },
  members: [],
  maps,
  tokens: [],
  chat: [],
  canUndo: false,
});

describe('viewedMap', () => {
  it('jogador vê o único mapa do snapshot, sem olhar a escolha local', () => {
    expect(viewedMap(state('player', [map('a')]), 'b')?.id).toBe('a');
    expect(viewedMap(state('player', []), 'b')).toBeNull();
  });

  it('mestre vê o escolhido, senão o padrão, senão o primeiro', () => {
    const maps = [map('a'), map('b'), map('c')];
    expect(viewedMap(state('gm', maps, 'b'), 'c')?.id).toBe('c');
    expect(viewedMap(state('gm', maps, 'b'), null)?.id).toBe('b');
    expect(viewedMap(state('gm', maps, 'b'), 'removido')?.id).toBe('b');
    expect(viewedMap(state('gm', maps), 'removido')?.id).toBe('a');
    expect(viewedMap(state('gm', []), 'removido')).toBeNull();
  });
});

describe('canDragToken', () => {
  const dragState = (role: 'gm' | 'player', playersCanMove = true): ClientState => {
    const s = state(role, []);
    return { ...s, campaign: { ...s.campaign, playersCanMove } };
  };
  const token = (ownerIds: string[]): Token => ({ id: 't', mapId: 'a', name: 'T', x: 0, y: 0, size: 1, color: '#000000', imageUrl: null, layer: 'tokens', ownerIds });

  it('mestre arrasta qualquer token; jogador só o próprio, se o movimento estiver liberado', () => {
    expect(canDragToken(dragState('gm'), token([]), false)).toBe(true);
    expect(canDragToken(dragState('player'), token(['u']), false)).toBe(true);
    expect(canDragToken(dragState('player'), token(['outro']), false)).toBe(false);
    expect(canDragToken(dragState('player', false), token(['u']), false)).toBe(false);
  });
  it('ninguém arrasta enquanto há uma prévia de grid sem confirmar', () => {
    expect(canDragToken(dragState('gm'), token([]), true)).toBe(false);
    expect(canDragToken(dragState('player'), token(['u']), true)).toBe(false);
  });
});

describe('centerCell', () => {
  it('usa o centro do grid', () => {
    expect(centerCell(map('a'), 1)).toEqual({ x: 5, y: 2 });
  });

  it('considera os deslocamentos do grid', () => {
    expect(centerCell(map('a', { gridOffsetX: 70, gridOffsetY: 70 }), 1)).toEqual({ x: 4, y: 2 });
  });

  it('recua um token grande para caber', () => {
    expect(centerCell(map('a'), 4)).toEqual({ x: 5, y: 1 });
  });
});
