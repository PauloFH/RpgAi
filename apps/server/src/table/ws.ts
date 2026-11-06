import websocket, { type WebSocket } from '@fastify/websocket';
import { ActionSchema, type Action } from '@rpgai/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData } from 'ws';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { userFromRequest } from '../auth/sessions';
import { getMembership } from '../campaigns/membership';
import type { Db } from '../db/client';
import { CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED, send, snapshot, type Seat, type TableHub } from './hub';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PENDING_MESSAGES = 256;
const DRAIN_TIMEOUT_MS = 5000;
const CLOSE_INTERNAL = 1011;
const CLOSE_TOO_MANY_MESSAGES = 4408;

const CampaignId = z.string().uuid();
const WithId = z.object({ id: z.string() });
const Command = z.object({ t: z.literal('cmd'), id: z.string(), action: ActionSchema }).strict();

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
    return await room.enqueue(async () => {
      if (!room.isMember(user.id)) {
        socket.close(CLOSE_FORBIDDEN, 'forbidden');
        return null;
      }
      const seat: Seat = { socket, room, userId: user.id, revoked: false };
      // A socket that closed meanwhile is not seated, but what it sent still runs.
      if (socket.readyState === socket.OPEN) {
        hub.add(seat);
        socket.once('close', () => hub.remove(seat));
      }
      // Seated first, then the session again: a logout since the check above either
      // is seen here or, if it comes later, finds this seat to disconnect.
      if (!(await userFromRequest(db, req))) {
        hub.remove(seat);
        socket.close(CLOSE_UNAUTHENTICATED, 'unauthenticated');
        return null;
      }
      send(socket, snapshot(room, user.id));
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

export async function registerTableSocket(app: FastifyInstance, { db, config }: AppDeps, hub: TableHub): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });
  const siteOrigin = new URL(config.publicUrl).origin;

  // Closing the app waits a bounded time for these, so that normally nothing still
  // uses the database after it, and a stuck one cannot hold the shutdown forever.
  const inFlight = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
    return work;
  };
  app.addHook('onClose', async () => {
    const drain = async () => {
      while (inFlight.size > 0) await Promise.all(inFlight);
      return true;
    };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), DRAIN_TIMEOUT_MS);
    });
    const drained = await Promise.race([drain(), timeout]);
    clearTimeout(timer);
    if (!drained) console.error(`[ws] closing with ${inFlight.size} message(s) still running`);
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    // CORS does not apply to WebSockets and sibling subdomains get the cookie. An
    // absent Origin is not a browser, so there is no ambient cookie to protect.
    const { origin } = req.headers;
    if (origin !== undefined && origin !== siteOrigin) {
      socket.close(CLOSE_FORBIDDEN, 'forbidden');
      return;
    }
    // Taking the seat is asynchronous, so the message listener goes on right now and
    // each message waits its turn behind it: what is sent just after opening is not
    // lost, and one connection's commands run in arrival order.
    let turn = track(takeSeat(db, hub, socket, req));
    let pending = 0;
    socket.on('message', (data, isBinary) => {
      if (socket.readyState !== socket.OPEN) return;
      if (pending >= MAX_PENDING_MESSAGES) {
        socket.close(CLOSE_TOO_MANY_MESSAGES, 'too many messages');
        return;
      }
      pending++;
      turn = track(
        turn.then(async (seat) => {
          if (seat && !seat.revoked) await handleMessage(hub, seat, data, isBinary);
          pending--;
          return seat;
        }),
      );
    });
  });
}
