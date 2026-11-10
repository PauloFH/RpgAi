import { describe, expect, it } from 'vitest';
import type { CampaignInfo, ChatMessage, Member, Token } from './types';
import { canSeeMessage, canSeeToken, effectiveMapId } from './visibility';

const P = { userId: 'p', role: 'player' as const, mapId: 'm1' };
const G = { userId: 'g', role: 'gm' as const, mapId: null };
const tok = (o: Partial<Token>) => ({ id: 't', mapId: 'm1', name: 'T', x: 0, y: 0, size: 1, color: '#000000', imageUrl: null, layer: 'tokens', ownerIds: [], ...o }) as Token;

describe('visibility', () => {
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
});
