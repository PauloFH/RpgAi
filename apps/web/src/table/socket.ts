import type { Action, ClientMessage, ErrorCode, ServerMessage } from '@rpgai/shared';

export class ActionError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

export interface TableConnection {
  send(action: Action): Promise<void>;
  close(): void;
}

export interface TableHandlers {
  onMessage(m: ServerMessage): void;
  onStatus(s: 'connecting' | 'online' | 'offline'): void;
  onClosed?(code: number): void;
}

const BACKOFF_MS = [1000, 2000, 5000];
const NO_RECONNECT = new Set([4401, 4403]);

interface Pending { resolve(): void; reject(e: ActionError): void }

export function connectTable(url: string, handlers: TableHandlers, WS: typeof WebSocket = WebSocket): TableConnection {
  const pending = new Map<string, Pending>();
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  const rejectAll = () => {
    const all = [...pending.values()];
    pending.clear();
    for (const p of all) p.reject(new ActionError('internal'));
  };

  const open = () => {
    timer = null;
    handlers.onStatus('connecting');
    const ws = new WS(url);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      handlers.onStatus('online');
    };
    ws.onmessage = ev => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(ev.data)); } catch { return; }
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { t?: unknown }).t !== 'string') return;
      const msg = parsed as ServerMessage;
      if (msg.t === 'ack') {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p?.resolve();
        return;
      }
      if (msg.t === 'error' && msg.id !== null) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p?.reject(new ActionError(msg.code, msg.message || msg.code));
        return;
      }
      handlers.onMessage(msg);
    };
    ws.onclose = ev => {
      if (socket !== ws) return;
      socket = null;
      rejectAll();
      handlers.onStatus('offline');
      handlers.onClosed?.(ev.code);
      if (closed || NO_RECONNECT.has(ev.code)) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      attempt++;
      timer = setTimeout(open, delay);
    };
  };

  open();

  return {
    send(action) {
      if (!socket || socket.readyState !== WS.OPEN) return Promise.reject(new ActionError('internal'));
      const id = crypto.randomUUID();
      const msg: ClientMessage = { t: 'cmd', id, action };
      return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          socket!.send(JSON.stringify(msg));
        } catch {
          pending.delete(id);
          reject(new ActionError('internal'));
        }
      });
    },
    close() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      rejectAll();
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}
