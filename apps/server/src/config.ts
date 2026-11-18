import { z } from 'zod';

export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  uploadDir: string;
  maxUploadBytes: number;
  maxCampaignUploadBytes: number;
  devLogin: boolean;
  production: boolean;
  discord: { clientId: string; clientSecret: string } | null;
  webDist: string | null;
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('pglite:./data/pglite'),
  UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
  MAX_CAMPAIGN_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  DEV_LOGIN: z.string().optional(),
  NODE_ENV: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  WEB_DIST: z.string().optional(),
});

/** What production may not run without: the defaults above only make sense on a dev machine. */
function missingInProduction(env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if (!env.PUBLIC_URL) missing.push('PUBLIC_URL');
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')) missing.push('DATABASE_URL (uma URL postgres://)');
  if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
  if (!env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
  return missing;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  const production = e.NODE_ENV === 'production';
  if (production) {
    const missing = missingInProduction(env);
    if (missing.length > 0) throw new Error(`Configuração de produção incompleta: ${missing.join(', ')}`);
  }
  return {
    port: e.PORT,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
    databaseUrl: e.DATABASE_URL,
    uploadDir: e.UPLOAD_DIR,
    maxUploadBytes: 20 * 1024 * 1024,
    maxCampaignUploadBytes: e.MAX_CAMPAIGN_UPLOAD_MB * 1024 * 1024,
    devLogin: e.DEV_LOGIN === 'true' && !production,
    production,
    discord:
      e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET
        ? { clientId: e.DISCORD_CLIENT_ID, clientSecret: e.DISCORD_CLIENT_SECRET }
        : null,
    webDist: e.WEB_DIST || null,
  };
}
