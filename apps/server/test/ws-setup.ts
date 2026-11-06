import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';
import WebSocket from 'ws';
import { setup } from './room-setup';

const NEXT_TIMEOUT_MS = 2000;

const sockets = new Set<WebSocket>();
afterEach(() => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
});

// Protocol messages are read loosely on purpose: tests assert their shape.
type Message = any;

export interface TestClient {
  send(message: object): void;
  raw(data: string | Buffer): void;
  /** Next message matching `pred`, in arrival order; earlier non-matching ones are discarded. */
  next(pred?: (message: Message) => boolean): Promise<Message>;
  /** Messages received and not consumed yet. */
  unread(): Message[];
  close(): void;
  /** The close code, once the socket is closed. */
  closed(): Promise<number>;
}

export function connect(url: string, cookie: string, campaignId: string, origin?: string): Promise<TestClient> {
  const socket = new WebSocket(`${url}?campaign=${encodeURIComponent(campaignId)}`, {
    headers: cookie ? { cookie } : {},
    ...(origin ? { origin } : {}),
  });
  sockets.add(socket);

  const inbox: Message[] = [];
  let wake: (() => void) | null = null;
  socket.on('message', (data) => {
    inbox.push(JSON.parse(data.toString()));
    wake?.();
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));

  const client: TestClient = {
    send: (message) => socket.send(JSON.stringify(message)),
    raw: (data) => socket.send(data),
    next: (pred = () => true) =>
      new Promise((resolve, reject) => {
        const discarded: Message[] = [];
        const take = () => {
          while (inbox.length > 0) {
            const message = inbox.shift();
            if (pred(message)) {
              resolve(message);
              return true;
            }
            discarded.push(message);
          }
          return false;
        };
        if (take()) return;
        const timer = setTimeout(() => {
          wake = null;
          reject(new Error(`no matching message in ${NEXT_TIMEOUT_MS} ms; discarded: ${JSON.stringify(discarded)}`));
        }, NEXT_TIMEOUT_MS);
        wake = () => {
          if (!take()) return;
          clearTimeout(timer);
          wake = null;
        };
      }),
    unread: () => [...inbox],
    close: () => socket.close(),
    closed: () => closed,
  };

  return new Promise((resolve, reject) => {
    // A refused connection still opens first: the server closes it with a code.
    socket.once('open', () => resolve(client));
    socket.on('error', reject);
  });
}

export async function closeCode(url: string, cookie: string, campaignId: string): Promise<number> {
  return (await connect(url, cookie, campaignId)).closed();
}

/** A listening app with one campaign, its map(s) and both members connected. */
export async function wsSetup(opts: { secondMap?: boolean } = {}) {
  const base = await setup(opts);
  const { t, campaignId, gmSession, player } = base;
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = t.app.server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${port}/ws`;

  const gm = await connect(url, gmSession.cookie, campaignId);
  const pl = await connect(url, player.cookie, campaignId);

  return {
    t,
    url,
    campaignId,
    gm,
    pl,
    gmSession,
    player,
    m1: base.m1,
    m2: base.m2,
    reconnectPlayer: () => connect(url, player.cookie, campaignId),
  };
}
