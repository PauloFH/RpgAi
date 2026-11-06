import { useEffect, useState, type FormEvent } from 'react';
import type { MapInfo } from '@rpgai/shared';
import { t } from '../../i18n/pt-BR';
import type { GridPreview } from '../MapCanvas';
import type { TableConnection } from '../socket';
import { useAction } from '../useAction';

interface GridDraft {
  gridSize: string;
  gridOffsetX: string;
  gridOffsetY: string;
}

const draftOf = (map: MapInfo): GridDraft => ({
  gridSize: String(map.gridSize),
  gridOffsetX: String(map.gridOffsetX),
  gridOffsetY: String(map.gridOffsetY),
});

const intIn = (text: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
};

/** The same limits as map.update, so what passes here is what the server accepts. */
function parseDraft(draft: GridDraft): Omit<GridPreview, 'mapId'> | null {
  const gridSize = intIn(draft.gridSize, 10, 500);
  const gridOffsetX = intIn(draft.gridOffsetX, 0, 499);
  const gridOffsetY = intIn(draft.gridOffsetY, 0, 499);
  if (gridSize === null || gridOffsetX === null || gridOffsetY === null) return null;
  return { gridSize, gridOffsetX, gridOffsetY };
}

interface GridFormProps {
  map: MapInfo;
  conn: TableConnection;
  onPreview(preview: GridPreview | null): void;
}

/** Mount with key={map.id}: a draft belongs to one map. */
export function GridForm({ map, conn, onPreview }: GridFormProps) {
  const { error, run } = useAction();
  const [draft, setDraft] = useState(() => draftOf(map));
  const parsed = parseDraft(draft);
  const changed =
    parsed !== null &&
    (parsed.gridSize !== map.gridSize || parsed.gridOffsetX !== map.gridOffsetX || parsed.gridOffsetY !== map.gridOffsetY);
  const preview = changed ? parsed : null;

  // The map changed (this form's confirm, an undo): the draft follows the real grid.
  useEffect(() => setDraft(draftOf(map)), [map.gridSize, map.gridOffsetX, map.gridOffsetY]);

  useEffect(() => {
    onPreview(preview && { mapId: map.id, ...preview });
  }, [map.id, onPreview, preview?.gridSize, preview?.gridOffsetX, preview?.gridOffsetY]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (preview) void run(() => conn.send({ type: 'map.update', mapId: map.id, ...preview }));
  };

  const field = (key: keyof GridDraft, label: string, min: number, max: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <form className="stack" onSubmit={confirm} aria-label={t.gm.grid.title}>
      <h4>{t.gm.grid.title}</h4>
      <div className="grid-fields">
        {field('gridSize', t.gm.grid.size, 10, 500)}
        {field('gridOffsetX', t.gm.grid.offsetX, 0, 499)}
        {field('gridOffsetY', t.gm.grid.offsetY, 0, 499)}
      </div>
      {!parsed && <p className="dim">{t.gm.grid.invalid}</p>}
      <div className="row">
        <button type="submit" disabled={!changed}>
          {t.gm.grid.apply}
        </button>
        <button type="button" disabled={!changed} onClick={() => setDraft(draftOf(map))}>
          {t.gm.grid.cancel}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
