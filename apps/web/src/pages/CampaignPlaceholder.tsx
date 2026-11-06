import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { t } from '../i18n/pt-BR';
import { useTitle } from '../useTitle';
import type { CampaignSummary } from './HomePage';

export function CampaignPlaceholder({ id }: { id: string }) {
  const [campaign, setCampaign] = useState<CampaignSummary | null | undefined>(undefined);
  useTitle(`${campaign?.name ?? t.campaign.title} - ${t.app.name}`);

  useEffect(() => {
    api
      .get<CampaignSummary[]>('/api/campaigns')
      .then((list) => setCampaign(list.find((c) => c.id === id) ?? null))
      .catch(() => setCampaign(null));
  }, [id]);

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
