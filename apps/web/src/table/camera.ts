export interface Camera { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function screenToWorld(cam: Camera, sx: number, sy: number): { wx: number; wy: number } {
  return { wx: (sx - cam.x) / cam.zoom, wy: (sy - cam.y) / cam.zoom };
}

export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const { wx, wy } = screenToWorld(cam, sx, sy);
  return { x: sx - wx * zoom, y: sy - wy * zoom, zoom };
}

export function fitCamera(viewW: number, viewH: number, mapW: number, mapH: number): Camera {
  if (viewW <= 0 || viewH <= 0 || mapW <= 0 || mapH <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewW / mapW, viewH / mapH)));
  return { x: (viewW - mapW * zoom) / 2, y: (viewH - mapH * zoom) / 2, zoom };
}
