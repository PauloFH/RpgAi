import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClientState, MapInfo } from '@rpgai/shared';
import { api } from '../../api';
import { t } from '../../i18n/pt-BR';
import type { GridPreview } from '../MapCanvas';
import type { TableConnection } from '../socket';
import { useAction } from '../useAction';
import { ConfirmButton } from './ConfirmButton';
import { GridForm } from './GridForm';

const MAX_MAP_NAME = 80;

const nameFromFile = (file: File): string =>
  (file.name.replace(/\.[^.]+$/, '') || file.name).slice(0, MAX_MAP_NAME);

function MapUpload({ campaignId, conn }: { campaignId: string; conn: TableConnection }) {
  const { error, run } = useAction();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    const done = await run(async () => {
      const { key } = await api.upload(campaignId, file);
      await conn.send({ type: 'map.create', name: name.trim() || nameFromFile(file), imageKey: key });
    });
    setBusy(false);
    if (done) {
      setName('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <form className="stack" onSubmit={submit} aria-label={t.gm.maps.upload}>
      <label>
        {t.gm.maps.name}
        <input value={name} maxLength={MAX_MAP_NAME} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t.gm.maps.image}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" required />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? t.gm.maps.uploading : t.gm.maps.upload}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function MapDetails({ state, map, conn }: { state: ClientState; map: MapInfo; conn: TableConnection }) {
  const { error, run } = useAction();
  const [name, setName] = useState(map.name);
  useEffect(() => setName(map.name), [map.name]);
  const trimmed = name.trim();

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed !== '' && trimmed !== map.name) {
      void run(() => conn.send({ type: 'map.update', mapId: map.id, name: trimmed }));
    }
  };

  return (
    <div className="stack">
      <form className="row" onSubmit={rename}>
        <input
          aria-label={t.gm.maps.rename}
          value={name}
          maxLength={MAX_MAP_NAME}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={trimmed === '' || trimmed === map.name}>
          {t.gm.maps.rename}
        </button>
      </form>
      <div className="row">
        {state.campaign.defaultMapId === map.id ? (
          <span className="dim">{t.gm.maps.isDefault}</span>
        ) : (
          <button type="button" onClick={() => void run(() => conn.send({ type: 'map.setDefault', mapId: map.id }))}>
            {t.gm.maps.setDefault}
          </button>
        )}
        <ConfirmButton
          label={t.gm.maps.remove}
          prompt={t.gm.maps.removeConfirm}
          onConfirm={() => void run(() => conn.send({ type: 'map.delete', mapId: map.id }))}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PlayerMaps({ state, conn }: { state: ClientState; conn: TableConnection }) {
  const { error, run } = useAction();
  const players = state.members.filter((m) => m.role === 'player');
  return (
    <div className="stack">
      <h4>{t.gm.maps.playerMaps}</h4>
      {players.length === 0 && <p className="dim">{t.gm.maps.noPlayers}</p>}
      {players.map((player) => (
        <label key={player.userId}>
          {player.displayName}
          <select
            value={player.currentMapId ?? ''}
            onChange={(e) => {
              const mapId = e.target.value || null;
              void run(() => conn.send({ type: 'member.setMap', userId: player.userId, mapId }));
            }}
          >
            <option value="">{t.gm.maps.defaultOption}</option>
            {state.maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface MapsSectionProps {
  state: ClientState;
  conn: TableConnection;
  map: MapInfo | null;
  onViewMap(id: string): void;
  onGridPreview(preview: GridPreview | null): void;
}

export function MapsSection({ state, conn, map, onViewMap, onGridPreview }: MapsSectionProps) {
  return (
    <section className="gm-section stack">
      <h3>{t.gm.maps.title}</h3>
      <MapUpload campaignId={state.campaign.id} conn={conn} />
      {map && (
        <>
          <label>
            {t.gm.maps.viewing}
            <select value={map.id} onChange={(e) => onViewMap(e.target.value)}>
              {state.maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <MapDetails key={`details-${map.id}`} state={state} map={map} conn={conn} />
          <GridForm key={`grid-${map.id}`} map={map} conn={conn} onPreview={onGridPreview} />
          <PlayerMaps state={state} conn={conn} />
        </>
      )}
    </section>
  );
}
