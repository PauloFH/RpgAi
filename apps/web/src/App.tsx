import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { CampaignPlaceholder } from './pages/CampaignPlaceholder';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/convite/:token" element={<InvitePage />} />
      <Route path="/c/:id" element={<CampaignRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function CampaignRoute() {
  const { id = '' } = useParams();
  return <CampaignPlaceholder id={id} />;
}
