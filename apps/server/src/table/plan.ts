import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { canSeeToken, ChatError, DiceError, effectiveMapId, isInsideGrid, type Action, type ErrorCode, type Member, type Rng } from '@rpgai/shared';
import type { Db } from '../db/client';
import { uploads } from '../db/schema';
import { buildMessage } from './chat';
import { imageUrl, type Change } from './inverse';
import type { DispatchErr, ServerState } from './room';

const DEFAULT_GRID_SIZE = 70; // same as the maps.grid_size column default

export type Plan = { ok: true; change: Change } | DispatchErr;

export const fail = (code: ErrorCode, message: string): DispatchErr => ({ ok: false, code, message });
const plan = (change: Change): Plan => ({ ok: true, change });

function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const isEmpty = (obj: object): boolean => Object.keys(obj).length === 0;

const NOT_FOUND = {
  map: fail('not_found', 'Mapa não encontrado.'),
  token: fail('not_found', 'Token não encontrado.'),
  member: fail('not_found', 'Membro não encontrado.'),
  upload: fail('not_found', 'Imagem não encontrada.'),
};
const FORBIDDEN = fail('forbidden', 'Você não tem permissão para isso.');
const NOTHING_TO_CHANGE = fail('invalid', 'Nada para alterar.');
const OUTSIDE_GRID = fail('invalid', 'Posição fora do grid.');
const LAST_GM = fail('invalid', 'A campanha precisa de pelo menos um mestre.');

/**
 * Validates `action` for `actor` against the current state and resolves it to the
 * single Change that applies it. Never writes anything.
 */
export async function planAction(
  db: Db,
  state: ServerState,
  actor: Member,
  action: Exclude<Action, { type: 'undo' }>,
  rng: Rng,
): Promise<Plan> {
  if (action.type === 'chat.send') return planChat(state, actor, action.text, rng);
  if (actor.role !== 'gm' && action.type !== 'token.update') return FORBIDDEN;

  const findMap = (id: string) => state.maps.find((m) => m.id === id);
  const findToken = (id: string) => state.tokens.find((t) => t.id === id);
  const findMember = (id: string) => state.members.find((m) => m.userId === id);
  const isLastGm = (m: Member) => m.role === 'gm' && state.members.filter((x) => x.role === 'gm').length === 1;
  const uploadExists = async (key: string) => {
    const [row] = await db
      .select({ width: uploads.width, height: uploads.height })
      .from(uploads)
      .where(and(eq(uploads.key, key), eq(uploads.campaignId, state.campaign.id)));
    return row ?? null;
  };
  const owners = (ids: string[]) => {
    const unique = [...new Set(ids)];
    return unique.every((id) => findMember(id)) ? unique : null;
  };

  switch (action.type) {
    case 'campaign.update': {
      const fields = defined({ name: action.name, playersCanMove: action.playersCanMove });
      return isEmpty(fields) ? NOTHING_TO_CHANGE : plan({ op: 'campaign.set', fields });
    }
    case 'member.setRole': {
      const target = findMember(action.userId);
      if (!target) return NOT_FOUND.member;
      if (action.role === 'player' && isLastGm(target)) return LAST_GM;
      return plan({ op: 'member.set', userId: target.userId, fields: { role: action.role } });
    }
    case 'member.remove': {
      const target = findMember(action.userId);
      if (!target) return NOT_FOUND.member;
      if (isLastGm(target)) return LAST_GM;
      return plan({ op: 'member.delete', userId: target.userId });
    }
    case 'member.setMap': {
      const target = findMember(action.userId);
      if (!target) return NOT_FOUND.member;
      if (action.mapId !== null && !findMap(action.mapId)) return NOT_FOUND.map;
      return plan({ op: 'member.set', userId: target.userId, fields: { currentMapId: action.mapId } });
    }
    case 'map.create': {
      const upload = await uploadExists(action.imageKey);
      if (!upload) return NOT_FOUND.upload;
      return plan({
        op: 'map.restore',
        map: {
          id: randomUUID(),
          name: action.name,
          imageKey: action.imageKey,
          imageUrl: imageUrl(action.imageKey),
          width: upload.width,
          height: upload.height,
          gridSize: DEFAULT_GRID_SIZE,
          gridOffsetX: 0,
          gridOffsetY: 0,
        },
        tokens: [],
        wasDefault: state.campaign.defaultMapId === null,
        memberIds: [],
      });
    }
    case 'map.update': {
      if (!findMap(action.mapId)) return NOT_FOUND.map;
      const { type: _type, mapId, ...rest } = action;
      const fields = defined(rest);
      return isEmpty(fields) ? NOTHING_TO_CHANGE : plan({ op: 'map.set', mapId, fields });
    }
    case 'map.delete':
      return findMap(action.mapId) ? plan({ op: 'map.delete', mapId: action.mapId }) : NOT_FOUND.map;
    case 'map.setDefault':
      return findMap(action.mapId) ? plan({ op: 'campaign.set', fields: { defaultMapId: action.mapId } }) : NOT_FOUND.map;
    case 'token.create': {
      const map = findMap(action.mapId);
      if (!map) return NOT_FOUND.map;
      const ownerIds = owners(action.ownerIds);
      if (!ownerIds) return NOT_FOUND.member;
      const imageKey = action.imageKey ?? null;
      if (imageKey !== null && !(await uploadExists(imageKey))) return NOT_FOUND.upload;
      if (!isInsideGrid(map, action.x, action.y, action.size)) return OUTSIDE_GRID;
      return plan({
        op: 'token.restore',
        token: {
          id: randomUUID(),
          mapId: map.id,
          name: action.name,
          x: action.x,
          y: action.y,
          size: action.size,
          color: action.color,
          imageKey,
          imageUrl: imageUrl(imageKey),
          layer: action.layer,
          ownerIds,
        },
      });
    }
    case 'token.update': {
      const token = findToken(action.tokenId);
      if (!token) return NOT_FOUND.token;
      // First of all: any other answer would tell a player that a hidden token exists.
      const viewer = { userId: actor.userId, role: actor.role, mapId: effectiveMapId(actor, state.campaign) };
      if (!canSeeToken(viewer, token)) return NOT_FOUND.token;
      const { type: _type, tokenId, ...rest } = action;
      const fields = defined(rest);
      if (isEmpty(fields)) return NOTHING_TO_CHANGE;
      if (actor.role !== 'gm') {
        const onlyMoves = Object.keys(fields).every((k) => k === 'x' || k === 'y');
        if (!token.ownerIds.includes(actor.userId) || !state.campaign.playersCanMove || !onlyMoves) return FORBIDDEN;
      }
      if (fields.ownerIds) {
        const ownerIds = owners(fields.ownerIds);
        if (!ownerIds) return NOT_FOUND.member;
        fields.ownerIds = ownerIds;
      }
      // Only a move or resize is checked against the grid, so a token left outside by a
      // later grid change can still be renamed or recoloured.
      if (fields.x !== undefined || fields.y !== undefined || fields.size !== undefined) {
        const map = findMap(token.mapId);
        if (!map) return NOT_FOUND.map;
        const next = { ...token, ...fields };
        if (!isInsideGrid(map, next.x, next.y, next.size)) return OUTSIDE_GRID;
      }
      return plan({ op: 'token.set', tokenId, fields });
    }
    case 'token.delete':
      return findToken(action.tokenId) ? plan({ op: 'token.delete', tokenId: action.tokenId }) : NOT_FOUND.token;
  }
}

function planChat(state: ServerState, actor: Member, text: string, rng: Rng): Plan {
  try {
    const message = buildMessage({ text, authorId: actor.userId, members: state.members, rng });
    return plan({
      op: 'chat.add',
      message: { ...message, id: randomUUID(), createdAt: new Date().toISOString(), undone: false },
    });
  } catch (err) {
    if (err instanceof DiceError) return fail('dice', err.message);
    if (err instanceof ChatError) return fail('invalid', err.message);
    if (err instanceof Error && err.message === 'unknown_member') return fail('invalid', 'Unknown or ambiguous whisper target.');
    throw err;
  }
}
