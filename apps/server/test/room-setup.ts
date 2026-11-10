import { randomUUID } from 'node:crypto';
import type { Rng } from '@rpgai/shared';
import { afterEach } from 'vitest';
import { uploads } from '../src/db/schema';
import { CampaignRoom, type Actor } from '../src/table/room';
import { createTestApp, seedCampaign } from './helpers';

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((t) => t.close()));
});

export async function setup(opts: { secondMap?: boolean; rng?: Rng } = {}) {
  const t = await createTestApp(opts.rng ? { rng: opts.rng } : {});
  opened.push(t);
  const { campaignId, gm, player } = await seedCampaign(t);
  const keys = [`${campaignId}/${randomUUID()}.png`];
  if (opts.secondMap) keys.push(`${campaignId}/${randomUUID()}.png`);
  await t.db
    .insert(uploads)
    .values(keys.map((key) => ({ key, campaignId, contentType: 'image/png', sizeBytes: 1000, width: 700, height: 700 })));
  const room = await CampaignRoom.load(t.db, campaignId, t.deps.rng);
  const G: Actor = { userId: gm.userId, via: 'web' };
  const P: Actor = { userId: player.userId, via: 'web' };
  const createMap = async (name: string, imageKey: string) => {
    const r = await room.dispatch(G, { type: 'map.create', name, imageKey });
    if (!r.ok) throw new Error(`map.create failed: ${r.code}`);
    return room.state().maps.at(-1)!.id;
  };
  const m1 = await createMap('Estalagem', keys[0]!);
  const m2 = opts.secondMap ? await createMap('Floresta', keys[1]!) : undefined;
  // m2 only exists with `secondMap: true`; typed as string so tests can use it directly.
  return { t, room, G, P, m1, m2: m2 as string, campaignId, keys, gmSession: gm, player };
}
