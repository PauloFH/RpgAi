import {
  canSeeMap,
  canSeeMessage,
  canSeeToken,
  effectiveMapId,
  type ClientState,
  type Member,
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

/** A player sees the other members, but not on which map the GM has put them. */
function memberFor(member: Member, viewer: Viewer): Member {
  return viewer.role === 'gm' || member.userId === viewer.userId ? { ...member } : { ...member, currentMapId: null };
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
    members: state.members.map((m) => memberFor(m, viewer)),
    maps: maps.map(publicMap),
    tokens: tokens.map(publicToken),
    chat: chat.map((m) => ({ ...m })),
    canUndo: viewer.role === 'gm' && canUndo,
  };
}

/**
 * The version of `event` this viewer may receive, or null when they must not get it.
 * `knownTokens` is what they were already told about: a removal is news only to them,
 * and to anyone else it would reveal that a hidden token exists and just changed.
 */
export function projectEvent(event: StateEvent, viewer: Viewer, knownTokens: ReadonlySet<string>): StateEvent | null {
  switch (event.type) {
    case 'token.upserted':
      if (canSeeToken(viewer, event.token)) return event;
      return knownTokens.has(event.token.id) ? { type: 'token.removed', tokenId: event.token.id } : null;
    case 'token.removed':
      return knownTokens.has(event.tokenId) ? event : null;
    case 'member.upserted':
      return { type: 'member.upserted', member: memberFor(event.member, viewer) };
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
    case 'member.removed':
      return event;
  }
}
