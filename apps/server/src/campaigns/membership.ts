import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { campaignMembers } from '../db/schema';

export type Role = 'gm' | 'player';

export async function getMembership(
  db: Db,
  campaignId: string,
  userId: string,
): Promise<{ role: Role } | null> {
  const [row] = await db
    .select({ role: campaignMembers.role })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)));
  return row ? { role: row.role as Role } : null;
}
