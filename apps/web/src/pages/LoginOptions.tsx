import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { errorText, t } from '../i18n/pt-BR';

export function LoginOptions() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const devLogin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/dev-login', { name });
      window.location.reload();
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  };

  return (
    <div className="login">
      <a className="button primary" href="/auth/discord">
        {t.home.loginDiscord}
      </a>
      {import.meta.env.DEV && (
        <form onSubmit={devLogin} className="stack">
          <h3>{t.home.devLoginTitle}</h3>
          <input
            aria-label={t.home.devLoginName}
            placeholder={t.home.devLoginName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit">{t.home.devLoginSubmit}</button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
