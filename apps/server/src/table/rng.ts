import { randomInt } from 'node:crypto';
import type { Rng } from '@rpgai/shared';

export const cryptoRng: Rng = (faces) => randomInt(1, faces + 1);
