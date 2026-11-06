import { useEffect, useState, type FormEvent } from 'react';
import type { ClientState, Layer, MapInfo, Member, Token } from '@rpgai/shared';
import { t } from '../../i18n/pt-BR';
import { centerCell } from '../mapView';
import type { TableConnection } from '../socket';
import { useAction } from '../useAction';
import { ConfirmButton } from './ConfirmButton';

interface TokenDraft {
  name: string;
  color: string;
  size: string;
  layer: Layer;
  ownerIds: string[];
}

const EMPTY_DRAFT: TokenDraft = { name: '', color: '#5b8fd9', size: '1', layer: 'tokens', ownerIds: [] };

const draftOf = (token: Token): TokenDraft => ({
  name: token.name,
  color: token.color,
  size: String(token.size),
  layer: token.layer,
  ownerIds: token.ownerIds,
});

interface TokenFieldsProps {
  draft: TokenDraft;
  members: Member[];
  onChange(draft: TokenDraft): void;
}

function TokenFields({ draft, members, onChange }: TokenFieldsProps) {
  const toggleOwner = (userId: string, on: boolean) =>
    onChange({
      ...draft,
      ownerIds: on ? [...draft.ownerIds, userId] : draft.ownerIds.filter((id) => id !== userId),
    });
  return (
    <>
      <label>
        {t.gm.tokens.name}
        <input
          value={draft.name}
          maxLength={60}
          required
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>
      <div className="token-fields">
        <label>
          {t.gm.tokens.color}
          <input type="color" value={draft.color} onChange={(e) => onChange({ ...draft, color: e.target.value })} />
        </label>
        <label>
          {t.gm.tokens.size}
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            required
            value={draft.size}
            onChange={(e) => onChange({ ...draft, size: e.target.value })}
          />
        </label>
        <label>
          {t.gm.tokens.layer}
          <select value={draft.layer} onChange={(e) => onChange({ ...draft, layer: e.target.value as Layer })}>
            <option value="tokens">{t.gm.tokens.layerTokens}</option>
            <option value="gm">{t.gm.tokens.layerGm}</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>{t.gm.tokens.owners}</legend>
        {members.map((m) => (
          <label key={m.userId} className="check">
            <input
              type="checkbox"
              checked={draft.ownerIds.includes(m.userId)}
              onChange={(e) => toggleOwner(m.userId, e.target.checked)}
            />
            {m.displayName}
          </label>
        ))}
      </fieldset>
    </>
  );
}

function CreateToken({ state, conn, map }: { state: ClientState; conn: TableConnection; map: MapInfo }) {
  const { error, run } = useAction();
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const size = Number(draft.size);
    const created = await run(() =>
      conn.send({
        type: 'token.create',
        mapId: map.id,
        name: draft.name.trim(),
        ...centerCell(map, size),
        size,
        color: draft.color,
        layer: draft.layer,
        ownerIds: draft.ownerIds,
      }),
    );
    if (created) setDraft(EMPTY_DRAFT);
  };

  return (
    <form className="stack" onSubmit={submit} aria-label={t.gm.tokens.createTitle}>
      <h4>{t.gm.tokens.createTitle}</h4>
      <TokenFields draft={draft} members={state.members} onChange={setDraft} />
      <button type="submit">{t.gm.tokens.create}</button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

interface EditTokenProps {
  state: ClientState;
  conn: TableConnection;
  token: Token;
  onDeleted(): void;
}

function EditToken({ state, conn, token, onDeleted }: EditTokenProps) {
  const { error, run } = useAction();
  const [draft, setDraft] = useState(() => draftOf(token));

  // Follows edits made elsewhere (an undo, another GM), but not a move: moving must not wipe a draft.
  useEffect(() => setDraft(draftOf(token)), [token.name, token.color, token.size, token.layer, token.ownerIds.join()]);

  const size = Number(draft.size);
  const name = draft.name.trim();
  // A removed member stays in ownerIds; the server would refuse a list that names them.
  const currentMembers = (ids: string[]) => ids.filter((id) => state.members.some((m) => m.userId === id));
  const ownerIds = currentMembers(draft.ownerIds);
  const changes = {
    ...(name !== token.name && { name }),
    ...(draft.color !== token.color && { color: draft.color }),
    ...(size !== token.size && { size }),
    ...(draft.layer !== token.layer && { layer: draft.layer }),
    ...(ownerIds.join() !== currentMembers(token.ownerIds).join() && { ownerIds }),
  };
  const dirty = Object.keys(changes).length > 0;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (dirty) void run(() => conn.send({ type: 'token.update', tokenId: token.id, ...changes }));
  };

  const remove = async () => {
    if (await run(() => conn.send({ type: 'token.delete', tokenId: token.id }))) onDeleted();
  };

  return (
    <form className="stack" onSubmit={save} aria-label={t.gm.tokens.editTitle}>
      <h4>{t.gm.tokens.editTitle}</h4>
      <TokenFields draft={draft} members={state.members} onChange={setDraft} />
      <div className="row">
        <button type="submit" disabled={!dirty}>
          {t.gm.tokens.save}
        </button>
        <ConfirmButton label={t.gm.tokens.remove} prompt={t.gm.tokens.removeConfirm} onConfirm={() => void remove()} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

interface TokensSectionProps {
  state: ClientState;
  conn: TableConnection;
  map: MapInfo | null;
  selected: Token | null;
  onSelect(id: string | null): void;
}

export function TokensSection({ state, conn, map, selected, onSelect }: TokensSectionProps) {
  return (
    <section className="gm-section stack">
      <h3>{t.gm.tokens.title}</h3>
      {!map && <p className="dim">{t.gm.tokens.needMap}</p>}
      {map && !selected && <p className="dim">{t.gm.tokens.noneSelected}</p>}
      {selected && (
        <EditToken key={selected.id} state={state} conn={conn} token={selected} onDeleted={() => onSelect(null)} />
      )}
      {map && <CreateToken state={state} conn={conn} map={map} />}
    </section>
  );
}
