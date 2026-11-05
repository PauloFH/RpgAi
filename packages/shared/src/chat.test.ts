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
    expect(parseChat('/r 1d20 5 dano')).toMatchObject({ label: '5 dano', expr: { source: '1d20' } });
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
