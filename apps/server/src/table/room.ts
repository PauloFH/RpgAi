import { and, desc, eq, type SQL } from 'drizzle-orm';
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
    const [memberRows, mapRows, tokenRows, chatRows] = await Promise.all([
      selectMembers(db, eq(campaignMembers.campaignId, campaignId)),
      db.select().from(maps).where(eq(maps.campaignId, campaignId)).orderBy(maps.createdAt, maps.id),
      db.select().from(tokens).where(eq(tokens.campaignId, campaignId)).orderBy(tokens.createdAt, tokens.id),
      db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.campaignId, campaignId))
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(CHAT_HISTORY),
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
      members: memberRows,
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
    const gmIds = state.members.filter((m) => m.role === 'gm').map((m) => m.userId);
    return new CampaignRoom(db, campaignId, rng, state, (await findUndoable(db, campaignId, anyOf(gmIds))) !== null);
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

  /**
   * Runs `task` when the room is idle, in arrival order with every action. Whoever
   * awaits the returned promise directly resumes before the next task starts, so
   * publishing a result right after the await keeps events in order.
   */
  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Runs one action at a time per room, in arrival order. */
  dispatch(actor: Actor, action: Action): Promise<DispatchOk | DispatchErr> {
    return this.enqueue(() => this.run(actor, action));
  }

  /**
   * Brings a member added outside the room (invite accepted) into its state.
   * Not an action: it has no action_log row and cannot be undone.
   */
  memberJoined(userId: string): Promise<StateEvent[]> {
    return this.enqueue(async () => {
      const [member] = await selectMembers(
        this.db,
        and(eq(campaignMembers.campaignId, this.campaignId), eq(campaignMembers.userId, userId)),
      );
      if (!member) return [];
      this.current.members = [...this.current.members.filter((m) => m.userId !== userId), member];
      return [{ type: 'member.upserted', member: { ...member } }];
    });
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
    this.undoable = (await findUndoable(this.db, this.campaignId, anyOf(this.gmIds()))) !== null;
    return this.ok(events, before);
  }

  private async undo(member: Member): Promise<DispatchOk | DispatchErr> {
    if (member.role !== 'gm') return fail('forbidden', 'Só o mestre pode desfazer.');
    const before = this.viewers();
    const done = await this.db.transaction(async (tx) => {
      const row = await findUndoable(tx, this.campaignId, anyOf([member.userId]));
      if (!row) return null;
      if (!row.inverse) throw new Error(`action_log ${row.id} has no inverse`);
      const inverse = row.inverse as InverseOp;
      await persistChange(tx, this.campaignId, inverse);
      await tx.update(actionLog).set({ undone: true }).where(eq(actionLog.id, row.id));
      return { inverse, more: (await findUndoable(tx, this.campaignId, anyOf(this.gmIds()))) !== null };
    });
    if (!done) return fail('nothing_to_undo', 'Não há nada para desfazer.');
    const events = applyChange(this.current, done.inverse);
    this.undoable = done.more;
    return this.ok(events, before);
  }

  private gmIds(): string[] {
    return this.current.members.filter((m) => m.role === 'gm').map((m) => m.userId);
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

async function selectMembers(db: Db, where: SQL | undefined): Promise<Member[]> {
  const rows = await db
    .select({
      userId: campaignMembers.userId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: campaignMembers.role,
      currentMapId: campaignMembers.currentMapId,
    })
    .from(campaignMembers)
    .innerJoin(users, eq(users.id, campaignMembers.userId))
    .where(where)
    .orderBy(campaignMembers.joinedAt);
  return rows.map((m) => ({ ...m, role: m.role as Role }));
}

/** True when a message with these recipients is visible to at least one of `userIds`. */
const anyOf = (userIds: string[]) => (recipients: string[] | null) =>
  recipients === null || userIds.some((id) => recipients.includes(id));

/**
 * The latest action not yet undone that the undoing GM may undo: any action except
 * a chat.send whose message that GM cannot see (e.g. a whisper between other members).
 * `canUndo` uses the same rule with "any GM" as the viewer.
 */
async function findUndoable(
  db: Db,
  campaignId: string,
  canSee: (recipients: string[] | null) => boolean,
): Promise<{ id: number; inverse: unknown } | null> {
  const rows = await db
    .select({ id: actionLog.id, type: actionLog.type, inverse: actionLog.inverse })
    .from(actionLog)
    .where(and(eq(actionLog.campaignId, campaignId), eq(actionLog.undone, false)))
    .orderBy(desc(actionLog.id));
  for (const row of rows) {
    if (row.type !== 'chat.send') return row;
    const messageId = (row.inverse as { messageId?: string } | null)?.messageId;
    if (!messageId) throw new Error(`action_log ${row.id} has no message id`);
    const [message] = await db
      .select({ recipients: chatMessages.recipients })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId));
    if (message && canSee(message.recipients)) return row;
  }
  return null;
}
