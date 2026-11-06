// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ClientState, Member } from '@rpgai/shared';
import { t } from '../i18n/pt-BR';
import { ChatPanel } from './ChatPanel';
import { ActionError, type TableConnection } from './socket';

afterEach(cleanup);

const member = (userId: string, displayName: string): Member => ({ userId, displayName, avatarUrl: null, role: 'player', currentMapId: null });
const message = (over: Partial<ChatMessage>): ChatMessage => ({ id: 'm1', authorId: 'u1', kind: 'text', text: 'oi', label: null, rolls: [], secret: false, recipients: null, undone: false, createdAt: '2026-01-01T12:00:00Z', ...over });
const state = (chat: ChatMessage[]): ClientState => ({
  campaign: { id: 'c', name: 'C', rulesVersion: '2024', allowMixedVersions: false, defaultMapId: null, playersCanMove: true },
  me: { userId: 'u1', role: 'gm' },
  members: [member('u1', 'Mestre'), member('u2', 'Lia')],
  maps: [],
  tokens: [],
  chat,
  canUndo: false,
});
const conn = (send: TableConnection['send'] = vi.fn(async () => {})): TableConnection => ({ send, close: vi.fn() });

describe('ChatPanel', () => {
  it('sussurro para quem não existe ensina a usar aspas', async () => {
    const send = vi.fn(async () => { throw new ActionError('unknown_member'); });
    render(<ChatPanel state={state([])} conn={conn(send)} />);
    fireEvent.change(screen.getByLabelText(t.chat.message), { target: { value: '/w Paulo Roberto oi' } });
    fireEvent.click(screen.getByText(t.chat.send));
    expect((await screen.findByRole('alert')).textContent).toContain('/w "Paulo Roberto" oi');
  });

  it('mostra autor e texto', () => {
    render(<ChatPanel state={state([message({})])} conn={conn()} />);
    expect(screen.getByText('Mestre')).toBeTruthy();
    expect(screen.getByText('oi')).toBeTruthy();
  });

  it('destaca um sussurro e diz quem vê', () => {
    const { container } = render(
      <ChatPanel state={state([message({ kind: 'whisper', recipients: ['u1', 'u2'] })])} conn={conn()} />,
    );
    expect(container.querySelector('.message.restricted')).toBeTruthy();
    expect(screen.getByText(`${t.chat.whisper} · ${t.chat.visibleTo}: Mestre, Lia`)).toBeTruthy();
  });

  it('marca a mensagem desfeita com o selo', () => {
    const { container } = render(<ChatPanel state={state([message({ undone: true })])} conn={conn()} />);
    expect(container.querySelector('.message.undone')).toBeTruthy();
    expect(screen.getByText(t.chat.undone)).toBeTruthy();
  });

  it('envia chat.send e limpa o campo', async () => {
    const send = vi.fn(async () => {});
    render(<ChatPanel state={state([])} conn={conn(send)} />);
    const input = screen.getByLabelText<HTMLInputElement>(t.chat.message);
    fireEvent.change(input, { target: { value: '/r 1d20' } });
    fireEvent.click(screen.getByText(t.chat.send));
    expect(send).toHaveBeenCalledWith({ type: 'chat.send', text: '/r 1d20' });
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('mostra o erro do servidor e mantém o texto', async () => {
    const send = vi.fn(async () => { throw new ActionError('dice'); });
    render(<ChatPanel state={state([])} conn={conn(send)} />);
    const input = screen.getByLabelText<HTMLInputElement>(t.chat.message);
    fireEvent.change(input, { target: { value: '/r xyz' } });
    fireEvent.click(screen.getByText(t.chat.send));
    await screen.findByText('Expressão de dados inválida.');
    expect(input.value).toBe('/r xyz');
  });
});
