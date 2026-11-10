import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorText, t } from '../i18n/pt-BR';
import { useTitle } from '../useTitle';
import { ChatPanel } from './ChatPanel';
import { GmPanel } from './GmPanel';
import { MapCanvas, type GridPreview } from './MapCanvas';
import { viewedMap } from './mapView';
import { connectTable, tableSocketUrl, type TableConnection } from './socket';
import { useTable } from './store';

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;

export function TablePage({ campaignId }: { campaignId: string }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const state = useTable((s) => s.state);
  const status = useTable((s) => s.status);
  const [conn, setConn] = useState<TableConnection | null>(null);
  const [localMapId, setLocalMapId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gridPreview, setGridPreview] = useState<GridPreview | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  useTitle(`${state?.campaign.name ?? t.campaign.title} - ${t.app.name}`);

  useEffect(() => {
    const table = useTable.getState();
    let opened: TableConnection | null = null;
    // Deferred so that StrictMode's immediate unmount does not open a socket just to abort it.
    const start = setTimeout(() => {
      opened = connectTable(tableSocketUrl(campaignId), {
        onMessage(m) {
          if (m.t === 'snapshot') table.applySnapshot(m.state);
          else if (m.t === 'event') table.applyEvent(m.event);
          else if (m.t === 'error') setTableError(errorText(m.code));
        },
        onStatus: table.setStatus,
        onClosed(code) {
          if (code === CLOSE_UNAUTHENTICATED) navigateRef.current('/', { replace: true });
          else if (code === CLOSE_FORBIDDEN) {
            navigateRef.current('/', { replace: true, state: { notice: t.table.noAccessNotice } });
          }
        },
      });
      setConn(opened);
    }, 0);
    return () => {
      clearTimeout(start);
      opened?.close();
      useTable.setState({ state: null, status: 'connecting' });
    };
  }, [campaignId]);

  const reconnecting = status === 'offline' || (status === 'connecting' && state !== null);
  const map = state && viewedMap(state, localMapId);
  const selected = state?.tokens.find((token) => token.id === selectedId && token.mapId === map?.id) ?? null;
  const isGm = state?.me.role === 'gm';

  return (
    <div className="table-page">
      <header className="table-bar">
        <Link to="/">{t.campaign.back}</Link>
        <h1>{state?.campaign.name ?? t.campaign.title}</h1>
        {reconnecting && (
          <span className="reconnecting" role="status">
            {t.table.reconnecting}
          </span>
        )}
      </header>
      {!state || !conn ? (
        <p className="dim table-loading">{t.app.loading}</p>
      ) : (
        <div className={isGm ? 'table-columns with-panel' : 'table-columns'}>
          {isGm && (
            <GmPanel
              state={state}
              conn={conn}
              map={map ?? null}
              onViewMap={setLocalMapId}
              selectedToken={selected}
              onSelectToken={setSelectedId}
              onGridPreview={setGridPreview}
            />
          )}
          <main className="table-map">
            {map ? (
              <MapCanvas
                mapId={map.id}
                conn={conn}
                onError={(code) => setTableError(errorText(code))}
                selectedTokenId={selected?.id ?? null}
                onSelectToken={isGm ? setSelectedId : undefined}
                gridPreview={gridPreview}
              />
            ) : (
              <p className="dim table-empty">{isGm ? t.table.noMapGm : t.table.noMapPlayer}</p>
            )}
            {tableError && (
              <div className="table-error" role="alert">
                <span>{tableError}</span>
                <button type="button" onClick={() => setTableError(null)}>
                  {t.table.dismiss}
                </button>
              </div>
            )}
          </main>
          <ChatPanel state={state} conn={conn} />
        </div>
      )}
    </div>
  );
}
