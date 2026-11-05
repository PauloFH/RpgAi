import type { Rng } from '@rpgai/shared';
import type { Db } from '../db/client';
import { CampaignRoom } from './room';

/** Keeps one CampaignRoom per campaign in memory, loaded on first use. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Promise<CampaignRoom>>();

  constructor(
    private readonly db: Db,
    private readonly rng: Rng,
  ) {}

  get(campaignId: string): Promise<CampaignRoom> {
    const cached = this.rooms.get(campaignId);
    if (cached) return cached;
    const room = CampaignRoom.load(this.db, campaignId, this.rng);
    // A failed load must not stay cached, so the next call can retry.
    room.catch(() => {
      if (this.rooms.get(campaignId) === room) this.rooms.delete(campaignId);
    });
    this.rooms.set(campaignId, room);
    return room;
  }
}
