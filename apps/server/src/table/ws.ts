import websocket, { type WebSocket } from '@fastify/websocket';
import { ActionSchema, type Action, type ServerMessage, type StateEvent } from '@rpgai/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData } from 'ws';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { userFromRequest } from '../auth/sessions';
import { getMembership } from '../campaigns/membership';
import type { Db } from '../db/client';
import { projectEvent, snapshotFor, viewerFor } from './project';
import type { RoomRegistry } from './registry';
import type { CampaignRoom } from './room';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_INTERNAL = 1011;

const CampaignId = z.string().uuid();
const WithId = z.object({ id: z.string() });
const Command = WithId.extend({ t: z.literal('cmd'), action: ActionSchema });

/** One open socket of a person at a campaign's table. */
interface Seat {
  socket: WebSocket;
  room: CampaignRoom;
  userId: string;
}

/** A failure on one socket stays with that socket; closed sockets are skipped. */
function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (err) {
    console.error('[ws] send failed', err);
  }
}

function snapshot(room: CampaignRoom, userId: string): ServerMessage {
  return { t: 'snapshot', state: snapshotFor(room.state(), userId, room.canUndo()) };
}

/** The open seats of each campaign, and what they receive when its room changes. */
export class TableHub {
  private readonly seats = new Map<string, Set<Seat>>();

  constructor(readonly registry: RoomRegistry) {}

  add(seat: Seat): void {
    const { campaignId } = seat.room;
    const seats = this.seats.get(campaignId) ?? new Set<Seat>();
    this.seats.set(campaignId, seats.add(seat));
  }

  remove(seat: Seat): void {
    const { campaignId } = seat.room;
    const seats = this.seats.get(campaignId);
    seats?.delete(seat);
    if (seats?.size === 0) this.seats.delete(campaignId);
  }

  /**
   * Sends one room change to each seat, as seen from the room's state right now, so
   * call it synchronously after the change resolves. People in `resnapshot` get a
   * fresh snapshot instead of the events; people no longer in the room are disconnected.
   */
  publish(room: CampaignRoom, events: StateEvent[], resnapshot: string[]): void {
    const state = room.state();
    for (const seat of this.seats.get(room.campaignId) ?? []) {
      try {
        const viewer = viewerFor(state, seat.userId);
        if (!viewer) {
          this.remove(seat);
          seat.socket.close(CLOSE_FORBIDDEN, 'forbidden');
        } else if (resnapshot.includes(seat.userId)) {
          send(seat.socket, snapshot(room, seat.userId));
        } else {
          for (const event of events) {
            const visible = projectEvent(event, viewer);
            if (visible) send(seat.socket, { t: 'event', event: visible });
          }
        }
      } catch (err) {
        console.error(`[ws] publish to ${seat.userId} failed`, err);
      }
    }
  }

  /**
   * A member was added to the database. A room that is not loaded will read them when
   * it loads; one that is must learn about them. The membership is already committed,
   * so a failure here is logged rather than failing the caller.
   */
  async memberJoined(campaignId: string, userId: string): Promise<void> {
    try {
      const room = await this.registry.peek(campaignId);
      if (!room) return;
      const events = await room.memberJoined(userId);
      this.publish(room, events, []);
    } catch (err) {
      console.error(`[ws] member ${userId} joined ${campaignId} but the room was not updated`, err);
    }
  }
}

/** Decides whether this socket may join the table and, if so, seats it. Never rejects. */
async function takeSeat(db: Db, hub: TableHub, socket: WebSocket, req: FastifyRequest): Promise<Seat | null> {
  try {
    const user = await userFromRequest(db, req);
    if (!user) {
      socket.close(CLOSE_UNAUTHENTICATED, 'unauthenticated');
      return null;
    }
    const campaignId = CampaignId.safeParse((req.query as { campaign?: unknown }).campaign);
    // Checked before the registry so that outsiders cannot make the server load a room.
    if (!campaignId.success || !(await getMembership(db, campaignId.data, user.id))) {
      socket.close(CLOSE_FORBIDDEN, 'forbidden');
      return null;
    }
    const room = await hub.registry.get(campaignId.data);
    // In the room's queue: between actions, the snapshot matches what was published,
    // so this seat neither misses an event nor gets one its snapshot already contains.
    return await room.enqueue(() => {
      if (!room.isMember(user.id)) {
        socket.close(CLOSE_FORBIDDEN, 'forbidden');
        return null;
      }
      const seat: Seat = { socket, room, userId: user.id };
      // A socket that closed meanwhile is not seated, but what it sent still runs.
      if (socket.readyState === socket.OPEN) {
        hub.add(seat);
        socket.once('close', () => hub.remove(seat));
        send(socket, snapshot(room, user.id));
      }
      return seat;
    });
  } catch (err) {
    console.error('[ws] connection failed', err);
    socket.close(CLOSE_INTERNAL, 'internal');
    return null;
  }
}

function parseCommand(data: RawData, isBinary: boolean): { id: string | null; action: Action | null } {
  if (isBinary) return { id: null, action: null };
  let value: unknown;
  try {
    value = JSON.parse(data.toString());
  } catch {
    return { id: null, action: null };
  }
  const command = Command.safeParse(value);
  if (command.success) return command.data;
  const withId = WithId.safeParse(value);
  return { id: withId.success ? withId.data.id : null, action: null };
}

/** Handles one message from a seated socket. Never rejects. */
async function handleMessage(hub: TableHub, seat: Seat, data: RawData, isBinary: boolean): Promise<void> {
  const { socket, room, userId } = seat;
  let id: string | null = null;
  try {
    const command = parseCommand(data, isBinary);
    id = command.id;
    if (id === null || command.action === null) {
      send(socket, { t: 'error', id, code: 'invalid', message: 'Mensagem inválida.' });
      return;
    }
    const result = await room.dispatch({ userId, via: 'web' }, command.action);
    if (!result.ok) {
      send(socket, { t: 'error', id, code: result.code, message: result.message });
      return;
    }
    send(socket, { t: 'ack', id });
    hub.publish(room, result.events, result.resnapshot);
  } catch (err) {
    console.error(`[ws] message from ${userId} failed`, err);
    send(socket, { t: 'error', id, code: 'internal', message: 'Erro interno.' });
  }
}

export async function registerTableSocket(app: FastifyInstance, { db }: AppDeps, hub: TableHub): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  // Closing the app waits for these, so nothing still uses the database after it.
  const inFlight = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
    return work;
  };
  app.addHook('onClose', async () => {
    while (inFlight.size > 0) await Promise.all(inFlight);
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    // Taking the seat is asynchronous, so the message listener goes on right now and
    // each message waits its turn behind it: what is sent just after opening is not
    // lost, and one connection's commands run in arrival order.
    let turn = track(takeSeat(db, hub, socket, req));
    socket.on('message', (data, isBinary) => {
      turn = track(
        turn.then(async (seat) => {
          if (seat) await handleMessage(hub, seat, data, isBinary);
          return seat;
        }),
      );
    });
  });
}
