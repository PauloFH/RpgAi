import { cryptoRng } from '@rpgai/shared';
import { buildApp } from './app';
import { createDiscordClient } from './auth/discord';
import { loadConfig } from './config';
import { createDb, runMigrations } from './db/client';
import { createLocalFileStore } from './files/store';

const config = loadConfig();
const { db } = await createDb(config.databaseUrl);
await runMigrations(db, process.env.MIGRATIONS_DIR);
const discord = config.discord ? createDiscordClient(config.discord) : null;
const app = await buildApp({ config, db, discord, files: createLocalFileStore(config.uploadDir), rng: cryptoRng });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`RpgAi server listening on port ${config.port}`);
