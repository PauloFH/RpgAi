import { expect, it } from 'vitest';
import { cryptoRng } from '../src/table/rng';

it('cryptoRng fica entre 1 e faces', () => {
  for (let i = 0; i < 1000; i++) { const v = cryptoRng(6); expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); }
});
