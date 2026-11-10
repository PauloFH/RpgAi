import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { users } from '../db/schema';
import type { TableHub } from '../table/hub';
import {
  createSession,
  deleteSession,
  requireUser,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from './sessions';

const DevLoginBody = z.object({ name: z.string().trim().min(1).max(80) });
const CallbackQuery = z.object({
  state: z.string().min(1),
  code: z.string().min(1).optional(),
  error: z.string().optional(),
});

export async function registerAuthRoutes(app: FastifyInstance, deps: AppDeps, table: TableHub): Promise<void> {
  const { config, db, discord } = deps;
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.production,
    path: '/',
  };
  const redirectUri = `${config.publicUrl}/auth/discord/callback`;

  type LoginError = 'access_denied' | 'bad_state' | 'discord_error' | 'discord_not_configured';
  const loginFailed = (reply: FastifyReply, code: LoginError) => reply.redirect(`/?login_error=${code}`);

  const startSession = async (reply: FastifyReply, userId: string) => {
    const token = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieBase, maxAge: SESSION_MAX_AGE_SECONDS });
  };

  if (config.devLogin) {
    app.post('/auth/dev-login', async (req, reply) => {
      const parsed = DevLoginBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
      const name = parsed.data.name;
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.displayName, name), isNull(users.discordId)))
        .limit(1);
      const userId =
        existing?.id ??
        (await db.insert(users).values({ displayName: name }).returning({ id: users.id }))[0]!.id;
      await startSession(reply, userId);
      return { userId };
    });
  }

  app.get('/auth/discord', async (_req, reply) => {
    if (!discord) return loginFailed(reply, 'discord_not_configured');
    const state = randomBytes(16).toString('hex');
    reply.setCookie('oauth_state', state, { ...cookieBase, maxAge: 600 });
    return reply.redirect(discord.authorizeUrl(state, redirectUri));
  });

  app.get('/auth/discord/callback', async (req, reply) => {
    if (!discord) return loginFailed(reply, 'discord_not_configured');
    const query = CallbackQuery.safeParse(req.query);
    const expected = req.cookies.oauth_state;
    // Checked before anything else in the URL: without the right state, none of it is from Discord.
    if (!query.success || !expected || query.data.state !== expected) return loginFailed(reply, 'bad_state');
    const { code, error } = query.data;
    if (error) {
      reply.clearCookie('oauth_state', { path: '/' });
      if (error === 'access_denied') return loginFailed(reply, 'access_denied');
      app.log.error({ error }, 'discord refused the login');
      return loginFailed(reply, 'discord_error');
    }
    if (!code) return loginFailed(reply, 'bad_state');
    reply.clearCookie('oauth_state', { path: '/' });
    let profile;
    try {
      const accessToken = await discord.exchangeCode(code, redirectUri);
      profile = await discord.getUser(accessToken);
    } catch (err) {
      app.log.error({ err }, 'discord login failed');
      return loginFailed(reply, 'discord_error');
    }
    const displayName = profile.global_name ?? profile.username;
    const avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
      : null;
    const [user] = await db
      .insert(users)
      .values({ discordId: profile.id, displayName, avatarUrl })
      .onConflictDoUpdate({ target: users.discordId, set: { displayName, avatarUrl } })
      .returning({ id: users.id });
    await startSession(reply, user!.id);
    return reply.redirect('/');
  });

  app.get('/api/me', { preHandler: requireUser(db) }, async (req) => req.user);

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const userId = token ? await deleteSession(db, token) : null;
    if (userId) table.disconnectUser(userId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
