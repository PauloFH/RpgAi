export type DiceTerm =
  | { kind: 'dice'; sign: 1 | -1; count: number; faces: number; keep?: { mode: 'h' | 'l'; n: number } }
  | { kind: 'const'; sign: 1 | -1; value: number };
export interface DiceExpr { source: string; terms: DiceTerm[] }
export type DiceErrorCode = 'syntax' | 'too_long' | 'too_many_dice' | 'bad_faces';

export class DiceError extends Error {
  code: DiceErrorCode;
  constructor(code: DiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DiceError';
    this.code = code;
  }
}

export type Rng = (faces: number) => number;

export interface TermResult { term: DiceTerm; rolls: number[]; kept: number[]; subtotal: number }
export interface RollResult { source: string; total: number; terms: TermResult[] }

const MAX_SOURCE = 200;
const MAX_PER_TERM = 100;
const MAX_TOTAL = 200;
const MIN_FACES = 2;
const MAX_FACES = 1000;

const isDigit = (c: string | undefined): c is string => c !== undefined && c >= '0' && c <= '9';

export function parseDice(source: string): DiceExpr {
  if (source.length > MAX_SOURCE) throw new DiceError('too_long');
  const s = source.trim().toLowerCase();
  if (s.length === 0) throw new DiceError('syntax');

  let pos = 0;
  const readInt = (): number | null => {
    const start = pos;
    while (isDigit(s[pos])) pos++;
    return pos === start ? null : Number(s.slice(start, pos));
  };

  const skipSpaces = () => {
    while (s[pos] === ' ' || s[pos] === '	') pos++;
  };

  const terms: DiceTerm[] = [];
  let totalDice = 0;
  let sign: 1 | -1 = 1;

  for (;;) {
    const first = readInt();
    if (s[pos] === 'd') {
      pos++;
      const count = first ?? 1;
      const faces = readInt();
      if (faces === null) throw new DiceError('syntax');
      if (count < 1) throw new DiceError('syntax');
      if (count > MAX_PER_TERM) throw new DiceError('too_many_dice');
      if (faces < MIN_FACES || faces > MAX_FACES) throw new DiceError('bad_faces');
      let keep: { mode: 'h' | 'l'; n: number } | undefined;
      if (s[pos] === 'k') {
        const mode = s[pos + 1];
        if (mode !== 'h' && mode !== 'l') throw new DiceError('syntax');
        pos += 2;
        const n = readInt();
        if (n === null || n < 1 || n > count) throw new DiceError('syntax');
        keep = { mode, n };
      }
      totalDice += count;
      if (totalDice > MAX_TOTAL) throw new DiceError('too_many_dice');
      terms.push(keep ? { kind: 'dice', sign, count, faces, keep } : { kind: 'dice', sign, count, faces });
    } else {
      if (first === null) throw new DiceError('syntax');
      terms.push({ kind: 'const', sign, value: first });
    }

    skipSpaces();
    if (pos >= s.length) break;
    const op = s[pos];
    if (op === '+') sign = 1;
    else if (op === '-') sign = -1;
    else throw new DiceError('syntax');
    pos++;
    skipSpaces();
  }

  return { source, terms };
}

export function rollDice(expr: DiceExpr, rng: Rng): RollResult {
  const results: TermResult[] = expr.terms.map((term) => {
    if (term.kind === 'const') {
      return { term, rolls: [], kept: [term.value], subtotal: term.sign * term.value };
    }
    const rolls: number[] = [];
    for (let i = 0; i < term.count; i++) rolls.push(rng(term.faces));
    const sorted = [...rolls].sort((a, b) => b - a);
    let kept = sorted;
    if (term.keep) {
      kept = term.keep.mode === 'h' ? sorted.slice(0, term.keep.n) : sorted.slice(sorted.length - term.keep.n);
    }
    const subtotal = term.sign * kept.reduce((a, b) => a + b, 0);
    return { term, rolls, kept, subtotal };
  });
  return { source: expr.source, total: results.reduce((a, r) => a + r.subtotal, 0), terms: results };
}
