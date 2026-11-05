# Fundação e mesa básica: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fase 0 e marco 1 da Fase 1: um mestre faz login com Discord, cria uma campanha, convida jogadores por link, sobe um mapa com grid, coloca tokens e todos movem tokens, conversam e rolam dados em tempo real, com o servidor como autoridade e desfazer linear.

**Architecture:** monorepo npm com três pacotes. `@rpgai/shared` tem os tipos, o esquema das ações, a visibilidade, o grid e os dados (puro, testável). `@rpgai/server` (Fastify) guarda tudo no PostgreSQL via Drizzle, processa cada ação numa "sala" por campanha (valida, aplica, grava com a ação inversa, transmite) e envia a cada pessoa só o que ela pode ver. `@rpgai/web` (Vite + React + PixiJS) mostra a mesa e manda ações pelo WebSocket.

**Tech Stack:** Node 24, TypeScript estrito, npm workspaces, Vitest, Zod, Fastify 5 (`@fastify/websocket`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/static`), Drizzle ORM com `pg` em produção e `@electric-sql/pglite` em desenvolvimento e testes, `image-size`, React 18, React Router 6, Zustand, PixiJS 8, Vite, tsx, tsup, concurrently. Use as versões estáveis atuais de cada pacote.

**Spec:** `docs/superpowers/specs/2026-11-05-mesa-com-batalha-design.md` (seções 1, 4, 5, 6.1 a 6.3, 6.5, 6.7, 6.12 e 7; marcos 0 e 1 da seção 8).

## Global Constraints

- TypeScript em todo o código; Node 24; `strict` e `noUncheckedIndexedAccess` ligados.
- Identificadores de código em inglês; todo texto visível na interface em português do Brasil, centralizado em `apps/web/src/i18n/pt-BR.ts`.
- Nome provisório do produto na interface: "RpgAi". Nunca usar "D&D", "Dungeons & Dragons", "Roll20" ou "Baldur's Gate" em interface, nomes ou textos.
- Toda mudança na mesa é uma `Action` validada e aplicada no servidor. O navegador nunca decide resultado. Dados são rolados no servidor com `crypto.randomInt`.
- O servidor nunca envia a uma pessoa o que ela não pode ver: tokens da camada `gm`, mapas em que o jogador não está, sussurros de outros, rolagens secretas.
- Desfazer é linear e só do mestre: desfaz a última ação ainda não desfeita da campanha. Mensagens desfeitas continuam no chat com `undone: true`.
- Toda ação grava em `action_log` quem fez e por onde (`via`: `web`, `api` ou `mcp`).
- Upload de imagem: no máximo 20 MB, apenas `image/png`, `image/jpeg`, `image/webp`, conferido pelo conteúdo do arquivo e não só pela extensão.
- Commits no formato `tipo: mensagem`, só a linha de título, sem escopo, sem body, sem `Co-Authored-By`.
- Desktop primeiro: a mesa não precisa ser confortável no celular.

## Review Focus

1. **Jogador que volta depois de cair** recebe a mesa atual inteira: tokens movidos enquanto estava fora, sem tokens fantasmas, e o mapa que o mestre escolheu para ele. Teste na Task 10.
2. **Jogador mandando ação proibida direto pelo WebSocket** (mover token alheio, renomear token, criar token, desfazer, mover com movimento travado) recebe `forbidden` e nada muda no estado nem no banco. Testes nas Tasks 8 e 10.
3. **Expressão de dados abusiva ou malformada** (`1000000d6`, `1d0`, texto enorme, lixo) volta como erro claro e rápido, sem travar o servidor. Testes nas Tasks 1 e 9.
4. **Token que passa para a camada do mestre ou mapa que deixa de ser do jogador** some da tela do jogador na hora, e esses dados nunca aparecem em snapshot dele. Testes nas Tasks 3, 9 e 10.
5. **Desfazer em situações-limite**: nada para desfazer, desfazer a exclusão de um mapa traz de volta os tokens com os mesmos ids, dois "desfazer" ao mesmo tempo desfazem uma ação só. Testes na Task 8.

---

## Estrutura de arquivos

```
package.json                      workspaces, scripts dev/build/test/typecheck
tsconfig.base.json                opções TS compartilhadas
vitest.workspace.ts               projetos de teste dos três pacotes
.github/workflows/ci.yml          typecheck, testes e build
packages/shared/src/
  index.ts                        reexporta tudo
  dice.ts                         parseDice, rollDice, DiceError
  chat.ts                         parseChat, ChatError
  grid.ts                         gridCols, gridRows, cellToPixel, pixelToCell
  types.ts                        estado da mesa, mensagens de protocolo
  actions.ts                      ActionSchema (Zod)
  visibility.ts                   effectiveMapId, canSeeMap, canSeeToken, canSeeMessage
apps/server/src/
  index.ts                        sobe o servidor de verdade
  app.ts                          buildApp(deps)
  config.ts                       loadConfig()
  db/schema.ts, db/client.ts      tabelas Drizzle, createDb, runMigrations
  db/migrations/                  geradas pelo drizzle-kit
  auth/sessions.ts, auth/discord.ts, auth/routes.ts
  campaigns/routes.ts             campanhas, membros, convites
  files/store.ts, files/routes.ts upload e leitura de arquivos
  table/room.ts                   CampaignRoom (estado, dispatch, undo)
  table/inverse.ts                InverseOp e aplicação
  table/chat.ts                   chat.send no servidor
  table/project.ts                projectEvent, snapshotFor
  table/registry.ts               RoomRegistry
  table/ws.ts                     rota WebSocket
apps/server/test/helpers.ts       createTestApp, login, seeds
apps/web/src/
  main.tsx, App.tsx               rotas
  api.ts                          cliente HTTP
  i18n/pt-BR.ts                   textos
  pages/HomePage.tsx, pages/InvitePage.tsx
  table/socket.ts                 connectTable
  table/store.ts                  reduceEvent, useTable
  table/MapCanvas.tsx             PixiJS
  table/ChatPanel.tsx, table/GmPanel.tsx, table/TablePage.tsx
```

---

### Task 1: Monorepo e motor de dados

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.github/workflows/ci.yml`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/dice.ts`
- Modify: `.gitignore` (adicionar `node_modules/`, `dist/`, `data/`)
- Test: `packages/shared/src/dice.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DiceTerm =
    | { kind: 'dice'; sign: 1 | -1; count: number; faces: number; keep?: { mode: 'h' | 'l'; n: number } }
    | { kind: 'const'; sign: 1 | -1; value: number };
  export interface DiceExpr { source: string; terms: DiceTerm[] }
  export type DiceErrorCode = 'syntax' | 'too_long' | 'too_many_dice' | 'bad_faces';
  export class DiceError extends Error { code: DiceErrorCode }
  export type Rng = (faces: number) => number; // inteiro de 1 a faces
  export const cryptoRng: Rng;                 // crypto.randomInt(1, faces + 1)
  export interface TermResult { term: DiceTerm; rolls: number[]; kept: number[]; subtotal: number }
  export interface RollResult { source: string; total: number; terms: TermResult[] }
  export function parseDice(source: string): DiceExpr;
  export function rollDice(expr: DiceExpr, rng: Rng): RollResult;
  ```
- Pacote `@rpgai/shared` com `"type": "module"` e `"exports": { ".": "./src/index.ts" }` (consumido como TypeScript por tsx, Vite, Vitest e tsup).
- Scripts na raiz: `test` = `vitest run`, `typecheck` = `npm run typecheck --workspaces --if-present`, `build` = `npm run build --workspaces --if-present`.

Gramática: termos separados por `+` ou `-`, espaços ignorados, sem distinção de maiúsculas. Termo de dado `[N]dF[kh|kl M]` (N omitido = 1). Limites: `source` até 200 caracteres (`too_long`), N de 1 a 100 por termo e no máximo 200 dados no total (`too_many_dice`), F de 2 a 1000 (`bad_faces`), M de 1 a N; qualquer outra coisa é `syntax`. `subtotal` = soma de `kept` vezes `sign`; `kept` vem ordenado do maior para o menor.

- [ ] **Step 1: Criar a raiz do monorepo** com os arquivos acima, workspaces `["packages/*", "apps/*"]`, `tsconfig.base.json` (`target` ES2022, `module` ESNext, `moduleResolution` Bundler, `strict`, `noUncheckedIndexedAccess`, `skipLibCheck`), `vitest.workspace.ts` listando `packages/shared` e o CI (Node 24: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`).

- [ ] **Step 2: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { parseDice, rollDice, DiceError, cryptoRng } from './dice';

const seq = (...v: number[]) => { let i = 0; return () => v[i++]!; };
const code = (src: string) => { try { parseDice(src); return 'ok'; } catch (e) { return (e as DiceError).code; } };

describe('parseDice/rollDice', () => {
  it('soma dado e constante', () => {
    expect(rollDice(parseDice('1d20+5'), seq(17)).total).toBe(22);
  });
  it('d20 sem quantidade vale 1 dado e aceita maiúscula', () => {
    expect(parseDice('D20').terms[0]).toMatchObject({ kind: 'dice', count: 1, faces: 20 });
  });
  it('vantagem e desvantagem com kh e kl', () => {
    expect(rollDice(parseDice('2d20kh1'), seq(4, 15)).total).toBe(15);
    expect(rollDice(parseDice('2d20kl1'), seq(4, 15)).total).toBe(4);
  });
  it('mantém os 3 maiores de 4d6', () => {
    const r = rollDice(parseDice('4d6kh3'), seq(1, 5, 3, 6));
    expect(r.terms[0]!.kept).toEqual([6, 5, 3]);
    expect(r.total).toBe(14);
  });
  it('subtrai termos e ignora espaços', () => {
    expect(rollDice(parseDice('2d6 - 1d4 + 3'), seq(3, 4, 2)).total).toBe(8);
  });
  it('rejeita entradas inválidas com o código certo', () => {
    expect(code('')).toBe('syntax');
    expect(code('1d')).toBe('syntax');
    expect(code('abc')).toBe('syntax');
    expect(code('0d6')).toBe('syntax');
    expect(code('1d20kh2')).toBe('syntax');
    expect(code('101d6')).toBe('too_many_dice');
    expect(code('60d6+60d6+60d6+60d6')).toBe('too_many_dice');
    expect(code('1000000d6')).toBe('too_many_dice');
    expect(code('1d1')).toBe('bad_faces');
    expect(code('1d1001')).toBe('bad_faces');
    expect(code('1'.repeat(201))).toBe('too_long');
  });
  it('cryptoRng fica entre 1 e faces', () => {
    for (let i = 0; i < 1000; i++) { const v = cryptoRng(6); expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); }
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm install && npx vitest run packages/shared/src/dice.test.ts`
Expected: FAIL, `parseDice` não existe.

- [ ] **Step 4: Implementar `dice.ts`** (parser manual por caracteres, sem regex catastrófica; checar `too_long` antes de analisar) e reexportar em `index.ts`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run packages/shared/src/dice.test.ts && npm run typecheck`
Expected: PASS, typecheck sem erros.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: monorepo e motor de dados"
```

---

### Task 2: Comandos de chat

**Files:**
- Create: `packages/shared/src/chat.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/chat.test.ts`

**Interfaces:**
- Consumes: `parseDice`, `DiceExpr`, `DiceError` (Task 1).
- Produces:
  ```ts
  export type ChatIntent =
    | { kind: 'text'; text: string; inline: DiceExpr[] }
    | { kind: 'roll'; expr: DiceExpr; label: string | null; secret: boolean }
    | { kind: 'whisper'; to: string; text: string; inline: DiceExpr[] };
  export type ChatErrorCode = 'empty' | 'too_long' | 'unknown_command' | 'bad_whisper';
  export class ChatError extends Error { code: ChatErrorCode }
  export function parseChat(input: string): ChatIntent; // lança ChatError ou DiceError
  ```

Regras: entrada aparada; vazia → `empty`; mais de 2000 caracteres → `too_long`. Comandos: `/r` e `/roll` (público), `/gr` (secreto: autor e mestres), `/w ALVO TEXTO` (ALVO é uma palavra ou um nome entre aspas duplas; sem alvo ou sem texto → `bad_whisper`). Qualquer outro `/x` → `unknown_command`. Em `/r`, a expressão é o maior prefixo de palavras (separadas por espaço) que `parseDice` aceita; o resto, aparado, é o `label` (`null` se vazio); nenhum prefixo válido → relança o `DiceError` da primeira palavra. Em texto e sussurro, cada `[[expr]]` vira um item de `inline`, na ordem, e o `text` mantém os colchetes.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect } from 'vitest';
import { parseChat, ChatError } from './chat';
import { DiceError } from './dice';

const err = (s: string) => { try { parseChat(s); return 'ok'; } catch (e) { return (e as ChatError | DiceError).code; } };

describe('parseChat', () => {
  it('texto simples', () => {
    expect(parseChat('olá mesa')).toEqual({ kind: 'text', text: 'olá mesa', inline: [] });
  });
  it('rolagens embutidas no texto', () => {
    const i = parseChat('ataco [[1d20+5]] e causo [[2d6]]');
    expect(i.kind).toBe('text');
    expect(i.kind === 'text' && i.inline.map(e => e.source)).toEqual(['1d20+5', '2d6']);
  });
  it('/r separa expressão e rótulo', () => {
    expect(parseChat('/r 1d20+5 Furtividade')).toMatchObject({ kind: 'roll', label: 'Furtividade', secret: false, expr: { source: '1d20+5' } });
    expect(parseChat('/roll 2d6 + 3 dano')).toMatchObject({ kind: 'roll', label: 'dano', expr: { source: '2d6 + 3' } });
    expect(parseChat('/r d20')).toMatchObject({ label: null });
  });
  it('/gr é secreto', () => {
    expect(parseChat('/gr 1d20')).toMatchObject({ kind: 'roll', secret: true });
  });
  it('/w com nome simples e com aspas', () => {
    expect(parseChat('/w Bram vem cá')).toEqual({ kind: 'whisper', to: 'Bram', text: 'vem cá', inline: [] });
    expect(parseChat('/w "Sela Ruiva" oi')).toMatchObject({ to: 'Sela Ruiva', text: 'oi' });
  });
  it('erros', () => {
    expect(err('   ')).toBe('empty');
    expect(err('a'.repeat(2001))).toBe('too_long');
    expect(err('/x algo')).toBe('unknown_command');
    expect(err('/w Bram')).toBe('bad_whisper');
    expect(err('/r')).toBe('syntax');
    expect(err('/r 1d0')).toBe('bad_faces');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/shared/src/chat.test.ts`
Expected: FAIL, `parseChat` não existe.

- [ ] **Step 3: Implementar `parseChat` em `chat.ts`** e reexportar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/shared && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: comandos de chat com rolagens e sussurros"
```

---

### Task 3: Estado da mesa, ações, grid e visibilidade

**Files:**
- Create: `packages/shared/src/types.ts`, `packages/shared/src/actions.ts`, `packages/shared/src/grid.ts`, `packages/shared/src/visibility.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/actions.test.ts`, `packages/shared/src/grid.test.ts`, `packages/shared/src/visibility.test.ts`

**Interfaces:**
- Consumes: `RollResult` (Task 1).
- Produces (`types.ts`):
  ```ts
  export type Role = 'gm' | 'player';
  export type Layer = 'tokens' | 'gm';
  export type RulesVersion = '2014' | '2024';
  export interface CampaignInfo { id: string; name: string; rulesVersion: RulesVersion; allowMixedVersions: boolean; defaultMapId: string | null; playersCanMove: boolean }
  export interface Member { userId: string; displayName: string; avatarUrl: string | null; role: Role; currentMapId: string | null }
  export interface MapInfo { id: string; name: string; imageUrl: string | null; width: number; height: number; gridSize: number; gridOffsetX: number; gridOffsetY: number }
  export interface Token { id: string; mapId: string; name: string; x: number; y: number; size: number; color: string; imageUrl: string | null; layer: Layer; ownerIds: string[] }
  export interface ChatMessage { id: string; authorId: string; kind: 'text' | 'roll' | 'whisper'; text: string; label: string | null; rolls: RollResult[]; secret: boolean; recipients: string[] | null; undone: boolean; createdAt: string }
  export interface ClientState { campaign: CampaignInfo; me: { userId: string; role: Role }; members: Member[]; maps: MapInfo[]; tokens: Token[]; chat: ChatMessage[]; canUndo: boolean }
  export interface Viewer { userId: string; role: Role; mapId: string | null } // mapId = mapa efetivo
  export type ErrorCode = 'forbidden' | 'invalid' | 'not_found' | 'nothing_to_undo' | 'dice' | 'internal';
  export type StateEvent =
    | { type: 'campaign.updated'; campaign: CampaignInfo }
    | { type: 'member.upserted'; member: Member } | { type: 'member.removed'; userId: string }
    | { type: 'map.upserted'; map: MapInfo } | { type: 'map.removed'; mapId: string }
    | { type: 'token.upserted'; token: Token } | { type: 'token.removed'; tokenId: string }
    | { type: 'chat.added'; message: ChatMessage } | { type: 'chat.updated'; message: ChatMessage }
    | { type: 'undo.available'; canUndo: boolean };
  export type ClientMessage = { t: 'cmd'; id: string; action: Action };
  export type ServerMessage =
    | { t: 'snapshot'; state: ClientState }
    | { t: 'ack'; id: string }
    | { t: 'error'; id: string | null; code: ErrorCode; message: string }
    | { t: 'event'; event: StateEvent };
  ```
- Produces (`actions.ts`): `export const ActionSchema` (Zod `discriminatedUnion('type', …)`, todos os objetos `.strict()`) e `export type Action = z.infer<typeof ActionSchema>`, com exatamente:
  - `{ type: 'campaign.update', name?: string(1..80), playersCanMove?: boolean }`
  - `{ type: 'member.setRole', userId: uuid, role: Role }`
  - `{ type: 'member.remove', userId: uuid }`
  - `{ type: 'member.setMap', userId: uuid, mapId: uuid | null }`
  - `{ type: 'map.create', name: string(1..80), imageKey: string(1..200) }`
  - `{ type: 'map.update', mapId: uuid, name?: string(1..80), gridSize?: int(10..500), gridOffsetX?: int(0..499), gridOffsetY?: int(0..499) }`
  - `{ type: 'map.delete', mapId: uuid }`
  - `{ type: 'map.setDefault', mapId: uuid }`
  - `{ type: 'token.create', mapId: uuid, name: string(1..60), x: int, y: int, size?: int(1..10) = 1, color?: /^#[0-9a-f]{6}$/i = '#5b8fd9', imageKey?: string, layer?: Layer = 'tokens', ownerIds?: uuid[] (máx. 20) = [] }`
  - `{ type: 'token.update', tokenId: uuid, x?: int, y?: int, name?, size?, color?, layer?, ownerIds? }` (mesmas regras do create)
  - `{ type: 'token.delete', tokenId: uuid }`
  - `{ type: 'chat.send', text: string(1..2000) }`
  - `{ type: 'undo' }`
- Produces (`grid.ts`): `gridCols(m: MapInfo): number` = `floor((width - gridOffsetX) / gridSize)`; `gridRows` análogo com altura; `cellToPixel(m, x, y): { px: number; py: number }` (canto superior esquerdo da célula); `pixelToCell(m, px, py): { x: number; y: number }` (arredonda para baixo); `isInsideGrid(m, x, y, size): boolean` (o token inteiro dentro de `0..cols-1` e `0..rows-1`).
- Produces (`visibility.ts`): `effectiveMapId(member: Member, campaign: CampaignInfo): string | null` (`currentMapId ?? defaultMapId`); `canSeeMap(v: Viewer, mapId: string): boolean` (mestre vê todos; jogador só `v.mapId`); `canSeeToken(v: Viewer, t: Token): boolean` (`canSeeMap` e, para jogador, `layer === 'tokens'`); `canSeeMessage(v: Viewer, m: ChatMessage): boolean` (`recipients === null` → todos; senão só quem está em `recipients`, inclusive para o mestre).

Escolha deste plano: o mestre não vê sussurros entre jogadores. Rolagens secretas (`/gr`) têm como `recipients` o autor e todos os mestres.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// actions.test.ts
import { ActionSchema } from './actions';
const id = '00000000-0000-4000-8000-000000000001';
it('aceita token.create válido e preenche padrões', () => {
  const a = ActionSchema.parse({ type: 'token.create', mapId: id, name: 'Lia', x: 2, y: 3 });
  expect(a).toMatchObject({ size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [] });
});
it('rejeita cor fora do formato, campo extra e tipo desconhecido', () => {
  expect(ActionSchema.safeParse({ type: 'token.create', mapId: id, name: 'L', x: 0, y: 0, color: 'red' }).success).toBe(false);
  expect(ActionSchema.safeParse({ type: 'undo', extra: 1 }).success).toBe(false);
  expect(ActionSchema.safeParse({ type: 'token.explode' }).success).toBe(false);
});

// grid.test.ts
const m = { id: 'm', name: 'M', imageUrl: null, width: 710, height: 425, gridSize: 70, gridOffsetX: 10, gridOffsetY: 5 };
it('converte célula e pixel', () => {
  expect(gridCols(m)).toBe(10);
  expect(gridRows(m)).toBe(6);
  expect(cellToPixel(m, 2, 3)).toEqual({ px: 150, py: 215 });
  expect(pixelToCell(m, 150, 215)).toEqual({ x: 2, y: 3 });
  expect(pixelToCell(m, 149, 215)).toEqual({ x: 1, y: 3 });
});
it('limites do grid consideram o tamanho do token', () => {
  expect(isInsideGrid(m, 9, 5, 1)).toBe(true);
  expect(isInsideGrid(m, 9, 5, 2)).toBe(false);
  expect(isInsideGrid(m, -1, 0, 1)).toBe(false);
});

// visibility.test.ts
const P = { userId: 'p', role: 'player' as const, mapId: 'm1' };
const G = { userId: 'g', role: 'gm' as const, mapId: null };
const tok = (o: Partial<Token>) => ({ id: 't', mapId: 'm1', name: 'T', x: 0, y: 0, size: 1, color: '#000000', imageUrl: null, layer: 'tokens', ownerIds: [], ...o }) as Token;
it('jogador vê só tokens visíveis do próprio mapa', () => {
  expect(canSeeToken(P, tok({}))).toBe(true);
  expect(canSeeToken(P, tok({ layer: 'gm' }))).toBe(false);
  expect(canSeeToken(P, tok({ mapId: 'm2' }))).toBe(false);
  expect(canSeeToken(G, tok({ layer: 'gm', mapId: 'm2' }))).toBe(true);
});
it('mensagens respeitam recipients, inclusive para o mestre', () => {
  const msg = (recipients: string[] | null) => ({ recipients }) as ChatMessage;
  expect(canSeeMessage(P, msg(null))).toBe(true);
  expect(canSeeMessage(G, msg(['p', 'q']))).toBe(false);
  expect(canSeeMessage(P, msg(['p', 'g']))).toBe(true);
});
it('mapa efetivo cai no padrão da campanha', () => {
  expect(effectiveMapId({ currentMapId: null } as Member, { defaultMapId: 'm9' } as CampaignInfo)).toBe('m9');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/shared`
Expected: FAIL nos três arquivos novos.

- [ ] **Step 3: Implementar `types.ts`, `actions.ts`, `grid.ts` e `visibility.ts`** com as assinaturas acima e reexportar em `index.ts` (`zod` vira dependência de `@rpgai/shared`).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/shared && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: estado da mesa, acoes, grid e visibilidade"
```

---

### Task 4: Base do servidor e banco

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/drizzle.config.ts`, `apps/server/src/config.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/db/client.ts`, `apps/server/src/db/migrations/*` (gerado), `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/test/helpers.ts`
- Modify: `vitest.workspace.ts` (adicionar `apps/server`)
- Test: `apps/server/test/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // config.ts — lê process.env com Zod
  export interface Config {
    port: number;                 // PORT, padrão 3000
    publicUrl: string;            // PUBLIC_URL, padrão http://localhost:5173
    databaseUrl: string;          // DATABASE_URL, padrão 'pglite:./data/pglite'; 'pglite:memory' em teste
    uploadDir: string;            // UPLOAD_DIR, padrão ./data/uploads
    maxUploadBytes: number;       // 20 * 1024 * 1024
    devLogin: boolean;            // DEV_LOGIN === 'true' e NODE_ENV !== 'production'
    production: boolean;          // NODE_ENV === 'production'
    discord: { clientId: string; clientSecret: string } | null; // DISCORD_CLIENT_ID/SECRET
    webDist: string | null;       // WEB_DIST, pasta do build do web (Task 15)
  }
  export function loadConfig(env?: NodeJS.ProcessEnv): Config;
  // db/client.ts
  export type Db = /* instância Drizzle sobre PGlite ou pg, com o schema */;
  export function createDb(url: string): Promise<{ db: Db; close(): Promise<void> }>; // 'pglite:memory', 'pglite:<pasta>' ou URL postgres://
  export function runMigrations(db: Db): Promise<void>;
  // app.ts
  export interface AppDeps { config: Config; db: Db; discord: DiscordClient | null; files: FileStore; rng: Rng }
  export function buildApp(deps: AppDeps): Promise<FastifyInstance>;
  // test/helpers.ts
  export function testConfig(): Config; // pglite:memory, devLogin true, uploadDir temporário, publicUrl http://localhost:5173
  export function createTestApp(overrides?: Partial<AppDeps>): Promise<{ app: FastifyInstance; db: Db; deps: AppDeps; close(): Promise<void> }>;
  ```
  Opções que valem no registro dos plugins (como `maxUploadBytes`) são passadas por `createTestApp({ config: { ...testConfig(), … } })`, nunca alteradas depois.
  `DiscordClient` e `FileStore` são definidos nas Tasks 5 e 7. Nesta task, declare-os como interfaces vazias nos arquivos `auth/discord.ts` e `files/store.ts`, que serão completados lá.
- Tabelas (`schema.ts`, ids `uuid` com `defaultRandom()`, datas `timestamp with time zone` com `defaultNow()`):
  - `users`: `id`, `discord_id` (único, nulo para login de desenvolvimento), `display_name`, `avatar_url`, `created_at`
  - `sessions`: `id_hash` (texto, PK), `user_id` → users, `expires_at`
  - `campaigns`: `id`, `name`, `rules_version` (`'2014' | '2024'`), `allow_mixed_versions` (bool, padrão false), `default_map_id` (uuid nulo), `players_can_move` (bool, padrão true), `created_at`
  - `campaign_members`: `campaign_id`, `user_id`, `role`, `current_map_id` (nulo), `joined_at`; PK (`campaign_id`, `user_id`)
  - `invites`: `token` (PK), `campaign_id`, `created_by`, `revoked` (bool), `created_at`
  - `uploads`: `key` (PK, `"<campaignId>/<uuid>.<ext>"`), `campaign_id`, `content_type`, `size_bytes`, `width`, `height`, `created_at`
  - `maps`: `id`, `campaign_id`, `name`, `image_key` (nulo), `width`, `height`, `grid_size` (padrão 70), `grid_offset_x` (0), `grid_offset_y` (0), `created_at`
  - `tokens`: `id`, `campaign_id`, `map_id`, `name`, `x`, `y`, `size`, `color`, `image_key` (nulo), `layer`, `owner_ids` (jsonb `string[]`), `created_at`
  - `chat_messages`: `id`, `campaign_id`, `author_id`, `kind`, `text`, `label` (nulo), `rolls` (jsonb), `secret` (bool), `recipients` (jsonb `string[] | null`), `undone` (bool), `created_at`
  - `action_log`: `id` (serial), `campaign_id`, `actor_id`, `via`, `type`, `payload` (jsonb), `inverse` (jsonb nulo), `undone` (bool), `created_at`; índice em (`campaign_id`, `id`)
- Rota `GET /api/health` → `{ ok: true }`.
- Scripts do servidor: `dev` = `tsx watch src/index.ts`, `build` = `tsup src/index.ts --format esm --platform node --target node24 --noExternal @rpgai/shared`, `db:generate` = `drizzle-kit generate`, `typecheck` = `tsc --noEmit`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { createTestApp } from './helpers';
it('aplica as migrações e responde health', async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/api/health' });
  expect(res.json()).toEqual({ ok: true });
  const rows = await t.db.select().from(users);
  expect(rows).toEqual([]);
  await t.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/db.test.ts`
Expected: FAIL, `createTestApp` não existe.

- [ ] **Step 3: Implementar config, schema, client, app e helpers; gerar a migração**

Run: `npm run db:generate -w apps/server`
Expected: um arquivo SQL novo em `apps/server/src/db/migrations/`. `createTestApp` usa `pglite:memory`, `devLogin: true`, `uploadDir` numa pasta temporária, `rng` que devolve sempre `faces` (sobrescrevível) e roda `runMigrations`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: base do servidor com banco e migracoes"
```

---

### Task 5: Login com Discord e sessões

**Files:**
- Create: `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/routes.ts`
- Modify: `apps/server/src/auth/discord.ts`, `apps/server/src/app.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // auth/discord.ts
  export interface DiscordUser { id: string; username: string; global_name: string | null; avatar: string | null }
  export interface DiscordClient {
    authorizeUrl(state: string, redirectUri: string): string;            // scope 'identify'
    exchangeCode(code: string, redirectUri: string): Promise<string>;    // devolve access token
    getUser(accessToken: string): Promise<DiscordUser>;
  }
  export function createDiscordClient(cfg: { clientId: string; clientSecret: string }): DiscordClient; // usa fetch em https://discord.com/api
  // auth/sessions.ts
  export function createSession(db: Db, userId: string): Promise<string>; // devolve o token bruto; grava sha256 em sessions; validade 30 dias
  export function userFromRequest(db: Db, req: FastifyRequest): Promise<{ id: string; displayName: string; avatarUrl: string | null } | null>;
  export function requireUser(db: Db): preHandlerHookHandler; // 401 { error: 'unauthenticated' } e decora req.user
  // test/helpers.ts
  export function login(app: FastifyInstance, name: string): Promise<{ cookie: string; userId: string }>; // via /auth/dev-login
  ```
- Rotas:
  - `POST /auth/dev-login` `{ name }` → só existe quando `config.devLogin`; cria ou reaproveita o usuário com esse `display_name` e `discord_id` nulo; seta o cookie; `{ userId }`.
  - `GET /auth/discord` → grava `oauth_state` aleatório (cookie httpOnly, 10 min) e redireciona (302) para `authorizeUrl`. 503 `{ error: 'discord_not_configured' }` se `deps.discord` for nulo.
  - `GET /auth/discord/callback?code&state` → state diferente do cookie: 400 `{ error: 'bad_state' }`; senão troca o código, busca o usuário, cria ou atualiza pelo `discord_id` (`display_name` = `global_name ?? username`, avatar = `https://cdn.discordapp.com/avatars/<id>/<avatar>.png` ou nulo), cria sessão e redireciona para `/`.
  - `GET /api/me` → `{ id, displayName, avatarUrl }` ou 401.
  - `POST /auth/logout` → apaga a sessão e o cookie; 204.
- Cookie `sid`: httpOnly, `sameSite: 'lax'`, `secure` em produção, `path: '/'`. `redirectUri` = `${publicUrl}/auth/discord/callback`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
const fakeDiscord: DiscordClient = {
  authorizeUrl: (s) => `https://discord.test/authorize?state=${s}`,
  exchangeCode: async (c) => (c === 'good' ? 'tok' : Promise.reject(new Error('bad'))),
  getUser: async () => ({ id: '42', username: 'paulo', global_name: 'Paulo', avatar: 'abc' }),
};
it('dev-login cria sessão e /api/me devolve o usuário', async () => {
  const t = await createTestApp();
  const { cookie } = await login(t.app, 'Mestre');
  const me = await t.app.inject({ url: '/api/me', headers: { cookie } });
  expect(me.json()).toMatchObject({ displayName: 'Mestre', avatarUrl: null });
});
it('sem cookie /api/me é 401', async () => {
  const t = await createTestApp();
  expect((await t.app.inject({ url: '/api/me' })).statusCode).toBe(401);
});
it('fluxo do Discord cria usuário com avatar', async () => {
  const t = await createTestApp({ discord: fakeDiscord });
  const start = await t.app.inject({ url: '/auth/discord' });
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const stateCookie = start.cookies.find(c => c.name === 'oauth_state')!;
  const cb = await t.app.inject({ url: `/auth/discord/callback?code=good&state=${state}`, cookies: { oauth_state: stateCookie.value } });
  expect(cb.statusCode).toBe(302);
  const sid = cb.cookies.find(c => c.name === 'sid')!.value;
  const me = await t.app.inject({ url: '/api/me', cookies: { sid } });
  expect(me.json()).toMatchObject({ displayName: 'Paulo', avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png' });
});
it('state diferente é recusado', async () => {
  const t = await createTestApp({ discord: fakeDiscord });
  const cb = await t.app.inject({ url: '/auth/discord/callback?code=good&state=x', cookies: { oauth_state: 'y' } });
  expect(cb.statusCode).toBe(400);
});
it('dev-login não existe em produção', async () => {
  const t = await createTestApp({ config: { ...testConfig(), devLogin: false } });
  expect((await t.app.inject({ method: 'POST', url: '/auth/dev-login', payload: { name: 'x' } })).statusCode).toBe(404);
});
it('logout invalida a sessão', async () => {
  const t = await createTestApp();
  const { cookie } = await login(t.app, 'A');
  await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
  expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `discord.ts`, `sessions.ts` e `routes.ts`** e registrar no `buildApp`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: login com discord e sessoes"
```

---

### Task 6: Campanhas, membros e convites

**Files:**
- Create: `apps/server/src/campaigns/routes.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/campaigns.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `login` (Task 5).
- Produces:
  - `GET /api/campaigns` → `{ id, name, role, rulesVersion }[]` das campanhas do usuário, mais recentes primeiro.
  - `POST /api/campaigns` `{ name: 1..80, rulesVersion: '2014' | '2024', allowMixedVersions?: boolean }` → 201 `{ id }`; quem cria entra como `gm`.
  - `POST /api/campaigns/:id/invites` (só mestre) → 201 `{ token, url }`, `token` com 24 bytes aleatórios em base64url, `url` = `${publicUrl}/convite/${token}`.
  - `DELETE /api/campaigns/:id/invites/:token` (só mestre) → 204, marca `revoked`.
  - `GET /api/invites/:token` (logado) → `{ campaignId, campaignName, alreadyMember }`; inexistente ou revogado → 404.
  - `POST /api/invites/:token/accept` (logado) → `{ campaignId }`; entra como `player` (se já for membro, mantém o papel).
  - Erros: não membro → 404 `{ error: 'not_found' }` (não revela que a campanha existe); membro sem ser mestre → 403 `{ error: 'forbidden' }`; corpo inválido → 400 `{ error: 'invalid' }`.
  - Helper `seedCampaign(t): Promise<{ campaignId: string; gm: Session; player: Session }>`, com `Session = { cookie: string; userId: string }`, que cria a campanha pelo mestre e faz o jogador entrar por convite.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('cria campanha, convida e o jogador entra', async () => {
  const t = await createTestApp();
  const gm = await login(t.app, 'Mestre');
  const pl = await login(t.app, 'Lia');
  const c = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: gm.cookie }, payload: { name: 'Estalagem do Corvo', rulesVersion: '2024' } });
  expect(c.statusCode).toBe(201);
  const { id } = c.json();
  const inv = await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/invites`, headers: { cookie: gm.cookie } });
  const { token, url } = inv.json();
  expect(url).toBe(`http://localhost:5173/convite/${token}`);
  const prev = await t.app.inject({ url: `/api/invites/${token}`, headers: { cookie: pl.cookie } });
  expect(prev.json()).toEqual({ campaignId: id, campaignName: 'Estalagem do Corvo', alreadyMember: false });
  await t.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: pl.cookie } });
  const list = await t.app.inject({ url: '/api/campaigns', headers: { cookie: pl.cookie } });
  expect(list.json()).toEqual([{ id, name: 'Estalagem do Corvo', role: 'player', rulesVersion: '2024' }]);
});
it('jogador não cria convite e convite revogado não funciona', async () => {
  const t = await createTestApp();
  const { campaignId, gm, player } = await seedCampaign(t);
  expect((await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: player.cookie } })).statusCode).toBe(403);
  const { token } = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: gm.cookie } })).json();
  await t.app.inject({ method: 'DELETE', url: `/api/campaigns/${campaignId}/invites/${token}`, headers: { cookie: gm.cookie } });
  const other = await login(t.app, 'Intruso');
  expect((await t.app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
});
it('quem não é membro recebe 404 e corpo inválido é 400', async () => {
  const t = await createTestApp();
  const { campaignId } = await seedCampaign(t);
  const other = await login(t.app, 'Intruso');
  expect((await t.app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/invites`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
  expect((await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: other.cookie }, payload: { name: '', rulesVersion: '3' } })).statusCode).toBe(400);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/campaigns.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `campaigns/routes.ts` e `seedCampaign`.**

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: campanhas, membros e convites"
```

---

### Task 7: Upload e leitura de imagens

**Files:**
- Create: `apps/server/src/files/routes.ts`
- Modify: `apps/server/src/files/store.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/files.test.ts`, `apps/server/test/fixtures/map-700x700.png` (PNG real de 700×700 gerado no teste ou commitado)

**Interfaces:**
- Produces:
  ```ts
  // files/store.ts
  export interface FileStore {
    put(key: string, data: Buffer): Promise<void>;
    get(key: string): Promise<Buffer | null>;
  }
  export function createLocalFileStore(dir: string): FileStore; // grava em <dir>/<key>, criando pastas
  ```
  - `POST /api/campaigns/:id/uploads` (só mestre, multipart, um arquivo no campo `file`) → 201 `{ key, width, height, url }`, com `url` = `/files/<key>`. O tipo vem dos primeiros bytes via `image-size` (png, jpg, webp); outro tipo ou imagem ilegível → 400 `{ error: 'invalid_image' }`; acima de `maxUploadBytes` → 413 `{ error: 'too_large' }`. Grava a linha em `uploads`.
  - `GET /files/:campaignId/:file` → o arquivo com o `content-type` gravado, só para membros da campanha (não membro → 404).

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('mestre sobe PNG, membro lê, estranho não', async () => {
  const t = await createTestApp();
  const { campaignId, gm, player } = await seedCampaign(t);
  const up = await uploadFile(t.app, gm.cookie, campaignId, pngBuffer(700, 700), 'mapa.png');
  expect(up.statusCode).toBe(201);
  expect(up.json()).toMatchObject({ width: 700, height: 700 });
  const url = up.json().url;
  expect((await t.app.inject({ url, headers: { cookie: player.cookie } })).headers['content-type']).toBe('image/png');
  const other = await login(t.app, 'Intruso');
  expect((await t.app.inject({ url, headers: { cookie: other.cookie } })).statusCode).toBe(404);
});
it('recusa arquivo que não é imagem mesmo com extensão .png', async () => {
  const t = await createTestApp();
  const { campaignId, gm } = await seedCampaign(t);
  const up = await uploadFile(t.app, gm.cookie, campaignId, Buffer.from('não sou imagem'), 'falso.png');
  expect(up.json()).toEqual({ error: 'invalid_image' });
});
it('recusa arquivo grande demais e upload de jogador', async () => {
  const t = await createTestApp({ config: { ...testConfig(), maxUploadBytes: 1000 } });
  const { campaignId, gm, player } = await seedCampaign(t);
  expect((await uploadFile(t.app, gm.cookie, campaignId, pngBuffer(700, 700), 'm.png')).statusCode).toBe(413);
  expect((await uploadFile(t.app, player.cookie, campaignId, pngBuffer(10, 10), 'm.png')).statusCode).toBe(403);
});
```
`uploadFile` e `pngBuffer` são helpers em `test/helpers.ts` (`pngBuffer` gera um PNG válido em memória com `node:zlib`; `uploadFile` monta o corpo multipart).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/files.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `store.ts` e `files/routes.ts`** (`@fastify/multipart` com `limits.fileSize = maxUploadBytes`).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: upload de imagens da campanha"
```

---

### Task 8: Sala da campanha: mapas, tokens, permissões e desfazer

**Files:**
- Create: `apps/server/src/table/room.ts`, `apps/server/src/table/inverse.ts`, `apps/server/src/table/registry.ts`
- Test: `apps/server/test/room.test.ts`

**Interfaces:**
- Consumes: `Action`, `ActionSchema`, `StateEvent`, tipos de `types.ts`, `isInsideGrid`, `effectiveMapId` (Task 3); `Db`, tabelas (Task 4).
- Produces:
  ```ts
  export interface Actor { userId: string; via: 'web' | 'api' | 'mcp' }
  export interface ServerState {
    campaign: CampaignInfo;
    members: Member[];
    maps: Array<MapInfo & { imageKey: string | null }>;
    tokens: Array<Token & { imageKey: string | null }>;
    chat: ChatMessage[]; // últimas 500 da campanha, em ordem
  }
  export interface DispatchOk { ok: true; events: StateEvent[]; resnapshot: string[] } // userIds que precisam de snapshot novo
  export interface DispatchErr { ok: false; code: ErrorCode; message: string }
  export class CampaignRoom {
    static load(db: Db, campaignId: string, rng: Rng): Promise<CampaignRoom>;
    readonly campaignId: string;
    dispatch(actor: Actor, action: Action): Promise<DispatchOk | DispatchErr>; // serializado: uma ação por vez por sala
    state(): ServerState; // estado completo interno (campanha, membros, mapas, tokens, chat recente)
    isMember(userId: string): boolean;
  }
  export class RoomRegistry {
    constructor(db: Db, rng: Rng);
    get(campaignId: string): Promise<CampaignRoom>; // carrega uma vez e reaproveita
  }
  // inverse.ts
  export type InverseOp =
    | { op: 'campaign.set'; fields: Partial<Pick<CampaignInfo, 'name' | 'playersCanMove' | 'defaultMapId'>> }
    | { op: 'member.set'; userId: string; fields: Partial<Pick<Member, 'role' | 'currentMapId'>> }
    | { op: 'member.restore'; member: Member }
    | { op: 'map.set'; mapId: string; fields: Partial<MapInfo> }
    | { op: 'map.delete'; mapId: string }
    | { op: 'map.restore'; map: MapInfo & { imageKey: string | null }; tokens: Array<Token & { imageKey: string | null }>; wasDefault: boolean }
    | { op: 'token.set'; tokenId: string; fields: Partial<Token> }
    | { op: 'token.delete'; tokenId: string }
    | { op: 'token.restore'; token: Token & { imageKey: string | null } }
    | { op: 'chat.markUndone'; messageId: string };
  ```
  `imageUrl` é sempre `/files/<imageKey>` ou nulo.

Regras de permissão e validação (erro → nada muda, nada é gravado):
- Só mestre: `campaign.update`, `member.*`, `map.*`, `token.create`, `token.delete`, `undo`. Jogador → `forbidden`.
- `token.update` por jogador: só se for dono (`ownerIds` contém o userId), `playersCanMove` for true e o payload tiver apenas `x` e `y`; senão `forbidden`.
- Posição fora do grid (`isInsideGrid` falso) → `invalid`. Mapa, token, membro ou upload de outra campanha → `not_found`.
- `map.create`: `width` e `height` vêm da linha em `uploads`. Primeiro mapa criado vira o `defaultMapId`.
- `member.setRole` ou `member.remove` que deixaria a campanha sem mestre → `invalid`.
- `member.setMap` e `map.setDefault` devolvem em `resnapshot` os jogadores cujo mapa efetivo mudou; `member.remove` devolve o removido em `resnapshot` (a Task 10 fecha a conexão dele).
- `map.delete` apaga os tokens do mapa; se era o padrão, `defaultMapId` vira nulo; `currentMapId` de quem estava nele vira nulo.

Desfazer: cada ação aplicada grava em `action_log` a `InverseOp`. `undo` pega a última linha não desfeita da campanha (mais recente por `id`), aplica a inversa, marca `undone = true` e devolve os eventos. Sem linha → `nothing_to_undo`. A própria ação `undo` não entra no log. Todo `dispatch` termina com um evento `undo.available` refletindo se ainda há o que desfazer (a projeção da Task 9 entrega esse evento só aos mestres).

- [ ] **Step 1: Escrever os testes que falham**

Helper do arquivo: `setup()` cria app de teste, `seedCampaign`, insere duas linhas em `uploads` (700×700, grid 70 → 10×10 células), carrega a sala e cria o mapa `m1` pelo mestre. `G` e `P` são `Actor` do mestre e do jogador com `via: 'web'`.

```ts
it('mestre cria mapa e token; jogador move o próprio token', async () => {
  const { room, G, P, m1 } = await setup();
  const r = await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Lia', x: 2, y: 3, size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [P.userId] });
  expect(r.ok).toBe(true);
  const tokenId = room.state().tokens[0]!.id;
  expect((await room.dispatch(P, { type: 'token.update', tokenId, x: 4, y: 4 })).ok).toBe(true);
  expect(room.state().tokens[0]).toMatchObject({ x: 4, y: 4 });
  expect(room.state().campaign.defaultMapId).toBe(m1);
});
it('jogador não move token alheio, não renomeia, não cria e não desfaz', async () => {
  const { room, G, P, m1 } = await setup();
  await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1, size: 1, color: '#c9483f', layer: 'tokens', ownerIds: [] });
  const tokenId = room.state().tokens[0]!.id;
  for (const a of [
    { type: 'token.update', tokenId, x: 2, y: 2 },
    { type: 'token.create', mapId: m1, name: 'X', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] },
    { type: 'undo' },
  ] as Action[]) expect(await room.dispatch(P, a)).toMatchObject({ ok: false, code: 'forbidden' });
  expect(room.state().tokens[0]).toMatchObject({ x: 1, y: 1 });
});
it('dono não renomeia e não move com movimento travado', async () => {
  const { room, G, P, m1 } = await setup();
  await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'Lia', x: 0, y: 0, size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [P.userId] });
  const tokenId = room.state().tokens[0]!.id;
  expect(await room.dispatch(P, { type: 'token.update', tokenId, name: 'Lia 2' })).toMatchObject({ code: 'forbidden' });
  await room.dispatch(G, { type: 'campaign.update', playersCanMove: false });
  expect(await room.dispatch(P, { type: 'token.update', tokenId, x: 1, y: 0 })).toMatchObject({ code: 'forbidden' });
  expect((await room.dispatch(G, { type: 'token.update', tokenId, x: 1, y: 0 })).ok).toBe(true);
});
it('posição fora do grid é inválida', async () => {
  const { room, G, m1 } = await setup();
  expect(await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 10, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] })).toMatchObject({ code: 'invalid' });
});
it('desfazer é linear e para quando acaba', async () => {
  const { room, G, m1 } = await setup();
  await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
  const tokenId = room.state().tokens[0]!.id;
  await room.dispatch(G, { type: 'token.update', tokenId, x: 5, y: 5 });
  await room.dispatch(G, { type: 'undo' });
  expect(room.state().tokens[0]).toMatchObject({ x: 0, y: 0 });
  await room.dispatch(G, { type: 'undo' }); // desfaz o token.create
  await room.dispatch(G, { type: 'undo' }); // desfaz o map.create
  expect(room.state().maps).toEqual([]);
  expect(await room.dispatch(G, { type: 'undo' })).toMatchObject({ code: 'nothing_to_undo' });
});
it('desfazer a exclusão do mapa traz os tokens com os mesmos ids', async () => {
  const { room, G, m1 } = await setup();
  for (const n of ['A', 'B']) await room.dispatch(G, { type: 'token.create', mapId: m1, name: n, x: 0, y: 0, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
  const ids = room.state().tokens.map(t => t.id).sort();
  await room.dispatch(G, { type: 'map.delete', mapId: m1 });
  expect(room.state().tokens).toEqual([]);
  await room.dispatch(G, { type: 'undo' });
  expect(room.state().tokens.map(t => t.id).sort()).toEqual(ids);
  expect(room.state().campaign.defaultMapId).toBe(m1);
});
it('dois desfazer simultâneos desfazem uma ação só', async () => {
  const { room, G } = await setup(); // só o map.create no log
  const [a, b] = await Promise.all([room.dispatch(G, { type: 'undo' }), room.dispatch(G, { type: 'undo' })]);
  expect([a.ok, b.ok].sort()).toEqual([false, true]);
});
it('não deixa a campanha sem mestre', async () => {
  const { room, G } = await setup();
  expect(await room.dispatch(G, { type: 'member.setRole', userId: G.userId, role: 'player' })).toMatchObject({ code: 'invalid' });
});
it('trocar o mapa do jogador pede snapshot novo para ele', async () => {
  const { room, G, P, m2 } = await setup({ secondMap: true });
  const r = await room.dispatch(G, { type: 'member.setMap', userId: P.userId, mapId: m2 });
  expect(r.ok && r.resnapshot).toEqual([P.userId]);
});
it('tudo persiste e o log registra quem e por onde', async () => {
  const { t, room, G, m1, campaignId } = await setup();
  await room.dispatch(G, { type: 'token.create', mapId: m1, name: 'T', x: 3, y: 3, size: 1, color: '#000000', layer: 'tokens', ownerIds: [] });
  const fresh = await CampaignRoom.load(t.db, campaignId, t.deps.rng);
  expect(fresh.state().tokens[0]).toMatchObject({ name: 'T', x: 3, y: 3 });
  const log = await t.db.select().from(actionLog);
  expect(log.every(l => l.actorId === G.userId && l.via === 'web')).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/room.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `room.ts`, `inverse.ts` e `registry.ts`.** Serialize o `dispatch` com uma fila de promessas por sala; cada ação grava as mudanças e a linha do `action_log` numa única transação, e só então atualiza o estado em memória. `chat.send` responde `invalid` até a Task 9.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: sala da campanha com acoes, permissoes e desfazer"
```

---

### Task 9: Chat no servidor e projeção por pessoa

**Files:**
- Create: `apps/server/src/table/chat.ts`, `apps/server/src/table/project.ts`
- Modify: `apps/server/src/table/room.ts`, `apps/server/src/table/inverse.ts`
- Test: `apps/server/test/chat.test.ts`, `apps/server/test/project.test.ts`

**Interfaces:**
- Consumes: `parseChat`, `rollDice`, `DiceError`, `ChatError` (Tasks 1 e 2); `canSee*`, `effectiveMapId` (Task 3); `CampaignRoom` (Task 8).
- Produces:
  ```ts
  // chat.ts — chamado pelo room para 'chat.send'
  export function buildMessage(input: { text: string; authorId: string; members: Member[]; rng: Rng }): Omit<ChatMessage, 'id' | 'createdAt' | 'undone'>;
  // lança DiceError (→ código 'dice'), ChatError (→ 'invalid') ou Error('unknown_member') (→ 'invalid')
  // project.ts
  export function viewerFor(state: ServerState, userId: string): Viewer | null; // null se não for membro
  export function snapshotFor(state: ServerState, userId: string, canUndo: boolean): ClientState; // chat: últimas 200 mensagens visíveis; jogador recebe só o próprio mapa efetivo e os tokens visíveis dele; canUndo sempre false para jogador
  export function projectEvent(event: StateEvent, viewer: Viewer): StateEvent | null;
  ```
- Mensagens: `/r` → `kind: 'roll'`, `rolls: [resultado]`, `label`, `recipients: null`. `/gr` → `secret: true`, `recipients` = autor e todos os mestres, sem repetição. `/w` → `kind: 'whisper'`, alvo resolvido pelo `displayName` sem diferença de maiúsculas, `recipients` = [autor, alvo]. Texto → `kind: 'text'`, uma rolagem por `[[ ]]`. `undo` de `chat.send` usa `chat.markUndone` e emite `chat.updated` com `undone: true`.
- `projectEvent`: `token.upserted` que o viewer não pode ver vira `{ type: 'token.removed', tokenId }`; `map.upserted` e `map.removed` de mapa que o jogador não vê → `null`; `chat.added` e `chat.updated` não visíveis → `null`; `undo.available` → `null` para jogador; os demais passam inalterados.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// chat.test.ts (usa o setup da Task 8 com rng que devolve 17 para d20 e 'faces' para o resto)
it('/r rola no servidor e todos veem', async () => {
  const { room, P } = await setup({ rng: (f) => (f === 20 ? 17 : f) });
  await room.dispatch(P, { type: 'chat.send', text: '/r 1d20+5 Ataque' });
  expect(room.state().chat.at(-1)).toMatchObject({ kind: 'roll', label: 'Ataque', recipients: null, rolls: [{ total: 22 }] });
});
it('/gr do jogador vai só para ele e para os mestres', async () => {
  const { room, G, P } = await setup();
  await room.dispatch(P, { type: 'chat.send', text: '/gr 1d20' });
  expect(new Set(room.state().chat.at(-1)!.recipients)).toEqual(new Set([P.userId, G.userId]));
});
it('/w acha o membro pelo nome e falha para nome desconhecido', async () => {
  const { room, G, P } = await setup(); // jogador tem displayName 'Lia'
  await room.dispatch(G, { type: 'chat.send', text: '/w lia cuidado' });
  expect(room.state().chat.at(-1)).toMatchObject({ kind: 'whisper', text: 'cuidado', recipients: [G.userId, P.userId] });
  expect(await room.dispatch(G, { type: 'chat.send', text: '/w Ninguém oi' })).toMatchObject({ code: 'invalid' });
});
it('rolagens embutidas e dados inválidos', async () => {
  const { room, P } = await setup();
  await room.dispatch(P, { type: 'chat.send', text: 'ataco [[1d20]] e causo [[2d6]]' });
  expect(room.state().chat.at(-1)!.rolls).toHaveLength(2);
  expect(await room.dispatch(P, { type: 'chat.send', text: '/r 1d0' })).toMatchObject({ code: 'dice' });
  expect(await room.dispatch(P, { type: 'chat.send', text: '/r 1000000d6' })).toMatchObject({ code: 'dice' });
});
it('desfazer uma rolagem a deixa marcada no chat', async () => {
  const { room, G } = await setup();
  await room.dispatch(G, { type: 'chat.send', text: '/r 1d20' });
  const r = await room.dispatch(G, { type: 'undo' });
  expect(room.state().chat.at(-1)!.undone).toBe(true);
  expect(r.ok && r.events.some(e => e.type === 'chat.updated')).toBe(true);
});

// project.test.ts (funções puras)
const player: Viewer = { userId: 'p', role: 'player', mapId: 'm1' };
it('token que vai para a camada do mestre vira remoção para o jogador', () => {
  expect(projectEvent({ type: 'token.upserted', token: tok({ id: 't1', layer: 'gm' }) }, player)).toEqual({ type: 'token.removed', tokenId: 't1' });
});
it('mapa de outro lugar e undo.available não chegam ao jogador', () => {
  expect(projectEvent({ type: 'map.upserted', map: map({ id: 'm2' }) }, player)).toBeNull();
  expect(projectEvent({ type: 'undo.available', canUndo: true }, player)).toBeNull();
});
it('snapshot do jogador não contém nada escondido', () => {
  const s = serverState({ maps: ['m1', 'm2'], tokens: [tok({ id: 'a' }), tok({ id: 'b', layer: 'gm' }), tok({ id: 'c', mapId: 'm2' })], chat: [msg({ recipients: ['g', 'q'] })] });
  const snap = snapshotFor(s, 'p', true);
  expect(snap.maps.map(m => m.id)).toEqual(['m1']);
  expect(snap.tokens.map(t => t.id)).toEqual(['a']);
  expect(snap.chat).toEqual([]);
  expect(snap.canUndo).toBe(false);
});
it('snapshot limita o chat a 200 mensagens visíveis', () => {
  const s = serverState({ chat: Array.from({ length: 250 }, (_, i) => msg({ id: String(i), recipients: null })) });
  const snap = snapshotFor(s, 'p', false);
  expect(snap.chat).toHaveLength(200);
  expect(snap.chat.at(-1)!.id).toBe('249');
});
```
`tok`, `map`, `msg` e `serverState` são construtores de dados de teste no próprio arquivo, com o jogador `p` no mapa `m1` e o mestre `g`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/chat.test.ts apps/server/test/project.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `chat.ts` e `project.ts`** e ligar `chat.send` no `room.ts` (rng da sala, inversa `chat.markUndone`).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: chat com rolagens no servidor e projecao por jogador"
```

---

### Task 10: Conexão em tempo real

**Files:**
- Create: `apps/server/src/table/ws.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/ws.test.ts`

**Interfaces:**
- Consumes: `RoomRegistry`, `CampaignRoom.dispatch` (Task 8); `snapshotFor`, `projectEvent`, `viewerFor` (Task 9); `userFromRequest` (Task 5); `ClientMessage`, `ServerMessage`, `ActionSchema` (Task 3).
- Produces: rota `GET /ws?campaign=<id>` (WebSocket).
  - Sem sessão válida → fecha com código `4401`. Não membro → fecha com `4403`.
  - Ao conectar, envia `{ t: 'snapshot', state }`.
  - Recebe `ClientMessage`. JSON inválido ou ação que não passa no `ActionSchema` → `{ t: 'error', id, code: 'invalid' }` (com `id` nulo se não der para ler) e a conexão continua aberta.
  - `dispatch` ok → `{ t: 'ack', id }` para quem mandou; para cada conexão da campanha, cada evento passa por `projectEvent` com o viewer daquela conexão e, se não for nulo, é enviado como `{ t: 'event', event }`. Usuários em `resnapshot` recebem um snapshot novo em vez dos eventos. Membro removido tem as conexões fechadas com `4403`.
  - `dispatch` com erro → `{ t: 'error', id, code, message }` só para quem mandou.
  - Ação recebida pelo WebSocket entra com `via: 'web'`.
  - Uma pessoa pode ter várias conexões (abas); todas recebem.

- [ ] **Step 1: Escrever os testes que falham**

O app de teste sobe numa porta livre (`app.listen({ port: 0 })`); o helper `connect(cookie, campaignId)` abre um cliente `ws` e expõe `next(pred?)`, que espera a próxima mensagem que satisfaça o predicado, com timeout de 2 s.

```ts
it('recusa sem login e quem não é membro', async () => {
  const { t, url, campaignId } = await wsSetup();
  expect(await closeCode(url, '', campaignId)).toBe(4401);
  const other = await login(t.app, 'Intruso');
  expect(await closeCode(url, other.cookie, campaignId)).toBe(4403);
});
it('ação do mestre chega aos dois; erro só a quem mandou', async () => {
  const { gm, pl, m1 } = await wsSetup();
  await gm.next(m => m.t === 'snapshot'); await pl.next(m => m.t === 'snapshot');
  gm.send({ t: 'cmd', id: 'c1', action: { type: 'token.create', mapId: m1, name: 'Goblin', x: 1, y: 1 } });
  expect(await gm.next(m => m.t === 'ack')).toEqual({ t: 'ack', id: 'c1' });
  expect(await pl.next(m => m.t === 'event')).toMatchObject({ event: { type: 'token.upserted', token: { name: 'Goblin' } } });
  pl.send({ t: 'cmd', id: 'c2', action: { type: 'undo' } });
  expect(await pl.next(m => m.t === 'error')).toMatchObject({ id: 'c2', code: 'forbidden' });
});
it('lixo não derruba a conexão', async () => {
  const { pl } = await wsSetup();
  pl.raw('isso não é json');
  expect(await pl.next(m => m.t === 'error')).toMatchObject({ id: null, code: 'invalid' });
  pl.send({ t: 'cmd', id: 'c3', action: { type: 'chat.send', text: 'ainda aqui' } });
  expect(await pl.next(m => m.t === 'ack')).toEqual({ t: 'ack', id: 'c3' });
});
it('token escondido não chega e token que vai para a camada do mestre some', async () => {
  const { gm, pl, m1 } = await wsSetup();
  gm.send({ t: 'cmd', id: 'a', action: { type: 'token.create', mapId: m1, name: 'Emboscada', x: 2, y: 2, layer: 'gm' } });
  gm.send({ t: 'cmd', id: 'b', action: { type: 'token.create', mapId: m1, name: 'Visível', x: 3, y: 3 } });
  const ev = await pl.next(m => m.t === 'event' && m.event.type === 'token.upserted');
  expect(ev.event.token.name).toBe('Visível');
  gm.send({ t: 'cmd', id: 'c', action: { type: 'token.update', tokenId: ev.event.token.id, layer: 'gm' } });
  expect(await pl.next(m => m.t === 'event')).toEqual({ t: 'event', event: { type: 'token.removed', tokenId: ev.event.token.id } });
});
it('mudar o mapa do jogador manda snapshot novo', async () => {
  const { gm, pl, m2, player } = await wsSetup({ secondMap: true });
  gm.send({ t: 'cmd', id: 'm', action: { type: 'member.setMap', userId: player.userId, mapId: m2 } });
  const snap = await pl.next(m => m.t === 'snapshot');
  expect(snap.state.maps.map((x: MapInfo) => x.id)).toEqual([m2]);
});
it('quem volta depois de cair vê a mesa atual', async () => {
  const { gm, pl, m1, reconnectPlayer } = await wsSetup();
  gm.send({ t: 'cmd', id: 'a', action: { type: 'token.create', mapId: m1, name: 'Lia', x: 0, y: 0 } });
  const created = await pl.next(m => m.t === 'event');
  pl.close();
  gm.send({ t: 'cmd', id: 'b', action: { type: 'token.update', tokenId: created.event.token.id, x: 6, y: 6 } });
  await gm.next(m => m.t === 'ack' && m.id === 'b');
  const back = await reconnectPlayer();
  const snap = await back.next(m => m.t === 'snapshot');
  expect(snap.state.tokens).toEqual([expect.objectContaining({ x: 6, y: 6 })]);
});
it('membro removido é desconectado', async () => {
  const { gm, pl, player } = await wsSetup();
  gm.send({ t: 'cmd', id: 'r', action: { type: 'member.remove', userId: player.userId } });
  expect(await pl.closed()).toBe(4403);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/ws.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `ws.ts`** (`@fastify/websocket`; mapa de conexões por campanha com o userId de cada uma; viewer recalculado do estado da sala a cada envio) e registrar no `buildApp` com um `RoomRegistry`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: conexao em tempo real da mesa"
```

---

### Task 11: Base do navegador: entrada, campanhas e convite

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/i18n/pt-BR.ts`, `apps/web/src/pages/HomePage.tsx`, `apps/web/src/pages/InvitePage.tsx`, `apps/web/src/styles.css`
- Modify: `package.json` (script `dev` = `concurrently -n server,web "npm run dev -w apps/server" "npm run dev -w apps/web"`), `vitest.workspace.ts` (adicionar `apps/web`)
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // api.ts
  export class ApiError extends Error { status: number; code: string }
  export const api: {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    del(path: string): Promise<void>;
    upload(campaignId: string, file: File): Promise<{ key: string; width: number; height: number; url: string }>;
  };
  // i18n/pt-BR.ts
  export const t: { /* todos os textos da interface, agrupados por tela */ };
  export function errorText(code: string): string; // 'forbidden', 'invalid', 'not_found', 'nothing_to_undo', 'dice', 'invalid_image', 'too_large', 'unauthenticated' e padrão
  ```
- Rotas: `/` (`HomePage`), `/convite/:token` (`InvitePage`), `/c/:id` (`TablePage`, Task 14; nesta task, um placeholder com o nome da campanha).
- `HomePage`: sem login, botão "Entrar com Discord" (link para `/auth/discord`) e, em desenvolvimento (`import.meta.env.DEV`), um campo de nome para o login de desenvolvimento. Com login: lista "Suas campanhas" (nome, papel, versão das regras) e formulário "Nova campanha" (nome, versão 2014 ou 2024, permitir misturar versões).
- `InvitePage`: mostra "Você foi convidado para <campanha>" e o botão "Entrar na campanha"; se já for membro, vai direto para a mesa; sem login, guarda o convite e manda para o login.
- O Vite faz proxy de `/api`, `/auth`, `/files` e `/ws` (com `ws: true`) para `http://localhost:3000`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { api, ApiError } from './api';
it('transforma erro do servidor em ApiError com código', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) as typeof fetch;
  await expect(api.post('/api/campaigns/x/invites')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
});
it('get devolve o JSON', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([{ id: '1' }]), { status: 200 })) as typeof fetch;
  expect(await api.get('/api/campaigns')).toEqual([{ id: '1' }]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/web/src/api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o app, `api.ts`, `pt-BR.ts`, as páginas e o estilo base** (visual escuro dos mockups de referência no spec, seção 9).

- [ ] **Step 4: Rodar testes, typecheck e conferir no navegador**

Run: `npx vitest run apps/web && npm run typecheck && npm run build -w apps/web`
Expected: PASS e build sem erros.
Run: `DEV_LOGIN=true npm run dev`, abrir `http://localhost:5173`, entrar como "Mestre", criar a campanha "Teste", gerar convite pela API (`POST /api/campaigns/<id>/invites`), abrir o link em outra janela anônima, entrar como "Lia" e aceitar.
Expected: a campanha aparece na lista dos dois, com papéis Mestre e Jogador.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: entrada, lista de campanhas e convite no navegador"
```

---

### Task 12: Estado da mesa no navegador

**Files:**
- Create: `apps/web/src/table/socket.ts`, `apps/web/src/table/store.ts`
- Test: `apps/web/src/table/store.test.ts`, `apps/web/src/table/socket.test.ts`

**Interfaces:**
- Consumes: `ClientState`, `StateEvent`, `ServerMessage`, `ClientMessage`, `Action` (Task 3).
- Produces:
  ```ts
  // store.ts
  export function reduceEvent(state: ClientState, event: StateEvent): ClientState; // pura
  export const useTable: UseBoundStore<StoreApi<{
    state: ClientState | null;
    status: 'connecting' | 'online' | 'offline';
    applySnapshot(s: ClientState): void;
    applyEvent(e: StateEvent): void;
    setStatus(s: 'connecting' | 'online' | 'offline'): void;
  }>>;
  // socket.ts
  export class ActionError extends Error { code: ErrorCode }
  export interface TableConnection { send(action: Action): Promise<void>; close(): void }
  export function connectTable(
    url: string,
    handlers: { onMessage(m: ServerMessage): void; onStatus(s: 'connecting' | 'online' | 'offline'): void },
    WS?: typeof WebSocket,
  ): TableConnection;
  ```
- `reduceEvent`: `*.upserted` substitui pelo id ou adiciona no fim; `token.removed` remove; `map.removed` remove o mapa e os tokens dele; `member.removed` remove o membro; `chat.added` adiciona no fim; `chat.updated` substitui pelo id; `campaign.updated` troca a campanha; `undo.available` troca `canUndo`.
- `connectTable`: gera `id` com `crypto.randomUUID()`; `send` resolve no `ack` com o mesmo id e rejeita com `ActionError(code)` no `error` com o mesmo id; ao cair, rejeita os envios pendentes com `ActionError('internal')`, chama `onStatus('offline')` e reconecta após 1 s, 2 s e depois a cada 5 s, até `close()`. Fechamento com 4401 ou 4403 não reconecta.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// store.test.ts
it('aplica eventos de token, mapa, chat e desfazer', () => {
  let s = baseState({ maps: [map('m1')], tokens: [tok('a', 'm1')] });
  s = reduceEvent(s, { type: 'token.upserted', token: tok('b', 'm1') });
  s = reduceEvent(s, { type: 'token.upserted', token: { ...tok('a', 'm1'), x: 9 } });
  expect(s.tokens.map(t => [t.id, t.x])).toEqual([['a', 9], ['b', 0]]);
  s = reduceEvent(s, { type: 'map.removed', mapId: 'm1' });
  expect(s.maps).toEqual([]); expect(s.tokens).toEqual([]);
  s = reduceEvent(s, { type: 'chat.added', message: msg('1') });
  s = reduceEvent(s, { type: 'chat.updated', message: { ...msg('1'), undone: true } });
  expect(s.chat).toEqual([{ ...msg('1'), undone: true }]);
  expect(reduceEvent(s, { type: 'undo.available', canUndo: true }).canUndo).toBe(true);
});

// socket.test.ts (FakeWS controlável: open(), receive(obj), close(code))
it('send resolve no ack e rejeita no erro', async () => {
  const conn = connectTable('ws://x', handlers, FakeWS); FakeWS.last.open();
  const p1 = conn.send({ type: 'undo' });
  FakeWS.last.receive({ t: 'ack', id: FakeWS.last.sentIds[0] });
  await expect(p1).resolves.toBeUndefined();
  const p2 = conn.send({ type: 'undo' });
  FakeWS.last.receive({ t: 'error', id: FakeWS.last.sentIds[1], code: 'forbidden', message: '' });
  await expect(p2).rejects.toMatchObject({ code: 'forbidden' });
});
it('reconecta após cair e não reconecta após 4403', async () => {
  vi.useFakeTimers();
  const conn = connectTable('ws://x', handlers, FakeWS); const first = FakeWS.last; first.open();
  first.close(1006); vi.advanceTimersByTime(1000);
  expect(FakeWS.last).not.toBe(first);
  const second = FakeWS.last; second.open(); second.close(4403); vi.advanceTimersByTime(10000);
  expect(FakeWS.last).toBe(second);
  conn.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/web/src/table`
Expected: FAIL.

- [ ] **Step 3: Implementar `store.ts` e `socket.ts`.**

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/web && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: estado da mesa e conexao no navegador"
```

---

### Task 13: Mapa com grid e tokens

**Files:**
- Create: `apps/web/src/table/MapCanvas.tsx`, `apps/web/src/table/camera.ts`
- Test: `apps/web/src/table/camera.test.ts`

**Interfaces:**
- Consumes: `cellToPixel`, `pixelToCell`, `isInsideGrid` (Task 3); `useTable` (Task 12); `TableConnection` (Task 12).
- Produces:
  ```ts
  // camera.ts — puro
  export interface Camera { x: number; y: number; zoom: number } // deslocamento em pixels de tela e escala
  export function screenToWorld(cam: Camera, sx: number, sy: number): { wx: number; wy: number };
  export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera; // mantém fixo o ponto sob o cursor; zoom entre 0.25 e 4
  // MapCanvas.tsx
  export function MapCanvas(props: { mapId: string; conn: TableConnection; onError(code: string): void }): JSX.Element;
  ```
- Comportamento: imagem do mapa ao fundo; linhas do grid com `gridSize` e deslocamentos; cada token como círculo com a cor e a inicial do nome (ou a imagem, se houver), ocupando `size` células, com o nome embaixo; tokens da camada `gm` com 50% de opacidade (só o mestre os recebe). Arrastar um token que a pessoa pode mover encaixa no grid ao soltar e envia `token.update` com `x` e `y`; o token fica na posição nova na hora e volta se o servidor recusar. Arrastar o fundo move a câmera; a roda do mouse dá zoom no cursor. Quem não pode mover não consegue arrastar: mestre sempre; jogador se for dono e `playersCanMove` for true.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('converte tela para mundo com deslocamento e zoom', () => {
  expect(screenToWorld({ x: 100, y: 50, zoom: 2 }, 300, 250)).toEqual({ wx: 100, wy: 100 });
});
it('zoom mantém o ponto sob o cursor e respeita os limites', () => {
  const cam = zoomAt({ x: 0, y: 0, zoom: 1 }, 200, 100, 2);
  expect(screenToWorld(cam, 200, 100)).toEqual({ wx: 200, wy: 100 });
  expect(zoomAt({ x: 0, y: 0, zoom: 4 }, 0, 0, 2).zoom).toBe(4);
  expect(zoomAt({ x: 0, y: 0, zoom: 0.25 }, 0, 0, 0.5).zoom).toBe(0.25);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/web/src/table/camera.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `camera.ts` e `MapCanvas.tsx`** com PixiJS 8 (`Application` criada uma vez por montagem, destruída ao desmontar; a cena é redesenhada a partir do `useTable`).

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npx vitest run apps/web && npm run typecheck`
Expected: PASS. A verificação visual é feita na Task 14, quando o mapa entra na tela da mesa.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: mapa com grid, tokens e camera"
```

---

### Task 14: Tela da mesa, chat e painel do mestre

**Files:**
- Create: `apps/web/src/table/TablePage.tsx`, `apps/web/src/table/ChatPanel.tsx`, `apps/web/src/table/GmPanel.tsx`, `apps/web/src/table/RollView.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/i18n/pt-BR.ts`
- Test: `apps/web/src/table/RollView.test.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 11 a 13; `api.upload` (Task 11).
- Produces:
  - `TablePage`: abre `connectTable('/ws?campaign=<id>')` (URL relativa convertida para `ws://` ou `wss://`), alimenta o `useTable` e mostra o mapa efetivo de quem está vendo, com o chat à direita e, para o mestre, o painel à esquerda. Mostra "Reconectando…" quando `status` for `offline`. Fechamento 4403 leva para `/` com o aviso "Você não faz mais parte desta campanha".
  - `ChatPanel`: lista de mensagens com autor, hora e rolagens; sussurros e rolagens secretas com destaque e a indicação de quem vê; mensagens desfeitas riscadas com o selo "desfeito". Campo de texto que envia `chat.send`. Erros do servidor aparecem embaixo do campo com `errorText`.
  - `RollView(props: { roll: RollResult }): JSX.Element`: mostra a expressão, cada dado (os descartados por kh ou kl riscados) e o total em destaque.
  - `GmPanel` (só mestre):
    - Mapas: enviar imagem (`api.upload`, depois `map.create`), renomear, excluir, marcar como padrão, ajustar o grid (tamanho e deslocamentos em campos numéricos com pré-visualização ao vivo, `map.update` ao confirmar), escolher o mapa de cada jogador (`member.setMap`, "Padrão" = nulo).
    - Tokens: criar no centro do mapa visível (nome, cor, tamanho, camada, donos entre os membros), editar e excluir o token selecionado.
    - Mesa: alternar "Jogadores podem mover tokens" (`campaign.update`), gerar e copiar link de convite (`POST /api/campaigns/:id/invites`), tornar membro mestre ou jogador, remover membro (com confirmação dentro da página).
    - Botão "Desfazer" habilitado por `canUndo`, também em Ctrl+Z quando o foco não está num campo de texto.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { render, screen } from '@testing-library/react';
it('mostra total e risca dados descartados', () => {
  const roll = { source: '2d20kh1+5', total: 20, terms: [
    { term: { kind: 'dice', sign: 1, count: 2, faces: 20, keep: { mode: 'h', n: 1 } }, rolls: [4, 15], kept: [15], subtotal: 15 },
    { term: { kind: 'const', sign: 1, value: 5 }, rolls: [], kept: [], subtotal: 5 },
  ] } as RollResult;
  render(<RollView roll={roll} />);
  expect(screen.getByText('20')).toBeTruthy();
  expect(screen.getByText('4').closest('s')).toBeTruthy();
  expect(screen.getByText('15').closest('s')).toBeNull();
});
```
(Vitest do pacote web com ambiente `jsdom` e `@testing-library/react`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/web/src/table/RollView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `RollView`, `ChatPanel`, `GmPanel` e `TablePage`** e trocar o placeholder de `/c/:id` em `App.tsx`.

- [ ] **Step 4: Rodar testes e conferir a sessão de ponta a ponta**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.
Run: `DEV_LOGIN=true npm run dev`; janela normal como "Mestre", janela anônima como "Lia" pelo convite. Conferir, nesta ordem:
1. Mestre envia uma imagem de mapa, ajusta o grid e cria o token "Lia" com dono Lia e o token "Goblin" na camada do mestre.
2. Lia vê o mapa e o token dela, mas não vê o Goblin; move o próprio token e o mestre vê o movimento.
3. Lia não consegue arrastar o token de outra pessoa; com "Jogadores podem mover" desligado, também não arrasta o dela.
4. `/r 1d20+5 Ataque` aparece para os dois; `/gr 1d20` de Lia aparece só para Lia e o mestre; `/w Lia oi` do mestre aparece só para os dois.
5. Mestre usa Desfazer duas vezes: o último movimento volta e a última rolagem fica riscada.
6. Lia recarrega a página e volta para a mesa como estava.
7. Mestre cria um segundo mapa e manda Lia para ele: a tela de Lia troca de mapa sozinha.
Expected: todos os sete passos acontecem como descrito, sem erro no console do navegador nem no terminal.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: tela da mesa com chat e painel do mestre"
```

---

### Task 15: Build de produção e documentação de desenvolvimento

**Files:**
- Modify: `apps/server/src/app.ts` (servir `config.webDist` com `@fastify/static` e devolver `index.html` para rotas desconhecidas fora de `/api`, `/auth`, `/files` e `/ws`), `package.json` (script `start` = `node apps/server/dist/index.js`), `README.MD`
- Test: `apps/server/test/static.test.ts`

**Interfaces:**
- Consumes: `buildApp`, `Config.webDist` (Task 4).
- Produces: `npm run build` gera `apps/web/dist` e `apps/server/dist/index.js`; `NODE_ENV=production WEB_DIST=apps/web/dist DATABASE_URL=… npm start` sobe tudo numa porta.
- README: o que é o projeto, como rodar em desenvolvimento (`npm install`, `DEV_LOGIN=true npm run dev`), variáveis de ambiente (as da `Config`), como criar o app no Discord Developer Portal (redirect `PUBLIC_URL/auth/discord/callback`, escopo `identify`), como gerar migração (`npm run db:generate -w apps/server`), atribuição CC-BY-4.0 do SRD reservada para o marco 2, e os notebooks de 2024 como material de pesquisa.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('serve o index.html para rotas do app e não engole a API', async () => {
  const dir = await makeTempDir({ 'index.html': '<!doctype html><title>RpgAi</title>' });
  const t = await createTestApp({ config: { ...testConfig(), webDist: dir } });
  expect((await t.app.inject({ url: '/c/qualquer' })).body).toContain('<title>RpgAi</title>');
  expect((await t.app.inject({ url: '/api/me' })).statusCode).toBe(401);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/test/static.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o serviço de arquivos estáticos, o script `start` e o README.**

- [ ] **Step 4: Rodar tudo e testar o build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS e build dos três pacotes.
Run: `NODE_ENV=production WEB_DIST=apps/web/dist PUBLIC_URL=http://localhost:3000 DATABASE_URL=pglite:./data/prod-teste npm start` e abrir `http://localhost:3000`.
Expected: a tela de entrada aparece com o botão "Entrar com Discord" e sem o login de desenvolvimento.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: build de producao e guia de desenvolvimento"
```

---

## Fora deste plano

- **Publicar num servidor de teste** (Fase 0 do spec): depende de escolher a hospedagem e de credenciais do Paulo. O build de produção da Task 15 é o que será publicado.
- **Itens da seção 6 do spec que ficam para marcos seguintes:** "ver a mesa como um jogador" (6.2) e régua e desenho livre (6.3) entram no marco 3, junto com a visão; barra de vida, condições e controle de quanto da vida o jogador vê (6.5) entram no marco 2, com as fichas.
- **Marcos 2 a 7 da Fase 1** (fichas e compêndio, paredes e visão, batalha, recursos de mesa, API/MCP e outros sistemas, sessão de teste): cada um recebe o próprio plano quando chegar a vez.
