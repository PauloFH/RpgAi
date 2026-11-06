# RpgAi

Plataforma de RPG de mesa online: o mestre cria uma campanha, convida os jogadores e todos jogam numa mesa compartilhada com mapa em grade, tokens, chat e rolagem de dados em tempo real. Esta é a fundação (marco 1): contas via Discord, campanhas, convites, uploads de mapas e a mesa básica.

## Estrutura

- `apps/server`: API, WebSocket da mesa e banco (Fastify, Drizzle, PostgreSQL ou PGlite).
- `apps/web`: interface (React, Pixi.js, Vite).
- `packages/shared`: tipos e regras compartilhados.
- `docs`: especificação e planos.

## Desenvolvimento

Requer Node 22 ou superior.

```bash
npm install
DEV_LOGIN=true npm run dev
```

Isso sobe o servidor na porta 3000 e o Vite na porta 5173. Sem `DATABASE_URL`, o banco é um PGlite local em `./data/pglite`.

Abra exatamente `http://localhost:5173`. O WebSocket da mesa confere o cabeçalho `Origin` com `PUBLIC_URL` (padrão `http://localhost:5173`), então `http://127.0.0.1:5173` é recusado.

O login real exige um app no Discord (veja abaixo). Para desenvolver sem ele, `DEV_LOGIN=true` habilita `POST /auth/dev-login`, que só existe fora de produção (com `NODE_ENV=production` a rota fica desligada mesmo com `DEV_LOGIN=true`).

Comandos úteis:

```bash
npm test          # testes (vitest)
npm run typecheck
npm run build     # gera apps/web/dist e apps/server/dist/index.js
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor. |
| `PUBLIC_URL` | `http://localhost:5173` | URL pública do site; usada no redirect do Discord e na checagem de `Origin` do WebSocket. Obrigatória em produção. |
| `DATABASE_URL` | `pglite:./data/pglite` | `pglite:<pasta>`, `pglite:memory` ou uma URL `postgres://`. Em produção, obrigatória e só `postgres://`. |
| `UPLOAD_DIR` | `./data/uploads` | Pasta dos arquivos enviados (mapas, imagens). |
| `MAX_CAMPAIGN_UPLOAD_MB` | `500` | Espaço total de imagens por campanha, em MB. |
| `DEV_LOGIN` | desligado | `true` habilita `/auth/dev-login`; ignorado em produção. |
| `NODE_ENV` | | `production` ativa o modo de produção. |
| `DISCORD_CLIENT_ID` | | Client ID do app no Discord. Obrigatório em produção. |
| `DISCORD_CLIENT_SECRET` | | Client Secret do app no Discord. Obrigatório em produção. |
| `WEB_DIST` | | Pasta do build da interface; se definida, o servidor a serve junto com a API. |
| `MIGRATIONS_DIR` | `migrations` ao lado do bundle | Pasta das migrações SQL. |

## App no Discord

1. Em https://discord.com/developers/applications, crie uma aplicação.
2. Em OAuth2, adicione o redirect `PUBLIC_URL/auth/discord/callback` (por exemplo `http://localhost:5173/auth/discord/callback` em desenvolvimento).
3. O escopo usado é `identify`.
4. Copie o Client ID e o Client Secret para `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`.

## Produção

```bash
npm run build
NODE_ENV=production WEB_DIST=apps/web/dist PUBLIC_URL=https://mesa.exemplo.com \
  DATABASE_URL=postgres://usuario:senha@host:5432/rpgai DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... npm start
```

Com `NODE_ENV=production`, o servidor se recusa a subir sem `PUBLIC_URL`, sem uma `DATABASE_URL` `postgres://` ou sem as credenciais do Discord, e diz o que falta. O PGlite é só para desenvolvimento.

Servidor e interface saem numa só porta. Rotas fora de `/api`, `/auth`, `/files` e `/ws` devolvem o `index.html` da interface.

## Banco de dados

Depois de alterar o schema em `apps/server/src/db/schema.ts`, gere a migração:

```bash
npm run db:generate -w apps/server
```

As migrações rodam sozinhas na inicialização do servidor.

## Conteúdo e licenças

A atribuição CC-BY-4.0 do SRD 5.1 e 5.2 fica reservada para o marco 2, quando o compêndio entrar; até lá o projeto não inclui conteúdo do SRD.

## Material de pesquisa

Os notebooks de 2024 na raiz (`*.ipynb`, `ollama_+_unsloth_+_llama_3_+_alpaca.py` e `lostmine_dataset.json`) são material de pesquisa de experimentos anteriores com modelos de linguagem e não fazem parte da aplicação.
