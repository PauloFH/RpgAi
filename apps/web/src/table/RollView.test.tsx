// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RollResult } from '@rpgai/shared';
import { RollView } from './RollView';

afterEach(cleanup);

describe('RollView', () => {
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

  it('com dados repetidos risca só os que sobraram', () => {
    const roll = { source: '2d6kh1', total: 5, terms: [
      { term: { kind: 'dice', sign: 1, count: 2, faces: 6, keep: { mode: 'h', n: 1 } }, rolls: [5, 5], kept: [5], subtotal: 5 },
    ] } as RollResult;
    const { container } = render(<RollView roll={roll} />);
    expect(container.querySelectorAll('s')).toHaveLength(1);
    expect(container.querySelector('s')?.textContent).toBe('5');
    expect(container.querySelectorAll('.die')).toHaveLength(2);
  });

  it('mostra o sinal dos termos negativos', () => {
    const roll = { source: '1d6-1d4-2', total: 1, terms: [
      { term: { kind: 'dice', sign: 1, count: 1, faces: 6 }, rolls: [6], kept: [6], subtotal: 6 },
      { term: { kind: 'dice', sign: -1, count: 1, faces: 4 }, rolls: [3], kept: [3], subtotal: -3 },
      { term: { kind: 'const', sign: -1, value: 2 }, rolls: [], kept: [2], subtotal: -2 },
    ] } as RollResult;
    const { container } = render(<RollView roll={roll} />);
    expect(container.querySelector('.roll-terms')?.textContent).toBe('6 − 3 − 2');
    expect(container.querySelectorAll('.roll-total')).toHaveLength(1);
    expect(container.querySelector('.roll-total')?.textContent).toBe('1');
  });

  it('mostra o sinal de um primeiro termo negativo', () => {
    const roll = { source: '-1d4', total: -2, terms: [
      { term: { kind: 'dice', sign: -1, count: 1, faces: 4 }, rolls: [2], kept: [2], subtotal: -2 },
    ] } as RollResult;
    const { container } = render(<RollView roll={roll} />);
    expect(container.querySelector('.roll-terms')?.textContent).toBe('− 2');
    expect(container.querySelector('.roll-total')?.textContent).toBe('-2');
  });
});
