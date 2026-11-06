import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Rng } from '@rpgai/shared';
import type { DiscordClient } from './auth/discord';
import { registerAuthRoutes } from './auth/routes';
import { registerCampaignRoutes } from './campaigns/routes';
import { registerFileRoutes } from './files/routes';
import type { Config } from './config';
import type { Db } from './db/client';
import type { FileStore } from './files/store';
import { RoomRegistry } from './table/registry';
import { TableHub, registerTableSocket } from './table/ws';

export interface AppDeps {
  config: Config;
  db: Db;
  discord: DiscordClient | null;
  files: FileStore;
  rng: Rng;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const table = new TableHub(new RoomRegistry(deps.db, deps.rng));
  // First, so the websocket plugin also guards upgrade requests to the routes below.
  await registerTableSocket(app, deps, table);
  app.get('/api/health', async () => ({ ok: true }));
  await registerAuthRoutes(app, deps);
  await registerCampaignRoutes(app, deps, table);
  await registerFileRoutes(app, deps);
  return app;
}
