import { cryptoRng } from '@rpgai/shared';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb, runMigrations } from './db/client';

const config = loadConfig();
const { db } = await createDb(config.databaseUrl);
await runMigrations(db);
const app = await buildApp({ config, db, discord: null, files: {}, rng: cryptoRng });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`RpgAi server listening on port ${config.port}`);
