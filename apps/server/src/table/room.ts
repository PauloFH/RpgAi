import { and, desc, eq, inArray, isNotNull, lt, type SQL } from 'drizzle-orm';
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

export const UNDO_PAGE_SIZE = 50;

export class CampaignRoom {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly db: Db,
    readonly campaignId: string,
    private readonly rng: Rng,
    private readonly current: ServerState,
    /** The GMs who have something to undo; see findUndoable. */
    private undoers: Set<string>,
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
    return new CampaignRoom(db, campaignId, rng, state, new Set((await findUndoable(db, campaignId, gmIds)).keys()));
  }

  /** Full internal state. Callers must treat it as read-only. */
  state(): ServerState {
    return this.current;
  }

  isMember(userId: string): boolean {
    return this.current.members.some((m) => m.userId === userId);
  }

  /** Whether this GM has an action to undo; without a GM, whether any of them has. */
  canUndo(gmId?: string): boolean {
    return gmId === undefined ? this.undoers.size > 0 : this.undoers.has(gmId);
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
    return this.enqueue(() => this.readMember(userId));
  }

  /** What memberJoined does, for a task already running in the queue: waiting on it would never end. */
  async readMember(userId: string): Promise<StateEvent[]> {
    const [member] = await selectMembers(
      this.db,
      and(eq(campaignMembers.campaignId, this.campaignId), eq(campaignMembers.userId, userId)),
    );
    if (!member) return [];
    this.current.members = [...this.current.members.filter((m) => m.userId !== userId), member];
    return [{ type: 'member.upserted', member: { ...member } }];
  }

  private async run(actor: Actor, input: Action): Promise<DispatchOk | DispatchErr> {
    const parsed = ActionSchema.safeParse(input);
    if (!parsed.success) return fail('invalid', 'Ação inválida.');
    const action = parsed.data;
    const member = this.current.members.find((m) => m.userId === actor.userId);
    if (!member) return fail('forbidden', 'Você não é membro desta campanha.');
    try {
      if (action.type === 'undo') return await this.undo(actor, member);
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
    await this.refreshUndoers();
    return this.ok(events, before);
  }

  /**
   * After the commit and with the new roster, since an undo can change who is a GM.
   * Committed and in memory: a failed read must not report the action as failed and
   * leave it unpublished. The previous value stands until the next successful read.
   */
  private async refreshUndoers(): Promise<void> {
    const gmIds = this.current.members.filter((m) => m.role === 'gm').map((m) => m.userId);
    try {
      this.undoers = new Set((await findUndoable(this.db, this.campaignId, gmIds)).keys());
    } catch (err) {
      console.error(`[room ${this.campaignId}] could not refresh canUndo`, err);
    }
  }

  private async undo(actor: Actor, member: Member): Promise<DispatchOk | DispatchErr> {
    if (member.role !== 'gm') return fail('forbidden', 'Só o mestre pode desfazer.');
    const before = this.viewers();
    const inverse = await this.db.transaction(async (tx) => {
      const row = (await findUndoable(tx, this.campaignId, [member.userId])).get(member.userId);
      if (!row) return null;
      const inverse = row.inverse as InverseOp;
      await persistChange(tx, this.campaignId, inverse);
      await tx
        .update(actionLog)
        .set({ undone: true, undoneBy: actor.userId, undoneVia: actor.via, undoneAt: new Date() })
        .where(eq(actionLog.id, row.id));
      return inverse;
    });
    if (!inverse) return fail('nothing_to_undo', 'Não há nada para desfazer.');
    const events = applyChange(this.current, inverse);
    await this.refreshUndoers();
    return this.ok(events, before);
  }

  private ok(events: StateEvent[], before: Map<string, string>): DispatchOk {
    const after = this.viewers();
    const resnapshot = [...before].filter(([userId, view]) => after.get(userId) !== view).map(([userId]) => userId);
    return { ok: true, events: [...events, { type: 'undo.available', canUndo: this.canUndo() }], resnapshot };
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

interface LogRow { id: number; type: string; inverse: unknown }

const messageIdOf = (row: LogRow): string => {
  const messageId = (row.inverse as { messageId?: string } | null)?.messageId;
  if (!messageId) throw new Error(`action_log ${row.id} has no message id`);
  return messageId;
};

/** Who can see the chat messages of these rows, by message id. */
async function recipientsOf(db: Db, rows: LogRow[]): Promise<Map<string, string[] | null>> {
  if (rows.length === 0) return new Map();
  const messages = await db
    .select({ id: chatMessages.id, recipients: chatMessages.recipients })
    .from(chatMessages)
    .where(inArray(chatMessages.id, rows.map(messageIdOf)));
  return new Map(messages.map((m) => [m.id, m.recipients]));
}

/**
 * For each of `gmIds` that has one, the latest action not yet undone that this GM may
 * undo: any action with an inverse (a text message without rolls has none), except a
 * chat.send whose message they cannot see (e.g. a whisper between other members). Reads the log from the newest, a page at a time, and stops
 * when every GM has an answer: usually the first page, however long the log is.
 */
async function findUndoable(db: Db, campaignId: string, gmIds: string[]): Promise<Map<string, LogRow>> {
  const found = new Map<string, LogRow>();
  let before: number | undefined;
  while (found.size < gmIds.length) {
    const rows: LogRow[] = await db
      .select({ id: actionLog.id, type: actionLog.type, inverse: actionLog.inverse })
      .from(actionLog)
      .where(
        and(
          eq(actionLog.campaignId, campaignId),
          eq(actionLog.undone, false),
          isNotNull(actionLog.inverse),
          before === undefined ? undefined : lt(actionLog.id, before),
        ),
      )
      .orderBy(desc(actionLog.id))
      .limit(UNDO_PAGE_SIZE);
    // Any other action settles every GM, so the messages after it do not matter.
    const firstOther = rows.findIndex((row) => row.type !== 'chat.send');
    const recipients = await recipientsOf(db, firstOther === -1 ? rows : rows.slice(0, firstOther));
    for (const row of rows) {
      const isChat = row.type === 'chat.send';
      const messageId = isChat ? messageIdOf(row) : '';
      for (const gmId of gmIds) {
        if (found.has(gmId)) continue;
        // A message no longer in the table is invisible to everyone.
        const audience = isChat ? recipients.get(messageId) : null;
        if (audience === null || audience?.includes(gmId)) found.set(gmId, row);
      }
      if (found.size === gmIds.length) break;
    }
    if (rows.length < UNDO_PAGE_SIZE) break;
    before = rows.at(-1)!.id;
  }
  return found;
}
