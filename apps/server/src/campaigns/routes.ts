import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireUser } from '../auth/sessions';
import { campaignMembers, campaigns, invites } from '../db/schema';
import type { TableHub } from '../table/ws';
import { getMembership } from './membership';

const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  rulesVersion: z.enum(['2014', '2024']),
  allowMixedVersions: z.boolean().optional(),
});
const Uuid = z.string().uuid();

export async function registerCampaignRoutes(app: FastifyInstance, deps: AppDeps, table: TableHub): Promise<void> {
  const { db, config } = deps;
  const auth = { preHandler: requireUser(db) };

  app.get('/api/campaigns', auth, async (req) => {
    return db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        role: campaignMembers.role,
        rulesVersion: campaigns.rulesVersion,
      })
      .from(campaignMembers)
      .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
      .where(eq(campaignMembers.userId, req.user!.id))
      .orderBy(desc(campaignMembers.joinedAt));
  });

  app.post('/api/campaigns', auth, async (req, reply) => {
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid' });
    const id = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(campaigns)
        .values({
          name: body.data.name,
          rulesVersion: body.data.rulesVersion,
          allowMixedVersions: body.data.allowMixedVersions ?? false,
        })
        .returning({ id: campaigns.id });
      await tx
        .insert(campaignMembers)
        .values({ campaignId: c!.id, userId: req.user!.id, role: 'gm' });
      return c!.id;
    });
    return reply.code(201).send({ id });
  });

  app.post('/api/campaigns/:id/invites', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const member = Uuid.safeParse(id).success ? await getMembership(db, id, req.user!.id) : null;
    if (!member) return reply.code(404).send({ error: 'not_found' });
    if (member.role !== 'gm') return reply.code(403).send({ error: 'forbidden' });
    const token = randomBytes(24).toString('base64url');
    await db.insert(invites).values({ token, campaignId: id, createdBy: req.user!.id });
    return reply.code(201).send({ token, url: `${config.publicUrl}/convite/${token}` });
  });

  app.delete('/api/campaigns/:id/invites/:token', auth, async (req, reply) => {
    const { id, token } = req.params as { id: string; token: string };
    const member = Uuid.safeParse(id).success ? await getMembership(db, id, req.user!.id) : null;
    if (!member) return reply.code(404).send({ error: 'not_found' });
    if (member.role !== 'gm') return reply.code(403).send({ error: 'forbidden' });
    await db
      .update(invites)
      .set({ revoked: true })
      .where(and(eq(invites.token, token), eq(invites.campaignId, id)));
    return reply.code(204).send();
  });

  const findInvite = async (token: string) => {
    const [row] = await db
      .select({ campaignId: invites.campaignId, campaignName: campaigns.name })
      .from(invites)
      .innerJoin(campaigns, eq(campaigns.id, invites.campaignId))
      .where(and(eq(invites.token, token), eq(invites.revoked, false)));
    return row ?? null;
  };

  app.get('/api/invites/:token', auth, async (req, reply) => {
    const invite = await findInvite((req.params as { token: string }).token);
    if (!invite) return reply.code(404).send({ error: 'not_found' });
    const member = await getMembership(db, invite.campaignId, req.user!.id);
    return { ...invite, alreadyMember: member !== null };
  });

  app.post('/api/invites/:token/accept', auth, async (req, reply) => {
    const invite = await findInvite((req.params as { token: string }).token);
    if (!invite) return reply.code(404).send({ error: 'not_found' });
    const joined = await db
      .insert(campaignMembers)
      .values({ campaignId: invite.campaignId, userId: req.user!.id, role: 'player' })
      .onConflictDoNothing()
      .returning({ userId: campaignMembers.userId });
    if (joined.length > 0) await table.memberJoined(invite.campaignId, req.user!.id);
    return { campaignId: invite.campaignId };
  });
}
