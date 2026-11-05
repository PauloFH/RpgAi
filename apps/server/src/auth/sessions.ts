import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AuthUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    idHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });
  return token;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.idHash, hashToken(token)));
}

export async function userFromRequest(db: Db, req: FastifyRequest): Promise<AuthUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const idHash = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.idHash, idHash));
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.idHash, idHash));
    return null;
  }
  return { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

export function requireUser(db: Db): preHandlerHookHandler {
  return async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    req.user = user;
  };
}
