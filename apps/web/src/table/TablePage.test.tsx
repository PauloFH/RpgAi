// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n/pt-BR';
import { TablePage } from './TablePage';
import { connectTable, type TableHandlers } from './socket';

vi.mock('./MapCanvas', () => ({ MapCanvas: () => null }));
vi.mock('./socket', async (original) => ({
  ...(await original<typeof import('./socket')>()),
  connectTable: vi.fn(() => ({ send: vi.fn(), close: vi.fn() })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Home() {
  const state = useLocation().state as { notice?: string } | null;
  return <p>{state?.notice ?? 'sem aviso'}</p>;
}

const openTable = async (): Promise<TableHandlers> => {
  render(
    <MemoryRouter initialEntries={['/c/x']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/c/x" element={<TablePage campaignId="x" />} />
        <Route path="/" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(connectTable).toHaveBeenCalled());
  return vi.mocked(connectTable).mock.calls[0]![1];
};

describe('conexão recusada', () => {
  it('4403 volta ao início com um aviso neutro, que serve também para quem nunca entrou', async () => {
    const handlers = await openTable();
    handlers.onClosed!(4403);
    await screen.findByText('Você não tem acesso a esta campanha.');
    expect(t.table.noAccessNotice).toBe('Você não tem acesso a esta campanha.');
  });
  it('4401 volta ao início sem aviso', async () => {
    const handlers = await openTable();
    handlers.onClosed!(4401);
    await screen.findByText('sem aviso');
  });
});
