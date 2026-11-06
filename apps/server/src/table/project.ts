import {
  canSeeMap,
  canSeeMessage,
  canSeeToken,
  effectiveMapId,
  type ClientState,
  type StateEvent,
  type Viewer,
} from '@rpgai/shared';
import { publicMap, publicToken } from './inverse';
import type { ServerState } from './room';

const SNAPSHOT_CHAT = 200;

export function viewerFor(state: ServerState, userId: string): Viewer | null {
  const member = state.members.find((m) => m.userId === userId);
  if (!member) return null;
  return { userId, role: member.role, mapId: effectiveMapId(member, state.campaign) };
}

/** Everything `userId` may see right now; never contains image keys or hidden data. */
export function snapshotFor(state: ServerState, userId: string, canUndo: boolean): ClientState {
  const viewer = viewerFor(state, userId);
  if (!viewer) throw new Error(`user ${userId} is not a member`);
  const maps = state.maps.filter((m) => viewer.role === 'gm' || (viewer.mapId !== null && canSeeMap(viewer, m.id)));
  const tokens = state.tokens.filter((t) => canSeeToken(viewer, t));
  const chat = state.chat.filter((m) => canSeeMessage(viewer, m)).slice(-SNAPSHOT_CHAT);
  return {
    campaign: { ...state.campaign },
    me: { userId, role: viewer.role },
    members: state.members.map((m) => ({ ...m })),
    maps: maps.map(publicMap),
    tokens: tokens.map(publicToken),
    chat: chat.map((m) => ({ ...m })),
    canUndo: viewer.role === 'gm' && canUndo,
  };
}

/** The version of `event` this viewer may receive, or null when they must not get it. */
export function projectEvent(event: StateEvent, viewer: Viewer): StateEvent | null {
  switch (event.type) {
    case 'token.upserted':
      return canSeeToken(viewer, event.token) ? event : { type: 'token.removed', tokenId: event.token.id };
    case 'map.upserted':
      return canSeeMap(viewer, event.map.id) ? event : null;
    case 'map.removed':
      return canSeeMap(viewer, event.mapId) ? event : null;
    case 'chat.added':
    case 'chat.updated':
      return canSeeMessage(viewer, event.message) ? event : null;
    case 'undo.available':
      return viewer.role === 'gm' ? event : null;
    case 'campaign.updated':
    case 'member.upserted':
    case 'member.removed':
    case 'token.removed':
      return event;
  }
}
