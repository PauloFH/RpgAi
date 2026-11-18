import { useState } from 'react';
import type { ClientState, Member, Role } from '@rpgai/shared';
import { api } from '../../api';
import { t } from '../../i18n/pt-BR';
import type { TableConnection } from '../socket';
import { useAction } from '../useAction';
import { ConfirmButton } from './ConfirmButton';

function InviteLink({ campaignId, revoked }: { campaignId: string; revoked: boolean }) {
  const { error, run } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const generate = () =>
    run(async () => {
      const invite = await api.post<{ token: string; url: string }>(`/api/campaigns/${campaignId}/invites`);
      setUrl(invite.url);
      setCopy('idle');
    });

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <div className="stack">
      <button type="button" onClick={() => void generate()}>
        {t.gm.table.invite}
      </button>
      <p className="dim">{t.gm.table.inviteHint}</p>
      {revoked && !url && <p role="status">{t.gm.table.linksRevoked}</p>}
      {url && (
        <div className="row">
          <input aria-label={t.gm.table.inviteLink} readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => void copyLink()}>
            {copy === 'copied' ? t.gm.table.copied : t.gm.table.copy}
          </button>
        </div>
      )}
      {copy === 'failed' && (
        <p className="error" role="alert">
          {t.gm.table.copyFailed}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface MemberRowProps {
  member: Member;
  lastGm: boolean;
  conn: TableConnection;
  onRemoved(): void;
}

function MemberRow({ member, lastGm, conn, onRemoved }: MemberRowProps) {
  const { error, run } = useAction();
  const remove = async () => {
    if (await run(() => conn.send({ type: 'member.remove', userId: member.userId }))) onRemoved();
  };
  return (
    <li>
      <span className="member-name">{member.displayName}</span>
      <select
        aria-label={`${t.gm.table.role} ${member.displayName}`}
        value={member.role}
        disabled={lastGm}
        onChange={(e) => {
          const role = e.target.value as Role;
          void run(() => conn.send({ type: 'member.setRole', userId: member.userId, role }));
        }}
      >
        <option value="gm">{t.gm.table.roleGm}</option>
        <option value="player">{t.gm.table.rolePlayer}</option>
      </select>
      <ConfirmButton
        label={t.gm.table.remove}
        prompt={t.gm.table.removeConfirm}
        disabled={lastGm}
        onConfirm={() => void remove()}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function TableSection({ state, conn }: { state: ClientState; conn: TableConnection }) {
  const { error, run } = useAction();
  // Each removal remounts InviteLink: the link it was showing no longer works.
  const [removals, setRemovals] = useState(0);
  const gmCount = state.members.filter((m) => m.role === 'gm').length;
  return (
    <section className="gm-section stack">
      <h3>{t.gm.table.title}</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.campaign.playersCanMove}
          onChange={(e) => {
            const playersCanMove = e.target.checked;
            void run(() => conn.send({ type: 'campaign.update', playersCanMove }));
          }}
        />
        {t.gm.table.playersCanMove}
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <InviteLink key={removals} campaignId={state.campaign.id} revoked={removals > 0} />
      <h4>{t.gm.table.members}</h4>
      <ul className="members">
        {state.members.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            lastGm={m.role === 'gm' && gmCount === 1}
            conn={conn}
            onRemoved={() => setRemovals((n) => n + 1)}
          />
        ))}
      </ul>
    </section>
  );
}
