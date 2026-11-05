import { describe, expect, it } from 'vitest';
import { ActionSchema } from './actions';

const id = '00000000-0000-4000-8000-000000000001';

describe('ActionSchema', () => {
  it('aceita token.create válido e preenche padrões', () => {
    const a = ActionSchema.parse({ type: 'token.create', mapId: id, name: 'Lia', x: 2, y: 3 });
    expect(a).toMatchObject({ size: 1, color: '#5b8fd9', layer: 'tokens', ownerIds: [] });
  });
  it('rejeita cor fora do formato, campo extra e tipo desconhecido', () => {
    expect(ActionSchema.safeParse({ type: 'token.create', mapId: id, name: 'L', x: 0, y: 0, color: 'red' }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'undo', extra: 1 }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'token.explode' }).success).toBe(false);
  });
  it('token.update não aplica padrões', () => {
    expect(ActionSchema.parse({ type: 'token.update', tokenId: id })).toEqual({ type: 'token.update', tokenId: id });
  });
});
