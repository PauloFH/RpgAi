// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorText, t } from '../i18n/pt-BR';
import { HomePage } from './HomePage';

afterEach(cleanup);

function Search() {
  return <span data-testid="search">{useLocation().search}</span>;
}

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HomePage />
      <Search />
    </MemoryRouter>,
  );

describe('volta do login pelo Discord', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 })) as typeof fetch;
  });

  it.each(['access_denied', 'bad_state', 'discord_error', 'discord_not_configured'])('%s mostra o aviso e limpa a URL', async (code) => {
    renderAt(`/?login_error=${code}`);
    await screen.findByText(errorText(code));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
    expect(screen.getByText(errorText(code))).toBeTruthy();
    expect(screen.getByText(t.home.loginDiscord)).toBeTruthy();
  });

  it('código desconhecido não ecoa o que veio na URL', async () => {
    renderAt('/?login_error=%3Cb%3Einventado%3C%2Fb%3E');
    await screen.findByText(errorText('inventado'));
    expect(screen.queryByText(/inventado/)).toBeNull();
  });

  it('sem login_error não há aviso', async () => {
    renderAt('/');
    await screen.findByText(t.home.loginDiscord);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
