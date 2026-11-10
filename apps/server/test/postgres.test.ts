import { desc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, runMigrations, type Db } from '../src/db/client';
import { actionLog, campaignMembers, campaigns, uploads, users } from '../src/db/schema';
import { CampaignRoom, type Actor } from '../src/table/room';

const url = process.env.TEST_DATABASE_URL;

/** The migrations name the public schema, so reruns need it empty, not a schema of their own. */
async function resetDatabase(db: Db): Promise<void> {
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
}

// Runs in CI, where a job provides the database. It wipes it, hence the check on the name.
describe.skipIf(!url)('Postgres de verdade', () => {
  it('migra do zero e faz uma ida e volta de ação e desfazer', { timeout: 30_000 }, async () => {
    if (!/test/i.test(new URL(url!).pathname)) throw new Error('TEST_DATABASE_URL must name a test database');
    const { db, close } = await createDb(url!);
    try {
      await resetDatabase(db);
      await runMigrations(db);
      await runMigrations(db); // a second run finds everything applied

      const [user] = await db.insert(users).values({ displayName: 'Mestre' }).returning();
      const [campaign] = await db.insert(campaigns).values({ name: 'Mesa', rulesVersion: '2024' }).returning();
      const campaignId = campaign!.id;
      await db.insert(campaignMembers).values({ campaignId, userId: user!.id, role: 'gm' });
      const imageKey = `${campaignId}/mapa.png`;
      await db.insert(uploads).values({ key: imageKey, campaignId, contentType: 'image/png', sizeBytes: 10, width: 700, height: 700 });

      const room = await CampaignRoom.load(db, campaignId, (faces) => faces);
      const gm: Actor = { userId: user!.id, via: 'web' };
      expect(await room.dispatch(gm, { type: 'map.create', name: 'Estalagem', imageKey })).toMatchObject({ ok: true });
      const mapId = room.state().maps[0]!.id;
      expect(
        await room.dispatch(gm, { type: 'token.create', mapId, name: 'Lia', x: 1, y: 2, size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [gm.userId] }),
      ).toMatchObject({ ok: true });
      expect(await room.dispatch(gm, { type: 'chat.send', text: '/r 1d20 Ataque' })).toMatchObject({ ok: true });

      // A fresh load reads back what the node-postgres driver wrote, json columns included.
      const reloaded = await CampaignRoom.load(db, campaignId, (faces) => faces);
      expect(reloaded.state().tokens).toEqual([expect.objectContaining({ name: 'Lia', ownerIds: [gm.userId] })]);
      expect(reloaded.state().chat).toEqual([expect.objectContaining({ label: 'Ataque', recipients: null, rolls: [expect.objectContaining({ total: 20 })] })]);

      expect(await room.dispatch(gm, { type: 'undo' })).toMatchObject({ ok: true }); // the roll
      expect(await room.dispatch(gm, { type: 'undo' })).toMatchObject({ ok: true }); // the token
      expect(room.state().tokens).toEqual([]);
      const afterUndo = await CampaignRoom.load(db, campaignId, (faces) => faces);
      expect(afterUndo.state().tokens).toEqual([]);
      expect(afterUndo.state().chat).toEqual([expect.objectContaining({ undone: true })]);

      const [last] = await db.select().from(actionLog).where(eq(actionLog.type, 'token.create')).orderBy(desc(actionLog.id));
      expect(last).toMatchObject({ undone: true, undoneBy: gm.userId, undoneVia: 'web', undoneAt: expect.any(Date) });
    } finally {
      await close();
    }
  });
});
