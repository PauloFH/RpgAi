import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app';
import type { Config } from '../src/config';
import { createLocalFileStore } from '../src/files/store';
import { createDb, runMigrations, type Db } from '../src/db/client';

export function testConfig(): Config {
  return {
    port: 0,
    publicUrl: 'http://localhost:5173',
    databaseUrl: 'pglite:memory',
    uploadDir: mkdtempSync(join(tmpdir(), 'rpgai-uploads-')),
    maxUploadBytes: 20 * 1024 * 1024,
    devLogin: true,
    production: false,
    discord: null,
    webDist: null,
  };
}

export async function createTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<{ app: FastifyInstance; db: Db; deps: AppDeps; close(): Promise<void> }> {
  const owned = overrides.db ? null : await createDb('pglite:memory');
  const db = overrides.db ?? owned!.db;
  if (owned) await runMigrations(db);
  const config = overrides.config ?? testConfig();
  const deps: AppDeps = {
    discord: null,
    files: createLocalFileStore(config.uploadDir),
    rng: (faces) => faces,
    ...overrides,
    config,
    db,
  };
  const app = await buildApp(deps);
  let closing: Promise<void> | undefined;
  return {
    app,
    db,
    deps,
    close: () =>
      (closing ??= (async () => {
        await app.close();
        await owned?.close();
      })()),
  };
}

export async function login(
  app: FastifyInstance,
  name: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name } });
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (res.statusCode !== 200 || !sid) throw new Error(`dev-login failed: ${res.statusCode} ${res.body}`);
  return { cookie: `sid=${sid.value}`, userId: (res.json() as { userId: string }).userId };
}

export type Session = { cookie: string; userId: string };

export async function seedCampaign(
  t: { app: FastifyInstance },
): Promise<{ campaignId: string; gm: Session; player: Session }> {
  const gm = await login(t.app, 'Mestre');
  const player = await login(t.app, 'Lia');
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: { cookie: gm.cookie },
    payload: { name: 'Estalagem do Corvo', rulesVersion: '2024' },
  });
  const { id: campaignId } = created.json() as { id: string };
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/invites`,
    headers: { cookie: gm.cookie },
  });
  const { token } = invite.json() as { token: string };
  await t.app.inject({
    method: 'POST',
    url: `/api/invites/${token}/accept`,
    headers: { cookie: player.cookie },
  });
  return { campaignId, gm, player };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Valid 8-bit grayscale PNG built in memory. */
export function pngBuffer(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height); // filter byte 0 per row + pixels
  let seed = 1;
  for (let i = 0; i < raw.length; i++) {
    if (i % (width + 1) === 0) continue;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    raw[i] = seed >>> 24; // deterministic noise so the PNG does not compress away
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function uploadFile(
  app: FastifyInstance,
  cookie: string,
  campaignId: string,
  buffer: Buffer,
  filename: string,
) {
  const boundary = '----rpgai-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/uploads`,
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, buffer, tail]),
  });
}
