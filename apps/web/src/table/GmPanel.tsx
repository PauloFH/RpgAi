import { useEffect } from 'react';
import type { ClientState, MapInfo, Token } from '@rpgai/shared';
import { t } from '../i18n/pt-BR';
import { MapsSection } from './gm/MapsSection';
import { TableSection } from './gm/TableSection';
import { TokensSection } from './gm/TokensSection';
import type { GridPreview } from './MapCanvas';
import type { TableConnection } from './socket';
import { useAction } from './useAction';

const isUndoKey = (e: KeyboardEvent): boolean =>
  (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';

const isFormField = (el: Element | null): boolean => el?.matches('input, textarea, select') ?? false;

export interface GmPanelProps {
  state: ClientState;
  conn: TableConnection;
  map: MapInfo | null;
  onViewMap(id: string): void;
  selectedToken: Token | null;
  onSelectToken(id: string | null): void;
  onGridPreview(preview: GridPreview | null): void;
}

export function GmPanel({ state, conn, map, onViewMap, selectedToken, onSelectToken, onGridPreview }: GmPanelProps) {
  const { error, run } = useAction();
  const { canUndo } = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isUndoKey(e) || isFormField(document.activeElement)) return;
      e.preventDefault();
      if (canUndo && !e.repeat) void run(() => conn.send({ type: 'undo' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canUndo, conn, run]);

  return (
    <aside className="gm-panel" aria-label={t.gm.title}>
      <div className="gm-undo">
        <button type="button" disabled={!canUndo} onClick={() => void run(() => conn.send({ type: 'undo' }))}>
          {t.gm.undo}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <MapsSection state={state} conn={conn} map={map} onViewMap={onViewMap} onGridPreview={onGridPreview} />
      <TokensSection state={state} conn={conn} map={map} selected={selectedToken} onSelect={onSelectToken} />
      <TableSection state={state} conn={conn} />
    </aside>
  );
}
