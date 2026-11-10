// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientState, MapInfo, Member, Token } from '@rpgai/shared';
import { api } from '../api';
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

describe('donos de token', () => {
  const map: MapInfo = { id: 'm', name: 'M', imageUrl: null, width: 700, height: 700, gridSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
  const token = (over: Partial<Token> = {}): Token => ({ id: 'tk', mapId: 'm', name: 'Lia', x: 0, y: 0, size: 1, color: '#5b8fd9', imageUrl: null, layer: 'tokens', ownerIds: [], ...over });
  const panel = (s: ClientState, send: TableConnection['send'], selectedToken: Token | null = null) => (
    <GmPanel
      state={s}
      conn={{ send, close: vi.fn() }}
      map={map}
      onViewMap={vi.fn()}
      selectedToken={selectedToken}
      onSelectToken={vi.fn()}
      onGridPreview={vi.fn()}
    />
  );
  const inForm = (label: string) => within(screen.getByRole('form', { name: label }));

  it('criar token não envia dono marcado que foi removido da campanha, e o formulário destrava', async () => {
    const send = vi.fn(async () => {});
    const { rerender } = render(panel(state(), send));
    const form = inForm(t.gm.tokens.createTitle);
    fireEvent.change(form.getByLabelText(t.gm.tokens.name), { target: { value: 'Goblin' } });
    fireEvent.click(form.getByLabelText('Lia'));
    rerender(panel(state({ members: [member('u1', 'Mestre', 'gm')] }), send));
    fireEvent.click(form.getByText(t.gm.tokens.create));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'token.create', name: 'Goblin', ownerIds: [] }));
    await waitFor(() => expect(form.getByLabelText<HTMLInputElement>(t.gm.tokens.name).value).toBe(''));
  });

  it('editar token não envia dono que saiu da campanha ao salvar outra mudança', () => {
    const send = vi.fn(async () => {});
    render(panel(state(), send, token({ ownerIds: ['u2', 'ex-membro'] })));
    const form = inForm(t.gm.tokens.editTitle);
    expect(form.getByText<HTMLButtonElement>(t.gm.tokens.save).disabled).toBe(true);
    fireEvent.change(form.getByLabelText(t.gm.tokens.name), { target: { value: 'Novo nome' } });
    fireEvent.click(form.getByText(t.gm.tokens.save));
    expect(send).toHaveBeenCalledWith({ type: 'token.update', tokenId: 'tk', name: 'Novo nome' });
  });

  it('editar token troca os donos sem repetir o ex-membro', () => {
    const send = vi.fn(async () => {});
    render(panel(state(), send, token({ ownerIds: ['u2', 'ex-membro'] })));
    const form = inForm(t.gm.tokens.editTitle);
    fireEvent.click(form.getByLabelText('Mestre'));
    fireEvent.click(form.getByText(t.gm.tokens.save));
    expect(send).toHaveBeenCalledWith({ type: 'token.update', tokenId: 'tk', ownerIds: ['u2', 'u1'] });
  });

  it('desmarcar e remarcar um dono não conta como mudança: compara conjuntos, não ordem', () => {
    const send = vi.fn(async () => {});
    render(panel(state(), send, token({ ownerIds: ['u1', 'u2'] })));
    const form = inForm(t.gm.tokens.editTitle);
    fireEvent.click(form.getByLabelText('Mestre'));
    expect(form.getByText<HTMLButtonElement>(t.gm.tokens.save).disabled).toBe(false);
    fireEvent.click(form.getByLabelText('Mestre'));
    expect(form.getByText<HTMLButtonElement>(t.gm.tokens.save).disabled).toBe(true);
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

  it('remover um membro avisa que os links foram revogados e apaga o link da tela', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ token: 'tk', url: 'http://x/convite/tk' });
    const send = vi.fn(async () => {});
    renderPanel(state(), send);
    fireEvent.click(screen.getByText(t.gm.table.invite));
    await screen.findByDisplayValue('http://x/convite/tk');
    expect(screen.queryByText(t.gm.table.linksRevoked)).toBeNull();

    fireEvent.click(screen.getAllByText(t.gm.table.remove)[1]!);
    fireEvent.click(screen.getByText(t.gm.yes));
    await screen.findByText(t.gm.table.linksRevoked);
    expect(screen.queryByDisplayValue('http://x/convite/tk')).toBeNull();

    fireEvent.click(screen.getByText(t.gm.table.invite));
    await screen.findByDisplayValue('http://x/convite/tk');
    expect(screen.queryByText(t.gm.table.linksRevoked)).toBeNull();
    post.mockRestore();
  });

  it('o botão do convite diz que gera um novo link e que o antigo para de funcionar', () => {
    renderPanel(state());
    expect(t.gm.table.invite).toBe('Gerar novo link');
    expect(screen.getByText(t.gm.table.invite)).toBeTruthy();
    expect(screen.getByText(t.gm.table.inviteHint)).toBeTruthy();
  });

  it('remoção recusada não fala em links revogados', async () => {
    renderPanel(state(), vi.fn(async () => { throw new ActionError('forbidden'); }));
    fireEvent.click(screen.getAllByText(t.gm.table.remove)[1]!);
    fireEvent.click(screen.getByText(t.gm.yes));
    await screen.findByRole('alert');
    expect(screen.queryByText(t.gm.table.linksRevoked)).toBeNull();
  });

  it('cancelar a confirmação não remove', () => {
    const send = renderPanel(state());
    fireEvent.click(screen.getAllByText(t.gm.table.remove)[1]!);
    fireEvent.click(screen.getByText(t.gm.no));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getAllByText(t.gm.table.remove)).toHaveLength(2);
  });
});
