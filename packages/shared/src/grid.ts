import type { MapInfo } from './types';

export const gridCols = (m: MapInfo): number => Math.floor((m.width - m.gridOffsetX) / m.gridSize);
export const gridRows = (m: MapInfo): number => Math.floor((m.height - m.gridOffsetY) / m.gridSize);

export const cellToPixel = (m: MapInfo, x: number, y: number): { px: number; py: number } => ({
  px: m.gridOffsetX + x * m.gridSize,
  py: m.gridOffsetY + y * m.gridSize,
});

export const pixelToCell = (m: MapInfo, px: number, py: number): { x: number; y: number } => ({
  x: Math.floor((px - m.gridOffsetX) / m.gridSize),
  y: Math.floor((py - m.gridOffsetY) / m.gridSize),
});

export const isInsideGrid = (m: MapInfo, x: number, y: number, size: number): boolean =>
  x >= 0 && y >= 0 && x + size <= gridCols(m) && y + size <= gridRows(m);
