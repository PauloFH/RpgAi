import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { errorText, t } from '../i18n/pt-BR';
import { useTitle } from '../useTitle';
import type { CampaignSummary } from './HomePage';

export function CampaignPlaceholder({ id }: { id: string }) {
  const [campaign, setCampaign] = useState<CampaignSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useTitle(`${campaign?.name ?? t.campaign.title} - ${t.app.name}`);

  useEffect(() => {
    api
      .get<CampaignSummary[]>('/api/campaigns')
      .then((list) => setCampaign(list.find((c) => c.id === id) ?? null))
      .catch((e: unknown) => setError(errorText(e instanceof ApiError ? e.code : 'unknown')));
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <p className="error" role="alert">
          {error}
        </p>
        <Link to="/">{t.campaign.back}</Link>
      </main>
    );
  }
  if (campaign === undefined) {
    return (
      <main className="page">
        <p className="dim">{t.app.loading}</p>
      </main>
    );
  }
  if (campaign === null) return <Navigate to="/" replace />;
  return (
    <main className="page">
      <h1>{campaign.name}</h1>
      <Link to="/">{t.campaign.back}</Link>
    </main>
  );
}
