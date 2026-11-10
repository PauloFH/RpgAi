import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { errorText, t } from '../i18n/pt-BR';
import { useTitle } from '../useTitle';
import { LoginOptions } from './LoginOptions';

export const PENDING_INVITE_KEY = 'rpgai.pendingInvite';

interface InviteInfo {
  campaignId: string;
  campaignName: string;
  alreadyMember: boolean;
}

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle(`${t.invite.title} - ${t.app.name}`);

  useEffect(() => {
    api
      .get<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`)
      .then((found) => {
        try {
          sessionStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          // ignora
        }
        setInfo(found);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          try {
            sessionStorage.setItem(PENDING_INVITE_KEY, token);
          } catch {
            // sem sessionStorage o convite se perde após o login
          }
          setNeedsLogin(true);
        } else {
          setError(errorText(e instanceof ApiError ? e.code : 'unknown'));
        }
      });
  }, [token]);

  const accept = async () => {
    try {
      const { campaignId } = await api.post<{ campaignId: string }>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
      );
      navigate(`/c/${campaignId}`);
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  };

  if (info?.alreadyMember) return <Navigate to={`/c/${info.campaignId}`} replace />;

  return (
    <main className="page narrow">
      <h1>{t.app.name}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {needsLogin && (
        <section className="panel">
          <p>{t.invite.loginFirst}</p>
          <LoginOptions />
        </section>
      )}
      {info && (
        <section className="panel stack">
          <p>
            {t.invite.invitedTo} <strong>{info.campaignName}</strong>
          </p>
          <button className="primary" onClick={accept}>
            {t.invite.accept}
          </button>
        </section>
      )}
      {!info && !needsLogin && !error && <p className="dim">{t.app.loading}</p>}
    </main>
  );
}
