import { parseChat, rollDice, type ChatMessage, type Member, type Rng } from '@rpgai/shared';

export type NewMessage = Omit<ChatMessage, 'id' | 'createdAt' | 'undone'>;

/**
 * Turns the text a member typed into a chat message, rolling any dice with `rng`.
 * Throws DiceError, ChatError, or Error('unknown_member') for an unknown or ambiguous whisper target.
 */
export function buildMessage(input: { text: string; authorId: string; members: Member[]; rng: Rng }): NewMessage {
  const { authorId, members, rng } = input;
  const intent = parseChat(input.text);
  switch (intent.kind) {
    case 'text':
      return {
        authorId,
        kind: 'text',
        text: intent.text,
        label: null,
        rolls: intent.inline.map((e) => rollDice(e, rng)),
        secret: false,
        recipients: null,
      };
    case 'roll': {
      const recipients = intent.secret
        ? [...new Set([authorId, ...members.filter((m) => m.role === 'gm').map((m) => m.userId)])]
        : null;
      return {
        authorId,
        kind: 'roll',
        text: intent.expr.source,
        label: intent.label,
        rolls: [rollDice(intent.expr, rng)],
        secret: intent.secret,
        recipients,
      };
    }
    case 'whisper': {
      const name = intent.to.toLowerCase();
      const targets = members.filter((m) => m.displayName.toLowerCase() === name);
      if (targets.length !== 1) throw new Error('unknown_member');
      return {
        authorId,
        kind: 'whisper',
        text: intent.text,
        label: null,
        rolls: intent.inline.map((e) => rollDice(e, rng)),
        secret: false,
        recipients: [...new Set([authorId, targets[0]!.userId])],
      };
    }
  }
}
