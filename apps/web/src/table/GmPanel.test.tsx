// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientState, Member } from '@rpgai/shared';
import { t } from '../i18n/pt-BR';
import { GmPanel } from './GmPanel';
import { ActionError, type TableConnection } from './socket';

afterEach(cleanup);

const member = (userId: string, displayName: string, role: Member['role']): Member => ({ userId, displayName, avatarUrl: null, role, currentMapId: null });
const state = (over: Partial<ClientState> = {}): ClientState => ({
  campaign: { id: 'c', name: 'C', rulesVersion: '2024', allowMixedVersions: false, defaultMapId: null, playersCanMove: true },
  me: { userId: 'u1', role: 'gm' },
  members: [member('u1', 'Mestre', 'gm'), member('u2', 'Lia', 'player')],
  maps: [],
  tokens: [],
  chat: [],
  canUndo: true,
  ...over,
});

function renderPanel(s: ClientState, send: TableConnection['send'] = vi.fn(async () => {})) {
  render(
    <GmPanel
      state={s}
      conn={{ send, close: vi.fn() }}
      map={null}
      onViewMap={vi.fn()}
      selectedToken={null}
      onSelectToken={vi.fn()}
      onGridPreview={vi.fn()}
    />,
  );
  return send;
}

const pressCtrlZ = () => {
  const event = createEvent.keyDown(window, { key: 'z', ctrlKey: true });
  fireEvent(window, event);
  return event;
};

describe('Ctrl+Z', () => {
  it('desfaz e impede a ação padrão com o foco fora dos campos', () => {
    const send = renderPanel(state());
    const event = pressCtrlZ();
    expect(send).toHaveBeenCalledWith({ type: 'undo' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('não faz nada com o foco num campo', () => {
    const send = renderPanel(state());
    screen.getByLabelText<HTMLInputElement>(t.gm.maps.name).focus();
    const event = pressCtrlZ();
    expect(send).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('não envia nada quando não há o que desfazer', () => {
    const send = renderPanel(state({ canUndo: false }));
    pressCtrlZ();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('painel do mestre', () => {
  it('habilita Desfazer só com canUndo', () => {
    renderPanel(state({ canUndo: false }));
    expect(screen.getByText<HTMLButtonElement>(t.gm.undo).disabled).toBe(true);
  });

  it('mostra o erro do servidor', async () => {
    renderPanel(state(), vi.fn(async () => { throw new ActionError('nothing_to_undo'); }));
    fireEvent.click(screen.getByText(t.gm.undo));
    await screen.findByText('Não há nada para desfazer.');
  });

  it('remove um membro só depois de confirmar na página', () => {
    const send = renderPanel(state());
    const removes = screen.getAllByText<HTMLButtonElement>(t.gm.table.remove);
    // o único mestre não pode sair: o botão dele fica desligado
    expect(removes[0]!.disabled).toBe(true);
    fireEvent.click(removes[1]!);
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(t.gm.yes));
    expect(send).toHaveBeenCalledWith({ type: 'member.remove', userId: 'u2' });
  });

  it('cancelar a confirmação não remove', () => {
    const send = renderPanel(state());
    fireEvent.click(screen.getAllByText(t.gm.table.remove)[1]!);
    fireEvent.click(screen.getByText(t.gm.no));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getAllByText(t.gm.table.remove)).toHaveLength(2);
  });
});
