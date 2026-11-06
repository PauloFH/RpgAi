export const t = {
  app: { name: 'RpgAi', loading: 'Carregando...' },
  home: {
    title: 'RpgAi',
    tagline: 'Sua mesa de RPG online, do mapa aos dados.',
    loginDiscord: 'Entrar com Discord',
    devLoginTitle: 'Login de desenvolvimento',
    devLoginName: 'Seu nome',
    devLoginSubmit: 'Entrar',
    logout: 'Sair',
    campaigns: 'Suas campanhas',
    noCampaigns: 'Você ainda não participa de nenhuma campanha.',
    roleGm: 'Mestre',
    rolePlayer: 'Jogador',
    rules: 'Regras',
    newCampaign: 'Nova campanha',
    campaignName: 'Nome da campanha',
    rulesVersion: 'Versão das regras',
    allowMixed: 'Permitir misturar versões',
    create: 'Criar campanha',
  },
  invite: {
    title: 'Convite',
    invitedTo: 'Você foi convidado para',
    accept: 'Entrar na campanha',
    loginFirst: 'Entre para aceitar o convite.',
  },
  campaign: {
    title: 'Mesa',
    back: 'Voltar às campanhas',
  },
} as const;

const errors: Record<string, string> = {
  forbidden: 'Você não tem permissão para fazer isso.',
  invalid: 'Os dados enviados são inválidos.',
  bad_request: 'Os dados enviados são inválidos.',
  not_found: 'Não encontrado.',
  nothing_to_undo: 'Não há nada para desfazer.',
  dice: 'Expressão de dados inválida.',
  invalid_image: 'Imagem inválida. Use PNG, JPEG ou WebP.',
  too_large: 'O arquivo é grande demais (máximo de 20 MB).',
  unauthenticated: 'Entre para continuar.',
};

export function errorText(code: string): string {
  return errors[code] ?? 'Algo deu errado. Tente novamente.';
}
