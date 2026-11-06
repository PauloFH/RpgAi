import { and, desc, eq } from 'drizzle-orm';
import {
  ActionSchema,
  effectiveMapId,
  type Action,
  type CampaignInfo,
  type ChatMessage,
  type ErrorCode,
  type Layer,
  type Member,
  type RollResult,
  type Rng,
  type Role,
  type StateEvent,
} from '@rpgai/shared';
import type { Db } from '../db/client';
import { actionLog, campaignMembers, campaigns, chatMessages, maps, tokens, users } from '../db/schema';
import { CHAT_HISTORY, applyChange, imageUrl, invert, persistChange, type Change, type InverseOp, type MapRecord, type TokenRecord } from './inverse';
import { fail, planAction } from './plan';

export interface Actor { userId: string; via: 'web' | 'api' | 'mcp' }
export interface ServerState {
  campaign: CampaignInfo;
  members: Member[];
  maps: MapRecord[];
  tokens: TokenRecord[];
  chat: ChatMessage[]; // últimas 500 da campanha, em ordem
}
export interface DispatchOk { ok: true; events: StateEvent[]; resnapshot: string[] } // userIds que precisam de snapshot novo
export interface DispatchErr { ok: false; code: ErrorCode; message: string }

export class CampaignRoom {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly db: Db,
    readonly campaignId: string,
    private readonly rng: Rng,
    private readonly current: ServerState,
    private undoable: boolean,
  ) {}

  static async load(db: Db, campaignId: string, rng: Rng): Promise<CampaignRoom> {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) throw new Error(`campaign ${campaignId} not found`);
    const [memberRows, mapRows, tokenRows, chatRows, pending] = await Promise.all([
      db
        .select({
          userId: campaignMembers.userId,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          role: campaignMembers.role,
          currentMapId: campaignMembers.currentMapId,
        })
        .from(campaignMembers)
        .innerJoin(users, eq(users.id, campaignMembers.userId))
        .where(eq(campaignMembers.campaignId, campaignId))
        .orderBy(campaignMembers.joinedAt),
      db.select().from(maps).where(eq(maps.campaignId, campaignId)).orderBy(maps.createdAt, maps.id),
      db.select().from(tokens).where(eq(tokens.campaignId, campaignId)).orderBy(tokens.createdAt, tokens.id),
      db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.campaignId, campaignId))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(CHAT_HISTORY),
      pendingUndo(db, campaignId),
    ]);
    const state: ServerState = {
      campaign: {
        id: c.id,
        name: c.name,
        rulesVersion: c.rulesVersion,
        allowMixedVersions: c.allowMixedVersions,
        defaultMapId: c.defaultMapId,
        playersCanMove: c.playersCanMove,
      },
      members: memberRows.map((m) => ({ ...m, role: m.role as Role })),
      maps: mapRows.map((m) => ({
        id: m.id,
        name: m.name,
        imageKey: m.imageKey,
        imageUrl: imageUrl(m.imageKey),
        width: m.width,
        height: m.height,
        gridSize: m.gridSize,
        gridOffsetX: m.gridOffsetX,
        gridOffsetY: m.gridOffsetY,
      })),
      tokens: tokenRows.map((t) => ({
        id: t.id,
        mapId: t.mapId,
        name: t.name,
        x: t.x,
        y: t.y,
        size: t.size,
        color: t.color,
        imageKey: t.imageKey,
        imageUrl: imageUrl(t.imageKey),
        layer: t.layer as Layer,
        ownerIds: t.ownerIds,
      })),
      chat: chatRows.reverse().map((m) => ({
        id: m.id,
        authorId: m.authorId,
        kind: m.kind as ChatMessage['kind'],
        text: m.text,
        label: m.label,
        rolls: m.rolls as RollResult[],
        secret: m.secret,
        recipients: m.recipients,
        undone: m.undone,
        createdAt: m.createdAt.toISOString(),
      })),
    };
    return new CampaignRoom(db, campaignId, rng, state, pending);
  }

  /** Full internal state. Callers must treat it as read-only. */
  state(): ServerState {
    return this.current;
  }

  isMember(userId: string): boolean {
    return this.current.members.some((m) => m.userId === userId);
  }

  /** True while the campaign has an action that was not undone yet. */
  canUndo(): boolean {
    return this.undoable;
  }

  /** Runs one action at a time per room, in arrival order. */
  dispatch(actor: Actor, action: Action): Promise<DispatchOk | DispatchErr> {
    const result = this.queue.then(() => this.run(actor, action));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async run(actor: Actor, input: Action): Promise<DispatchOk | DispatchErr> {
    const parsed = ActionSchema.safeParse(input);
    if (!parsed.success) return fail('invalid', 'Ação inválida.');
    const action = parsed.data;
    const member = this.current.members.find((m) => m.userId === actor.userId);
    if (!member) return fail('forbidden', 'Você não é membro desta campanha.');
    try {
      if (action.type === 'undo') return await this.undo(member);
      const plan = await planAction(this.db, this.current, member, action, this.rng);
      if (!plan.ok) return plan;
      return await this.apply(actor, action, plan.change);
    } catch (err) {
      console.error(`[room ${this.campaignId}] ${action.type} failed`, err);
      return fail('internal', 'Erro interno.');
    }
  }

  /** Persists the change and its log row in one transaction, then updates memory. */
  private async apply(actor: Actor, action: Action, change: Change): Promise<DispatchOk> {
    const inverse = invert(this.current, change);
    const before = this.viewers();
    await this.db.transaction(async (tx) => {
      await persistChange(tx, this.campaignId, change);
      await tx.insert(actionLog).values({
        campaignId: this.campaignId,
        actorId: actor.userId,
        via: actor.via,
        type: action.type,
        payload: action,
        inverse,
      });
    });
    const events = applyChange(this.current, change);
    this.undoable = true;
    return this.ok(events, before);
  }

  private async undo(member: Member): Promise<DispatchOk | DispatchErr> {
    if (member.role !== 'gm') return fail('forbidden', 'Só o mestre pode desfazer.');
    const before = this.viewers();
    const done = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: actionLog.id, inverse: actionLog.inverse })
        .from(actionLog)
        .where(and(eq(actionLog.campaignId, this.campaignId), eq(actionLog.undone, false)))
        .orderBy(desc(actionLog.id))
        .limit(1);
      if (!row) return null;
      if (!row.inverse) throw new Error(`action_log ${row.id} has no inverse`);
      const inverse = row.inverse as InverseOp;
      await persistChange(tx, this.campaignId, inverse);
      await tx.update(actionLog).set({ undone: true }).where(eq(actionLog.id, row.id));
      return { inverse, more: await pendingUndo(tx, this.campaignId) };
    });
    if (!done) return fail('nothing_to_undo', 'Não há nada para desfazer.');
    const events = applyChange(this.current, done.inverse);
    this.undoable = done.more;
    return this.ok(events, before);
  }

  private ok(events: StateEvent[], before: Map<string, string>): DispatchOk {
    const after = this.viewers();
    const resnapshot = [...before].filter(([userId, view]) => after.get(userId) !== view).map(([userId]) => userId);
    return { ok: true, events: [...events, { type: 'undo.available', canUndo: this.undoable }], resnapshot };
  }

  /**
   * What each member can see, as a comparable key: a role change, a player's
   * effective map changing, or removal means that member needs a new snapshot.
   */
  private viewers(): Map<string, string> {
    const { members, campaign } = this.current;
    return new Map(
      members.map((m) => [m.userId, m.role === 'gm' ? 'gm' : `player:${effectiveMapId(m, campaign) ?? ''}`]),
    );
  }
}

async function pendingUndo(db: Db, campaignId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: actionLog.id })
    .from(actionLog)
    .where(and(eq(actionLog.campaignId, campaignId), eq(actionLog.undone, false)))
    .limit(1);
  return row !== undefined;
}
