import { describe, expect, it } from 'vitest';
import { cellToPixel, gridCols, gridRows, isInsideGrid, pixelToCell } from './grid';

const m = { id: 'm', name: 'M', imageUrl: null, width: 710, height: 425, gridSize: 70, gridOffsetX: 10, gridOffsetY: 5 };

describe('grid', () => {
  it('converte célula e pixel', () => {
    expect(gridCols(m)).toBe(10);
    expect(gridRows(m)).toBe(6);
    expect(cellToPixel(m, 2, 3)).toEqual({ px: 150, py: 215 });
    expect(pixelToCell(m, 150, 215)).toEqual({ x: 2, y: 3 });
    expect(pixelToCell(m, 149, 215)).toEqual({ x: 1, y: 3 });
  });
  it('limites do grid consideram o tamanho do token', () => {
    expect(isInsideGrid(m, 9, 5, 1)).toBe(true);
    expect(isInsideGrid(m, 9, 5, 2)).toBe(false);
    expect(isInsideGrid(m, -1, 0, 1)).toBe(false);
  });
});
