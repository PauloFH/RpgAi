import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { errorText, t } from '../i18n/pt-BR';
import { useTitle } from '../useTitle';
import { PENDING_INVITE_KEY } from './InvitePage';
import { LoginOptions } from './LoginOptions';

export interface CampaignSummary {
  id: string;
  name: string;
  role: 'gm' | 'player';
  rulesVersion: '2014' | '2024';
}

interface Me {
  id: string;
  displayName: string;
}

type Session =
  | { state: 'loading' }
  | { state: 'out' }
  | { state: 'error'; message: string }
  | { state: 'in'; me: Me };

export function HomePage() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => (location.state as { notice?: string } | null)?.notice ?? null);
  useTitle(t.home.title);

  // A notice is for this arrival only: reloading the page must not show it again.
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    api
      .get<Me>('/api/me')
      .then((me) => setSession({ state: 'in', me }))
      .catch((e: unknown) =>
        e instanceof ApiError && e.status === 401
          ? setSession({ state: 'out' })
          : setSession({ state: 'error', message: errorText(e instanceof ApiError ? e.code : 'unknown') }),
      );
  }, []);

  if (session.state === 'loading') {
    return (
      <main className="page">
        <p className="dim">{t.app.loading}</p>
      </main>
    );
  }

  if (session.state === 'error') {
    return (
      <main className="page">
        <p className="error" role="alert">
          {session.message}
        </p>
      </main>
    );
  }

  if (session.state === 'out') {
    return (
      <main className="page narrow">
        <h1>{t.home.title}</h1>
        <p className="dim">{t.home.tagline}</p>
        {notice && <p role="status">{notice}</p>}
        <section className="panel">
          <LoginOptions />
        </section>
      </main>
    );
  }

  return <Dashboard me={session.me} notice={notice} onLogout={() => setSession({ state: 'out' })} />;
}

function readPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

function Dashboard({ me, notice, onLogout }: { me: Me; notice: string | null; onLogout: () => void }) {
  const navigate = useNavigate();
  const [pending] = useState(readPendingInvite);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rulesVersion, setRulesVersion] = useState<'2014' | '2024'>('2024');
  const [mixed, setMixed] = useState(false);

  useEffect(() => {
    if (pending) {
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        // ignora
      }
      return;
    }
    api
      .get<CampaignSummary[]>('/api/campaigns')
      .then(setCampaigns)
      .catch((e: unknown) => setError(errorText(e instanceof ApiError ? e.code : 'unknown')));
  }, [pending]);

  if (pending) return <Navigate to={`/convite/${pending}`} replace />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { id } = await api.post<{ id: string }>('/api/campaigns', {
        name,
        rulesVersion,
        allowMixedVersions: mixed,
      });
      navigate(`/c/${id}`);
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
      onLogout();
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  };

  return (
    <main className="page">
      <header className="bar">
        <h1>{t.home.title}</h1>
        <span className="dim">{me.displayName}</span>
        <button onClick={logout}>{t.home.logout}</button>
      </header>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>{t.home.campaigns}</h2>
        {campaigns.length === 0 ? (
          <p className="dim">{t.home.noCampaigns}</p>
        ) : (
          <ul className="list">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link to={`/c/${c.id}`}>{c.name}</Link>
                <span className={`badge ${c.role}`}>{c.role === 'gm' ? t.home.roleGm : t.home.rolePlayer}</span>
                <span className="dim">
                  {t.home.rules} {c.rulesVersion}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h2>{t.home.newCampaign}</h2>
        <form onSubmit={create} className="stack">
          <input
            aria-label={t.home.campaignName}
            placeholder={t.home.campaignName}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <label>
            {t.home.rulesVersion}{' '}
            <select value={rulesVersion} onChange={(e) => setRulesVersion(e.target.value as '2014' | '2024')}>
              <option value="2014">2014</option>
              <option value="2024">2024</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={mixed} onChange={(e) => setMixed(e.target.checked)} />{' '}
            {t.home.allowMixed}
          </label>
          <button type="submit" className="primary">
            {t.home.create}
          </button>
        </form>
      </section>
    </main>
  );
}
