import { create } from 'zustand';
import type { ClientState, StateEvent } from '@rpgai/shared';

export type TableStatus = 'connecting' | 'online' | 'offline';

function upsert<T>(list: T[], item: T, same: (other: T) => boolean): T[] {
  const i = list.findIndex(same);
  if (i === -1) return [...list, item];
  return list.map((x, idx) => (idx === i ? item : x));
}

export function reduceEvent(state: ClientState, event: StateEvent): ClientState {
  switch (event.type) {
    case 'campaign.updated':
      return { ...state, campaign: event.campaign };
    case 'member.upserted':
      return { ...state, members: upsert(state.members, event.member, m => m.userId === event.member.userId) };
    case 'member.removed':
      return { ...state, members: state.members.filter(m => m.userId !== event.userId) };
    case 'map.upserted':
      return { ...state, maps: upsert(state.maps, event.map, m => m.id === event.map.id) };
    case 'map.removed':
      return {
        ...state,
        maps: state.maps.filter(m => m.id !== event.mapId),
        tokens: state.tokens.filter(t => t.mapId !== event.mapId),
      };
    case 'token.upserted':
      return { ...state, tokens: upsert(state.tokens, event.token, t => t.id === event.token.id) };
    case 'token.removed':
      return { ...state, tokens: state.tokens.filter(t => t.id !== event.tokenId) };
    case 'chat.added':
      return { ...state, chat: [...state.chat, event.message] };
    case 'chat.updated':
      return { ...state, chat: state.chat.map(m => (m.id === event.message.id ? event.message : m)) };
    case 'undo.available':
      return { ...state, canUndo: event.canUndo };
  }
}

interface TableStore {
  state: ClientState | null;
  status: TableStatus;
  applySnapshot(s: ClientState): void;
  applyEvent(e: StateEvent): void;
  setStatus(s: TableStatus): void;
}

export const useTable = create<TableStore>(set => ({
  state: null,
  status: 'connecting',
  applySnapshot: s => set({ state: s }),
  applyEvent: e => set(cur => (cur.state ? { state: reduceEvent(cur.state, e) } : cur)),
  setStatus: status => set({ status }),
}));
