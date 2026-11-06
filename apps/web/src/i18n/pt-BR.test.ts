import { describe, expect, it } from 'vitest';
import { errorText } from './pt-BR';

const FALLBACK = errorText('codigo-que-nao-existe');

describe('errorText', () => {
  it.each(['unknown_member', 'unknown_command', 'bad_whisper', 'outside_grid', 'last_gm', 'campaign_storage_full'])(
    '%s tem texto próprio',
    (code) => {
      expect(errorText(code)).not.toBe(FALLBACK);
      expect(errorText(code)).not.toBe(errorText('invalid'));
    },
  );
  it.each(['unknown_member', 'bad_whisper'])('%s mostra a sintaxe para nomes com espaço', (code) => {
    expect(errorText(code)).toContain('/w "Paulo Roberto" oi');
  });
});
