import { and, eq, inArray } from 'drizzle-orm';
import type { CampaignInfo, MapInfo, Member, StateEvent, Token } from '@rpgai/shared';
import type { Db } from '../db/client';
import { campaignMembers, campaigns, chatMessages, maps, tokens } from '../db/schema';
import type { ServerState } from './room';

export type MapRecord = MapInfo & { imageKey: string | null };
export type TokenRecord = Token & { imageKey: string | null };

export type InverseOp =
  | { op: 'campaign.set'; fields: Partial<Pick<CampaignInfo, 'name' | 'playersCanMove' | 'defaultMapId'>> }
  | { op: 'member.set'; userId: string; fields: Partial<Pick<Member, 'role' | 'currentMapId'>> }
  | { op: 'member.restore'; member: Member }
  | { op: 'map.set'; mapId: string; fields: Partial<MapInfo> }
  | { op: 'map.delete'; mapId: string }
  | { op: 'map.restore'; map: MapRecord; tokens: TokenRecord[]; wasDefault: boolean; memberIds: string[] }
  | { op: 'token.set'; tokenId: string; fields: Partial<Token> }
  | { op: 'token.delete'; tokenId: string }
  | { op: 'token.restore'; token: TokenRecord }
  | { op: 'chat.markUndone'; messageId: string };

/**
 * One primitive change to the table. Every action resolves to exactly one Change,
 * and undo applies the stored InverseOp as a Change, so both go through the same
 * persist/apply code. `member.delete` only exists forward (its inverse is member.restore).
 */
export type Change = InverseOp | { op: 'member.delete'; userId: string };

const MAP_COLUMNS = ['name', 'gridSize', 'gridOffsetX', 'gridOffsetY'] as const;
const TOKEN_COLUMNS = ['mapId', 'name', 'x', 'y', 'size', 'color', 'layer', 'ownerIds'] as const;

export const imageUrl = (key: string | null): string | null => (key ? `/files/${key}` : null);

export function publicMap({ imageKey: _key, ...map }: MapRecord): MapInfo {
  return map;
}

export function publicToken({ imageKey: _key, ...token }: TokenRecord): Token {
  return { ...token, ownerIds: [...token.ownerIds] };
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Current values of the fields a change is about to overwrite. */
function previous<T extends object>(current: T, fields: Partial<T>): Partial<T> {
  return pick(current, Object.keys(fields) as Array<keyof T>);
}

function find<T>(items: T[], pred: (item: T) => boolean, what: string): T {
  const item = items.find(pred);
  if (!item) throw new Error(`${what} not in room state`);
  return item;
}

/** Builds the InverseOp that undoes `change`, from the state before it is applied. */
export function invert(state: ServerState, change: Change): InverseOp {
  switch (change.op) {
    case 'campaign.set':
      return { op: 'campaign.set', fields: previous(state.campaign, change.fields) };
    case 'member.set': {
      const member = find(state.members, (m) => m.userId === change.userId, 'member');
      return { op: 'member.set', userId: change.userId, fields: previous(member, change.fields) };
    }
    case 'member.delete': {
      const member = find(state.members, (m) => m.userId === change.userId, 'member');
      return { op: 'member.restore', member: { ...member } };
    }
    case 'map.set': {
      const map = find(state.maps, (m) => m.id === change.mapId, 'map');
      return { op: 'map.set', mapId: change.mapId, fields: previous<MapInfo>(map, change.fields) };
    }
    case 'map.delete': {
      const map = find(state.maps, (m) => m.id === change.mapId, 'map');
      return {
        op: 'map.restore',
        map: { ...map },
        tokens: state.tokens.filter((t) => t.mapId === map.id).map((t) => ({ ...t, ownerIds: [...t.ownerIds] })),
        wasDefault: state.campaign.defaultMapId === map.id,
        memberIds: state.members.filter((m) => m.currentMapId === map.id).map((m) => m.userId),
      };
    }
    case 'map.restore':
      return { op: 'map.delete', mapId: change.map.id };
    case 'token.set': {
      const token = find(state.tokens, (t) => t.id === change.tokenId, 'token');
      return { op: 'token.set', tokenId: change.tokenId, fields: previous<Token>(token, change.fields) };
    }
    case 'token.delete': {
      const token = find(state.tokens, (t) => t.id === change.tokenId, 'token');
      return { op: 'token.restore', token: { ...token, ownerIds: [...token.ownerIds] } };
    }
    case 'token.restore':
      return { op: 'token.delete', tokenId: change.token.id };
    case 'member.restore':
    case 'chat.markUndone':
      throw new Error(`${change.op} is only used as an inverse`);
  }
}

const tokenRow = (campaignId: string, t: TokenRecord) => ({
  id: t.id,
  campaignId,
  mapId: t.mapId,
  name: t.name,
  x: t.x,
  y: t.y,
  size: t.size,
  color: t.color,
  imageKey: t.imageKey,
  layer: t.layer,
  ownerIds: t.ownerIds,
});

/** Writes `change` to the database. Runs inside the dispatch transaction. */
export async function persistChange(tx: Db, campaignId: string, change: Change): Promise<void> {
  const member = (userId: string) =>
    and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId));
  switch (change.op) {
    case 'campaign.set':
      await tx.update(campaigns).set(change.fields).where(eq(campaigns.id, campaignId));
      return;
    case 'member.set':
      await tx.update(campaignMembers).set(change.fields).where(member(change.userId));
      return;
    case 'member.delete':
      await tx.delete(campaignMembers).where(member(change.userId));
      return;
    case 'member.restore': {
      const { userId, role, currentMapId } = change.member;
      await tx
        .insert(campaignMembers)
        .values({ campaignId, userId, role, currentMapId })
        .onConflictDoUpdate({ target: [campaignMembers.campaignId, campaignMembers.userId], set: { role, currentMapId } });
      return;
    }
    case 'map.set': {
      const fields = pick(change.fields, MAP_COLUMNS);
      if (Object.keys(fields).length > 0) await tx.update(maps).set(fields).where(eq(maps.id, change.mapId));
      return;
    }
    case 'map.delete':
      await tx.delete(tokens).where(eq(tokens.mapId, change.mapId));
      await tx
        .update(campaignMembers)
        .set({ currentMapId: null })
        .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.currentMapId, change.mapId)));
      await tx
        .update(campaigns)
        .set({ defaultMapId: null })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.defaultMapId, change.mapId)));
      await tx.delete(maps).where(eq(maps.id, change.mapId));
      return;
    case 'map.restore': {
      const { imageUrl: _url, ...map } = change.map;
      await tx.insert(maps).values({ ...map, campaignId });
      if (change.tokens.length > 0) await tx.insert(tokens).values(change.tokens.map((t) => tokenRow(campaignId, t)));
      if (change.wasDefault) await tx.update(campaigns).set({ defaultMapId: map.id }).where(eq(campaigns.id, campaignId));
      if (change.memberIds.length > 0) {
        await tx
          .update(campaignMembers)
          .set({ currentMapId: map.id })
          .where(and(eq(campaignMembers.campaignId, campaignId), inArray(campaignMembers.userId, change.memberIds)));
      }
      return;
    }
    case 'token.set': {
      const fields = pick(change.fields, TOKEN_COLUMNS);
      if (Object.keys(fields).length > 0) await tx.update(tokens).set(fields).where(eq(tokens.id, change.tokenId));
      return;
    }
    case 'token.delete':
      await tx.delete(tokens).where(eq(tokens.id, change.tokenId));
      return;
    case 'token.restore':
      await tx.insert(tokens).values(tokenRow(campaignId, change.token));
      return;
    case 'chat.markUndone':
      await tx.update(chatMessages).set({ undone: true }).where(eq(chatMessages.id, change.messageId));
      return;
  }
}

/** Applies `change` to the in-memory state (after commit) and returns the resulting events. */
export function applyChange(state: ServerState, change: Change): StateEvent[] {
  const campaignUpdated = (): StateEvent => ({ type: 'campaign.updated', campaign: { ...state.campaign } });
  const memberUpserted = (m: Member): StateEvent => ({ type: 'member.upserted', member: { ...m } });
  switch (change.op) {
    case 'campaign.set':
      Object.assign(state.campaign, change.fields);
      return [campaignUpdated()];
    case 'member.set': {
      const member = find(state.members, (m) => m.userId === change.userId, 'member');
      Object.assign(member, change.fields);
      return [memberUpserted(member)];
    }
    case 'member.delete':
      state.members = state.members.filter((m) => m.userId !== change.userId);
      return [{ type: 'member.removed', userId: change.userId }];
    case 'member.restore': {
      const member = { ...change.member };
      state.members = [...state.members.filter((m) => m.userId !== member.userId), member];
      return [memberUpserted(member)];
    }
    case 'map.set': {
      const map = find(state.maps, (m) => m.id === change.mapId, 'map');
      Object.assign(map, pick(change.fields, MAP_COLUMNS));
      return [{ type: 'map.upserted', map: publicMap(map) }];
    }
    case 'map.delete': {
      const events: StateEvent[] = [];
      for (const t of state.tokens.filter((t) => t.mapId === change.mapId)) events.push({ type: 'token.removed', tokenId: t.id });
      state.tokens = state.tokens.filter((t) => t.mapId !== change.mapId);
      for (const m of state.members.filter((m) => m.currentMapId === change.mapId)) {
        m.currentMapId = null;
        events.push(memberUpserted(m));
      }
      if (state.campaign.defaultMapId === change.mapId) {
        state.campaign.defaultMapId = null;
        events.push(campaignUpdated());
      }
      state.maps = state.maps.filter((m) => m.id !== change.mapId);
      events.push({ type: 'map.removed', mapId: change.mapId });
      return events;
    }
    case 'map.restore': {
      const map = { ...change.map };
      state.maps.push(map);
      const events: StateEvent[] = [{ type: 'map.upserted', map: publicMap(map) }];
      for (const t of change.tokens) {
        const token = { ...t, ownerIds: [...t.ownerIds] };
        state.tokens.push(token);
        events.push({ type: 'token.upserted', token: publicToken(token) });
      }
      if (change.wasDefault) {
        state.campaign.defaultMapId = map.id;
        events.push(campaignUpdated());
      }
      for (const m of state.members.filter((m) => change.memberIds.includes(m.userId))) {
        m.currentMapId = map.id;
        events.push(memberUpserted(m));
      }
      return events;
    }
    case 'token.set': {
      const token = find(state.tokens, (t) => t.id === change.tokenId, 'token');
      Object.assign(token, pick(change.fields, TOKEN_COLUMNS));
      return [{ type: 'token.upserted', token: publicToken(token) }];
    }
    case 'token.delete':
      state.tokens = state.tokens.filter((t) => t.id !== change.tokenId);
      return [{ type: 'token.removed', tokenId: change.tokenId }];
    case 'token.restore': {
      const token = { ...change.token, ownerIds: [...change.token.ownerIds] };
      state.tokens.push(token);
      return [{ type: 'token.upserted', token: publicToken(token) }];
    }
    case 'chat.markUndone': {
      const message = state.chat.find((m) => m.id === change.messageId);
      if (!message) return [];
      message.undone = true;
      return [{ type: 'chat.updated', message: { ...message } }];
    }
  }
}
