import Fastify, { type FastifyInstance } from 'fastify';
import type { Rng } from '@rpgai/shared';
import type { DiscordClient } from './auth/discord';
import type { Config } from './config';
import type { Db } from './db/client';
import type { FileStore } from './files/store';

export interface AppDeps {
  config: Config;
  db: Db;
  discord: DiscordClient | null;
  files: FileStore;
  rng: Rng;
}

export async function buildApp(_deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}
