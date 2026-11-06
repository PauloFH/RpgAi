import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@rpgai/shared';
import { ActionError, connectTable } from './socket';

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  static count = 0;
  readyState = 0;
  sentIds: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeWS.last = this; FakeWS.count++; }
  send(data: string) { this.sentIds.push(JSON.parse(data).id); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}
const WS = FakeWS as unknown as typeof WebSocket;

let handlers: { onMessage: ReturnType<typeof vi.fn>; onStatus: ReturnType<typeof vi.fn>; onClosed: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  FakeWS.count = 0;
  handlers = { onMessage: vi.fn(), onStatus: vi.fn(), onClosed: vi.fn() };
});
afterEach(() => { vi.useRealTimers(); });

describe('connectTable', () => {
  it('send resolve no ack e rejeita no erro', async () => {
    const conn = connectTable('ws://x', handlers, WS); FakeWS.last.open();
    const p1 = conn.send({ type: 'undo' });
    FakeWS.last.receive({ t: 'ack', id: FakeWS.last.sentIds[0] });
    await expect(p1).resolves.toBeUndefined();
    const p2 = conn.send({ type: 'undo' });
    FakeWS.last.receive({ t: 'error', id: FakeWS.last.sentIds[1], code: 'forbidden', message: '' });
    await expect(p2).rejects.toMatchObject({ code: 'forbidden' });
    await expect(p2).rejects.toBeInstanceOf(ActionError);
    conn.close();
  });

  it('reconecta apos cair e nao reconecta apos 4403', () => {
    const conn = connectTable('ws://x', handlers, WS); const first = FakeWS.last; first.open();
    first.close(1006); vi.advanceTimersByTime(1000);
    expect(FakeWS.last).not.toBe(first);
    const second = FakeWS.last; second.open(); second.close(4403); vi.advanceTimersByTime(10000);
    expect(FakeWS.last).toBe(second);
    expect(handlers.onClosed).toHaveBeenCalledWith(1006);
    expect(handlers.onClosed).toHaveBeenCalledWith(4403);
    conn.close();
  });

  it('4401 nao reconecta e 4408 reconecta', () => {
    const conn = connectTable('ws://x', handlers, WS); FakeWS.last.open();
    FakeWS.last.close(4408); vi.advanceTimersByTime(1000);
    expect(FakeWS.count).toBe(2);
    FakeWS.last.open(); FakeWS.last.close(4401); vi.advanceTimersByTime(10000);
    expect(FakeWS.count).toBe(2);
    conn.close();
  });

  it('backoff 1s, 2s, 5s e reinicia apos abrir', () => {
    const conn = connectTable('ws://x', handlers, WS);
    FakeWS.last.close(1006); vi.advanceTimersByTime(999); expect(FakeWS.count).toBe(1);
    vi.advanceTimersByTime(1); expect(FakeWS.count).toBe(2);
    FakeWS.last.close(1006); vi.advanceTimersByTime(1999); expect(FakeWS.count).toBe(2);
    vi.advanceTimersByTime(1); expect(FakeWS.count).toBe(3);
    FakeWS.last.close(1006); vi.advanceTimersByTime(4999); expect(FakeWS.count).toBe(3);
    vi.advanceTimersByTime(1); expect(FakeWS.count).toBe(4);
    FakeWS.last.close(1006); vi.advanceTimersByTime(5000); expect(FakeWS.count).toBe(5);
    FakeWS.last.open();
    FakeWS.last.close(1006); vi.advanceTimersByTime(1000); expect(FakeWS.count).toBe(6);
    conn.close();
  });

  it('cair rejeita pendentes e avisa o status', async () => {
    const conn = connectTable('ws://x', handlers, WS); FakeWS.last.open();
    expect(handlers.onStatus).toHaveBeenLastCalledWith('online');
    const p = conn.send({ type: 'undo' });
    FakeWS.last.close(1006);
    await expect(p).rejects.toMatchObject({ code: 'internal' });
    expect(handlers.onStatus).toHaveBeenLastCalledWith('offline');
    conn.close();
  });

  it('send fora de conexao aberta rejeita na hora', async () => {
    const conn = connectTable('ws://x', handlers, WS);
    await expect(conn.send({ type: 'undo' })).rejects.toMatchObject({ code: 'internal' });
    expect(FakeWS.last.sentIds).toEqual([]);
    conn.close();
  });

  it('close cancela a reconexao e rejeita pendentes', async () => {
    const conn = connectTable('ws://x', handlers, WS); FakeWS.last.open();
    const p = conn.send({ type: 'undo' });
    conn.close();
    await expect(p).rejects.toMatchObject({ code: 'internal' });
    FakeWS.last.close(1006); vi.advanceTimersByTime(10000);
    expect(FakeWS.count).toBe(1);
    const conn2 = connectTable('ws://x', handlers, WS);
    FakeWS.last.close(1006); conn2.close(); vi.advanceTimersByTime(10000);
    expect(FakeWS.count).toBe(2);
  });

  it('mensagem malformada nao chega ao handler nem lanca', () => {
    const conn = connectTable('ws://x', handlers, WS); FakeWS.last.open();
    for (const data of ['null', '5', '"x"', '{}', '{"t":1}']) {
      expect(() => FakeWS.last.onmessage?.({ data })).not.toThrow();
    }
    expect(handlers.onMessage).not.toHaveBeenCalled();
    const ok: ServerMessage = { t: 'event', event: { type: 'undo.available', canUndo: true } };
    FakeWS.last.receive(ok);
    expect(handlers.onMessage).toHaveBeenCalledWith(ok);
    conn.close();
  });

  it('repassa mensagens, inclusive erro sem id, e ignora lixo', () => {
    const conn = connectTable('ws://x', handlers, WS); FakeWS.last.open();
    const err: ServerMessage = { t: 'error', id: null, code: 'invalid', message: 'x' };
    FakeWS.last.receive(err);
    expect(handlers.onMessage).toHaveBeenCalledWith(err);
    FakeWS.last.onmessage?.({ data: 'nao json' });
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);
    conn.close();
  });
});
