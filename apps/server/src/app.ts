import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import type { Rng } from '@rpgai/shared';
import type { DiscordClient } from './auth/discord';
import { registerAuthRoutes } from './auth/routes';
import { registerCampaignRoutes } from './campaigns/routes';
import { registerFileRoutes } from './files/routes';
import type { Config } from './config';
import type { Db } from './db/client';
import type { FileStore } from './files/store';
import { RoomRegistry } from './table/registry';
import { TableHub } from './table/hub';
import { registerTableSocket } from './table/ws';

export interface AppDeps {
  config: Config;
  db: Db;
  discord: DiscordClient | null;
  files: FileStore;
  rng: Rng;
}

/** Fastify's default request log has the query string, and the Discord callback carries its code there. */
export const PRODUCTION_LOGGER = {
  serializers: {
    req: (req: { method: string; url: string; ip?: string }) => ({
      method: req.method,
      url: req.url.split('?')[0],
      remoteAddress: req.ip,
    }),
  },
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.production ? PRODUCTION_LOGGER : false });
  await app.register(cookie);
  const table = new TableHub(new RoomRegistry(deps.db, deps.rng));
  // First, so the websocket plugin also guards upgrade requests to the routes below.
  await registerTableSocket(app, deps, table);
  app.get('/api/health', async () => ({ ok: true }));
  await registerAuthRoutes(app, deps, table);
  await registerCampaignRoutes(app, deps, table);
  await registerFileRoutes(app, deps);
  if (deps.config.webDist) await registerWebApp(app, deps.config.webDist);
  return app;
}

const SERVER_PREFIXES = ['/api', '/auth', '/files', '/ws'];

function isServerPath(url: string): boolean {
  const path = url.split('?')[0]!;
  return SERVER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

async function registerWebApp(app: FastifyInstance, webDist: string): Promise<void> {
  await app.register(fastifyStatic, { root: resolve(webDist), wildcard: false });
  app.get('/*', async (req, reply) => {
    if (isServerPath(req.url)) return reply.callNotFound();
    return reply.sendFile('index.html');
  });
}
