import { useEffect, useRef } from 'react';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { cellToPixel, isInsideGrid, pixelToCell } from '@rpgai/shared';
import type { MapInfo, Token } from '@rpgai/shared';
import { ActionError } from './socket';
import type { TableConnection } from './socket';
import { useTable } from './store';
import { fitCamera, screenToWorld, zoomAt } from './camera';
import type { Camera } from './camera';

/** A grid being adjusted but not yet confirmed; drawn in place of the map's real one. */
export interface GridPreview { mapId: string; gridSize: number; gridOffsetX: number; gridOffsetY: number }

export interface MapCanvasProps {
  mapId: string;
  conn: TableConnection;
  onError(code: string): void;
  selectedTokenId?: string | null;
  onSelectToken?(id: string | null): void;
  gridPreview?: GridPreview | null;
}

const WHEEL_FACTOR = 1.1;
const CLICK_SLOP = 4;
const GOLD = 0xffd700;
const LABEL_SCALE = 0.22; // relativo à célula, para continuar legível com a câmera afastada

interface Override { x: number; y: number; base: Token }
interface DragState {
  tokenId: string;
  startSx: number;
  startSy: number;
  grabDx: number; // ponteiro (mundo) menos canto do token no início
  grabDy: number;
  canMove: boolean;
  moved: boolean;
  wx: number; // posição livre atual do canto do token (mundo)
  wy: number;
}
interface PanState { startSx: number; startSy: number; camX: number; camY: number; moved: boolean }

export function MapCanvas({ mapId, conn, onError, selectedTokenId = null, onSelectToken, gridPreview = null }: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ mapId, conn, onError, selectedTokenId, onSelectToken, gridPreview });
  propsRef.current = { mapId, conn, onError, selectedTokenId, onSelectToken, gridPreview };
  const redrawRef = useRef<(() => void) | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let ready = false;
    const app = new Application();

    const world = new Container();
    const bgLayer = new Container();
    const gridLayer = new Graphics();
    const hintLayer = new Graphics();
    const tokenLayer = new Container();
    world.addChild(bgLayer, gridLayer, hintLayer, tokenLayer);

    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    let fittedFor: string | null = null;
    const overrides = new Map<string, Override>();
    const textures = new Map<string, Texture | null>();
    const loading = new Set<string>();
    let drag: DragState | null = null;
    let pan: PanState | null = null;
    const tokenNodes = new Map<string, Container>();

    const loadTexture = (url: string) => {
      if (textures.has(url) || loading.has(url)) return;
      loading.add(url);
      Assets.load<Texture>({ src: url, parser: 'loadTextures' })
        .then(t => textures.set(url, t), () => textures.set(url, null))
        .finally(() => {
          loading.delete(url);
          if (!disposed && ready) redraw();
        });
    };

    const canMove = (token: Token): boolean => {
      const st = useTable.getState().state;
      if (!st) return false;
      if (st.me.role === 'gm') return true;
      return st.campaign.playersCanMove && token.ownerIds.includes(st.me.userId);
    };

    const clearChildren = (c: Container) => {
      for (const child of c.removeChildren()) child.destroy({ children: true });
    };

    const buildToken = (token: Token, map: MapInfo, selected: boolean, x: number, y: number): Container => {
      const d = token.size * map.gridSize;
      const node = new Container();
      node.position.set(x, y);
      node.alpha = token.layer === 'gm' ? 0.5 : 1;
      node.hitArea = new Rectangle(0, 0, d, d);
      node.eventMode = 'static';
      node.cursor = canMove(token) ? 'grab' : 'pointer';
      node.on('pointerdown', (e: FederatedPointerEvent) => onTokenDown(e, token));

      const tex = token.imageUrl ? textures.get(token.imageUrl) : null;
      if (token.imageUrl && tex === undefined) loadTexture(token.imageUrl);
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.width = d;
        sprite.height = d;
        const mask = new Graphics().circle(d / 2, d / 2, d / 2).fill(0xffffff);
        sprite.mask = mask;
        node.addChild(sprite, mask);
      } else {
        node.addChild(new Graphics().circle(d / 2, d / 2, d / 2).fill(token.color));
        const initial = (Array.from(token.name.trim())[0] ?? '?').toUpperCase();
        const letter = new Text({
          text: initial,
          style: { fontSize: Math.max(10, d * 0.5), fill: 0xffffff, fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } },
          resolution: 2,
        });
        letter.anchor.set(0.5);
        letter.position.set(d / 2, d / 2);
        node.addChild(letter);
      }
      if (selected) node.addChild(new Graphics().circle(d / 2, d / 2, d / 2).stroke({ color: GOLD, width: 2 }));

      const label = new Text({
        text: token.name,
        style: { fontSize: Math.max(12, d * LABEL_SCALE), fill: 0xffffff, stroke: { color: 0x000000, width: 3 } },
        resolution: 2,
      });
      label.anchor.set(0.5, 0);
      label.position.set(d / 2, d + 2);
      node.addChild(label);
      return node;
    };

    function currentMap(): MapInfo | undefined {
      const { mapId: id, gridPreview: preview } = propsRef.current;
      const map = useTable.getState().state?.maps.find(m => m.id === id);
      if (!map || preview?.mapId !== id) return map;
      const { gridSize, gridOffsetX, gridOffsetY } = preview;
      return { ...map, gridSize, gridOffsetX, gridOffsetY };
    }

    function applyCamera() {
      world.position.set(cam.x, cam.y);
      world.scale.set(cam.zoom);
    }

    function dragCell(map: MapInfo, d: DragState): { x: number; y: number } {
      // o canto livre somado a meia célula, para encaixar na célula mais próxima
      return pixelToCell(map, d.wx + map.gridSize / 2, d.wy + map.gridSize / 2);
    }

    function redraw() {
      if (disposed || !ready) return;
      const st = useTable.getState().state;
      const { mapId: id, selectedTokenId: sel } = propsRef.current;
      const map = currentMap();
      clearChildren(bgLayer);
      clearChildren(tokenLayer);
      tokenNodes.clear();
      gridLayer.clear();
      hintLayer.clear();
      if (!st || !map) return;

      if (fittedFor !== id && app.screen.width > 0 && app.screen.height > 0) {
        cam = fitCamera(app.screen.width, app.screen.height, map.width, map.height);
        fittedFor = id;
      }
      applyCamera();

      const tex = map.imageUrl ? textures.get(map.imageUrl) : null;
      if (map.imageUrl && tex === undefined) loadTexture(map.imageUrl);
      if (tex) {
        const bg = new Sprite(tex);
        bg.width = map.width;
        bg.height = map.height;
        bgLayer.addChild(bg);
      } else {
        bgLayer.addChild(new Graphics().rect(0, 0, map.width, map.height).fill(0x1b1b22));
      }

      if (map.gridSize > 0) {
        for (let x = map.gridOffsetX; x <= map.width; x += map.gridSize) gridLayer.moveTo(x, 0).lineTo(x, map.height);
        for (let y = map.gridOffsetY; y <= map.height; y += map.gridSize) gridLayer.moveTo(0, y).lineTo(map.width, y);
        gridLayer.stroke({ color: 0xffffff, alpha: 0.25, width: 1, pixelLine: true });
      }

      for (const token of st.tokens) {
        if (token.mapId !== id) continue;
        let pos: { px: number; py: number };
        if (drag?.moved && drag.tokenId === token.id) {
          pos = { px: drag.wx, py: drag.wy };
        } else {
          const o = overrides.get(token.id);
          pos = cellToPixel(map, o?.x ?? token.x, o?.y ?? token.y);
        }
        const node = buildToken(token, map, token.id === sel, pos.px, pos.py);
        tokenNodes.set(token.id, node);
        tokenLayer.addChild(node);
      }
      drawHint();
    }
    redrawRef.current = redraw;

    function drawHint() {
      hintLayer.clear();
      const st = useTable.getState().state;
      const map = currentMap();
      if (!drag?.moved || !st || !map) return;
      const dragged = drag;
      const token = st.tokens.find(t => t.id === dragged.tokenId);
      if (!token) return;
      const cell = dragCell(map, dragged);
      const ok = isInsideGrid(map, cell.x, cell.y, token.size);
      const { px, py } = cellToPixel(map, cell.x, cell.y);
      const side = token.size * map.gridSize;
      hintLayer.rect(px, py, side, side).fill({ color: ok ? 0xffd700 : 0xff4444, alpha: 0.25 });
    }

    function cancelGesture() {
      if (!drag && !pan) return;
      drag = null;
      pan = null;
      redraw();
    }
    cancelRef.current = cancelGesture;

    function onTokenDown(e: FederatedPointerEvent, token: Token) {
      if (e.button !== 0) return;
      if (drag?.moved) cancelGesture();
      drag = null;
      pan = null;
      e.stopPropagation();
      const map = currentMap();
      if (!map) return;
      const { wx, wy } = screenToWorld(cam, e.global.x, e.global.y);
      const o = overrides.get(token.id);
      const { px, py } = cellToPixel(map, o?.x ?? token.x, o?.y ?? token.y);
      drag = {
        tokenId: token.id,
        startSx: e.global.x,
        startSy: e.global.y,
        grabDx: wx - px,
        grabDy: wy - py,
        canMove: canMove(token),
        moved: false,
        wx: px,
        wy: py,
      };
    }

    function onStageDown(e: FederatedPointerEvent) {
      if (e.button !== 0) return;
      if (drag?.moved) cancelGesture();
      drag = null;
      pan = { startSx: e.global.x, startSy: e.global.y, camX: cam.x, camY: cam.y, moved: false };
    }

    function onMove(e: FederatedPointerEvent) {
      if (drag) {
        if (!drag.canMove) return;
        if (!drag.moved && Math.hypot(e.global.x - drag.startSx, e.global.y - drag.startSy) < CLICK_SLOP) return;
        drag.moved = true;
        const { wx, wy } = screenToWorld(cam, e.global.x, e.global.y);
        drag.wx = wx - drag.grabDx;
        drag.wy = wy - drag.grabDy;
        tokenNodes.get(drag.tokenId)?.position.set(drag.wx, drag.wy);
        drawHint();
      } else if (pan) {
        const dx = e.global.x - pan.startSx;
        const dy = e.global.y - pan.startSy;
        if (!pan.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
        pan.moved = true;
        cam = { ...cam, x: pan.camX + dx, y: pan.camY + dy };
        applyCamera();
      }
    }

    function onUp() {
      if (pan) {
        const wasClick = !pan.moved;
        pan = null;
        if (wasClick) propsRef.current.onSelectToken?.(null);
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      const st = useTable.getState().state;
      const map = currentMap();
      const token = st?.tokens.find(t => t.id === d.tokenId);
      if (!d.moved) {
        redraw();
        if (token) propsRef.current.onSelectToken?.(token.id);
        return;
      }
      if (!st || !map || !token || token.mapId !== map.id) { redraw(); return; }
      const cell = dragCell(map, d);
      const o = overrides.get(token.id);
      const curX = o?.x ?? token.x;
      const curY = o?.y ?? token.y;
      if ((cell.x === curX && cell.y === curY) || !isInsideGrid(map, cell.x, cell.y, token.size)) {
        redraw();
        return;
      }
      const override: Override = { x: cell.x, y: cell.y, base: token };
      overrides.set(token.id, override);
      redraw();
      propsRef.current.conn
        .send({ type: 'token.update', tokenId: token.id, x: cell.x, y: cell.y })
        .catch((err: unknown) => {
          if (overrides.get(token.id) === override) overrides.delete(token.id);
          redraw();
          propsRef.current.onError(err instanceof ActionError ? err.code : 'internal');
        });
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!ready || e.deltaY === 0) return;
      const rect = app.canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
      cam = zoomAt(cam, e.clientX - rect.left, e.clientY - rect.top, factor);
      applyCamera();
    };

    const unsubscribe = useTable.subscribe((state, prev) => {
      const a = state.state;
      const b = prev.state;
      if (a && b && a.maps === b.maps && a.tokens === b.tokens && a.me === b.me
        && a.campaign.playersCanMove === b.campaign.playersCanMove) return;
      const tokens = state.state?.tokens ?? [];
      for (const [id, o] of overrides) {
        if (tokens.find(t => t.id === id) !== o.base) overrides.delete(id);
      }
      if (drag && !tokens.some(t => t.id === drag!.tokenId)) drag = null;
      redraw();
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!ready || disposed) return;
      app.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
      redraw();
    });

    app
      .init({
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
        background: 0x101014,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        ready = true;
        host.appendChild(app.canvas);
        app.canvas.style.display = 'block';
        app.canvas.addEventListener('wheel', onWheel, { passive: false });
        app.stage.addChild(world);
        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        app.stage.on('pointerdown', onStageDown);
        app.stage.on('pointermove', onMove);
        app.stage.on('pointerup', onUp);
        app.stage.on('pointerupoutside', onUp);
        app.stage.on('pointercancel', cancelGesture);
        window.addEventListener('blur', cancelGesture);
        resizeObserver.observe(host);
        redraw();
      })
      .catch(() => {
        if (!disposed) propsRef.current.onError('internal');
      });

    return () => {
      disposed = true;
      redrawRef.current = null;
      cancelRef.current = null;
      window.removeEventListener('blur', cancelGesture);
      unsubscribe();
      resizeObserver.disconnect();
      if (ready) {
        app.canvas.removeEventListener('wheel', onWheel);
        app.destroy(true, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    cancelRef.current?.();
    redrawRef.current?.();
  }, [mapId, selectedTokenId]);

  useEffect(() => {
    redrawRef.current?.();
  }, [gridPreview]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} />;
}
