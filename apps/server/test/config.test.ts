import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const production = {
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://mesa.example.com',
  DATABASE_URL: 'postgres://rpgai:s3nha@db.example.com/rpgai',
  DISCORD_CLIENT_ID: 'id',
  DISCORD_CLIENT_SECRET: 'secret',
};
const without = (key: keyof typeof production) => {
  const { [key]: _removed, ...rest } = production;
  return rest;
};

describe('loadConfig em produção', () => {
  it('aceita a configuração completa', () => {
    expect(loadConfig(production)).toMatchObject({
      production: true,
      publicUrl: 'https://mesa.example.com',
      databaseUrl: production.DATABASE_URL,
      discord: { clientId: 'id', clientSecret: 'secret' },
    });
    expect(loadConfig({ ...production, DATABASE_URL: 'postgresql://db/rpgai' }).databaseUrl).toBe('postgresql://db/rpgai');
  });
  it.each(['PUBLIC_URL', 'DATABASE_URL', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'] as const)('recusa subir sem %s, nomeando a variável', (key) => {
    expect(() => loadConfig(without(key))).toThrow(key);
  });
  it('recusa banco que não seja Postgres', () => {
    expect(() => loadConfig({ ...production, DATABASE_URL: 'pglite:./data/prod' })).toThrow('DATABASE_URL');
  });
  it('lista tudo o que falta de uma vez e não repete valores secretos', () => {
    const load = () => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'pglite:s3nha', DISCORD_CLIENT_SECRET: 's3nha' });
    expect(load).toThrow(/PUBLIC_URL.*DATABASE_URL.*DISCORD_CLIENT_ID/s);
    expect(load).not.toThrow(/s3nha/);
  });
  it('login de desenvolvimento fica desligado mesmo com DEV_LOGIN=true', () => {
    expect(loadConfig({ ...production, DEV_LOGIN: 'true' }).devLogin).toBe(false);
  });
});

describe('loadConfig', () => {
  it('tira a barra final de PUBLIC_URL, em produção ou não', () => {
    expect(loadConfig({ ...production, PUBLIC_URL: 'https://mesa.example.com/' }).publicUrl).toBe('https://mesa.example.com');
    expect(loadConfig({ PUBLIC_URL: 'http://localhost:3000/' }).publicUrl).toBe('http://localhost:3000');
  });
  it('fora de produção usa os padrões de desenvolvimento e aceita DEV_LOGIN', () => {
    const config = loadConfig({ DEV_LOGIN: 'true' });
    expect(config).toMatchObject({
      production: false,
      devLogin: true,
      publicUrl: 'http://localhost:5173',
      databaseUrl: 'pglite:./data/pglite',
      discord: null,
    });
  });
  it('o limite de upload por campanha vem em MB, com padrão de 500', () => {
    expect(loadConfig({}).maxCampaignUploadBytes).toBe(500 * 1024 * 1024);
    expect(loadConfig({ MAX_CAMPAIGN_UPLOAD_MB: '2' }).maxCampaignUploadBytes).toBe(2 * 1024 * 1024);
  });
});
