import { describe, expect, it } from 'vitest';
import { screenToWorld, zoomAt } from './camera';

describe('camera', () => {
  it('converte tela para mundo com deslocamento e zoom', () => {
    expect(screenToWorld({ x: 100, y: 50, zoom: 2 }, 300, 250)).toEqual({ wx: 100, wy: 100 });
  });
  it('zoom mantém o ponto sob o cursor e respeita os limites', () => {
    const cam = zoomAt({ x: 0, y: 0, zoom: 1 }, 200, 100, 2);
    expect(screenToWorld(cam, 200, 100)).toEqual({ wx: 200, wy: 100 });
    expect(zoomAt({ x: 0, y: 0, zoom: 4 }, 0, 0, 2).zoom).toBe(4);
    expect(zoomAt({ x: 0, y: 0, zoom: 0.25 }, 0, 0, 0.5).zoom).toBe(0.25);
  });
});
