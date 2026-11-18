import { gridCols, gridRows } from '@rpgai/shared';
import type { ClientState, MapInfo, Token } from '@rpgai/shared';

/**
 * The map on screen. A player only has the one map in their snapshot; a GM has a local
 * choice, falling back to the campaign's default and then to the first map.
 */
export function viewedMap(state: ClientState, localId: string | null): MapInfo | null {
  const { maps, me, campaign } = state;
  if (me.role !== 'gm') return maps[0] ?? null;
  return maps.find((m) => m.id === localId) ?? maps.find((m) => m.id === campaign.defaultMapId) ?? maps[0] ?? null;
}

/**
 * Whether this person can drag `token` now. Never during a grid preview: the drop would
 * save a cell of a grid that was not applied, which is another place on the real one.
 */
export function canDragToken(state: ClientState, token: Token, previewingGrid: boolean): boolean {
  if (previewingGrid) return false;
  if (state.me.role === 'gm') return true;
  return state.campaign.playersCanMove && token.ownerIds.includes(state.me.userId);
}

/** The map's center cell, pulled back just enough for a large token to fit inside the grid. */
export function centerCell(map: MapInfo, size: number): { x: number; y: number } {
  const cols = gridCols(map);
  const rows = gridRows(map);
  return {
    x: Math.max(0, Math.min(Math.floor(cols / 2), cols - size)),
    y: Math.max(0, Math.min(Math.floor(rows / 2), rows - size)),
  };
}
