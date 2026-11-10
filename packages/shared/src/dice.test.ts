import { describe, it, expect } from 'vitest';
import { parseDice, rollDice, DiceError } from './dice';

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
    expect(code('1d20 5')).toBe('syntax');
    expect(code('1 d20')).toBe('syntax');
    expect(code('2d20 kh1')).toBe('syntax');
    expect(code('101d6')).toBe('too_many_dice');
    expect(code('60d6+60d6+60d6+60d6')).toBe('too_many_dice');
    expect(code('1000000d6')).toBe('too_many_dice');
    expect(code('1d1')).toBe('bad_faces');
    expect(code('1d1001')).toBe('bad_faces');
    expect(code('1'.repeat(201))).toBe('too_long');
  });
});
