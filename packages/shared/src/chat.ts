import { parseDice, DiceError, MAX_DICE, type DiceExpr } from './dice';

export type ChatIntent =
  | { kind: 'text'; text: string; inline: DiceExpr[] }
  | { kind: 'roll'; expr: DiceExpr; label: string | null; secret: boolean }
  | { kind: 'whisper'; to: string; text: string; inline: DiceExpr[] };

export type ChatErrorCode = 'empty' | 'too_long' | 'unknown_command' | 'bad_whisper';

export class ChatError extends Error {
  code: ChatErrorCode;
  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatError';
    this.code = code;
  }
}

const MAX_CHAT = 2000;

function inlineRolls(text: string): DiceExpr[] {
  const exprs: DiceExpr[] = [];
  let dice = 0;
  for (const m of text.matchAll(/\[\[(.+?)\]\]/g)) {
    const expr = parseDice(m[1]!);
    for (const term of expr.terms) if (term.kind === 'dice') dice += term.count;
    // The cap in parseDice is per expression; this one is per message.
    if (dice > MAX_DICE) throw new DiceError('too_many_dice');
    exprs.push(expr);
  }
  return exprs;
}

function parseRoll(rest: string, secret: boolean): ChatIntent {
  const words = rest.split(/\s+/).filter((w) => w.length > 0);
  for (let k = words.length; k >= 1; k--) {
    try {
      const expr = parseDice(words.slice(0, k).join(' '));
      const label = words.slice(k).join(' ');
      return { kind: 'roll', expr, label: label === '' ? null : label, secret };
    } catch (e) {
      if (!(e instanceof DiceError)) throw e;
    }
  }
  // nenhum prefixo válido: relança o erro da primeira palavra
  return parseDice(words[0] ?? '') as never;
}

function parseWhisper(rest: string): ChatIntent {
  let to: string;
  let text: string;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end === -1) throw new ChatError('bad_whisper');
    to = rest.slice(1, end).trim();
    text = rest.slice(end + 1).trim();
  } else {
    const m = /^(\S+)\s*([\s\S]*)$/.exec(rest);
    to = m?.[1] ?? '';
    text = (m?.[2] ?? '').trim();
  }
  if (to === '' || text === '') throw new ChatError('bad_whisper');
  return { kind: 'whisper', to, text, inline: inlineRolls(text) };
}

export function parseChat(input: string): ChatIntent {
  const s = input.trim();
  if (s === '') throw new ChatError('empty');
  if (s.length > MAX_CHAT) throw new ChatError('too_long');
  if (!s.startsWith('/')) return { kind: 'text', text: s, inline: inlineRolls(s) };

  const m = /^\/(\S*)\s*([\s\S]*)$/.exec(s)!;
  const cmd = m[1]!.toLowerCase();
  const rest = m[2]!;
  switch (cmd) {
    case 'r':
    case 'roll':
      return parseRoll(rest, false);
    case 'gr':
      return parseRoll(rest, true);
    case 'w':
      return parseWhisper(rest);
    default:
      throw new ChatError('unknown_command');
  }
}
