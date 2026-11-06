import type { WebSocket } from '@fastify/websocket';
import type { ServerMessage, StateEvent } from '@rpgai/shared';
import { projectEvent, snapshotFor, viewerFor } from './project';
import type { RoomRegistry } from './registry';
import type { CampaignRoom } from './room';

export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;
/** Above this, the client is not reading what it is sent: it would only pile up in memory. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** One open socket of a person at a campaign's table. */
export interface Seat {
  socket: WebSocket;
  room: CampaignRoom;
  userId: string;
  /** The person logged out: what this socket still had waiting must not run. */
  revoked: boolean;
}

/** A failure on one socket stays with that socket; closed sockets are skipped. */
export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }
  try {
    socket.send(JSON.stringify(message));
  } catch (err) {
    console.error('[ws] send failed', err);
  }
}

export function snapshot(room: CampaignRoom, userId: string): ServerMessage {
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

  /** Ends every connection of a person who logged out, in all their campaigns. */
  disconnectUser(userId: string): void {
    for (const seats of this.seats.values()) {
      for (const seat of seats) {
        if (seat.userId !== userId) continue;
        seat.revoked = true;
        this.remove(seat);
        seat.socket.close(CLOSE_UNAUTHENTICATED, 'unauthenticated');
      }
    }
  }
}
