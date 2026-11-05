# Mesa com batalha: design do MVP e roadmap

- **Data:** 2026-11-05
- **Status:** rascunho, aguardando aprovação do Paulo
- **Escopo:** projeto 1 de 5 (mesa e batalha, sem IA) e roadmap até os diferenciais

Convenção deste documento: **[Paulo]** marca o que o Paulo decidiu; **[escolha do design]** marca o que foi decidido na conversa de design, sem confirmação explícita dele. Os itens [escolha do design] podem ser revistos, mas o builder deve segui-los até que alguém os mude.

---

## 1. Contexto e motivo

O repositório RpgAi começou em 2024 com notebooks de fine-tuning (Llama 3.1 8B, Unsloth, exportação para Ollama) e um dataset baseado em uma aventura publicada de D&D. Não existe nenhum código de jogo.

A visão completa **[Paulo]** é uma plataforma de RPG de mesa online, vendida por assinatura, em que:

- um mestre humano conduz o grupo dele numa mesa virtual parecida com o Roll20, mas com mais cara de jogo;
- a IA pode ajudar o mestre (NPCs com personalidade e voz, narração, geração de mapas e personagens) ou ser o próprio mestre, inclusive para uma pessoa jogar sozinha;
- cada usuário conecta a própria conta ou modelo de IA, então a plataforma não paga o custo de IA.

Essa visão foi dividida em cinco projetos, nesta ordem **[escolha do design, aceita pelo Paulo]**:

1. **Mesa e batalha, sem IA** (este documento).
2. IA ajudante do mestre e bot do Discord.
3. Produto à venda: contas, assinatura, apoiadores, termos de uso, LGPD.
4. Criação com IA: mapas, personagens e campanhas gerados; importação do Roll20.
5. Modo solo com Mestre IA.

**Por que começar pela mesa:** o primeiro público é o mestre humano com o grupo dele **[Paulo]**, e a IA dos projetos seguintes vai operar essa mesma mesa. Sem a mesa, a IA não tem o que controlar.

**Como o grupo do Paulo joga hoje [Paulo]:** online, com voz no Discord e mesa no Roll20. Usam iluminação dinâmica, macros, jukebox, handouts e "tudo mais". O trabalho manual que mais pesa é na batalha: os tokens são movidos à mão, a vida é editada à mão em cada token, e o mestre controla todos os NPCs sozinho.

**Critério de sucesso do MVP:** o grupo do Paulo joga uma sessão inteira na nossa mesa, sem abrir o Roll20. A sessão é uma aventura curta nova (one-shot) de 5e, preparada na nossa mesa **[Paulo]**, e não a continuação da campanha atual do Roll20.

## 2. Objetivos do MVP

1. Substituir o Roll20 numa sessão real de 5e: campanha, mapa, tokens, fichas, dados, chat, iluminação dinâmica, macros, jukebox e handouts.
2. Batalha em uma interface própria, montada a partir do mapa, em que o sistema aplica as regras (acerto, dano, condições) e devolve o resultado para a mesa.
3. Suportar as regras de 2014 (SRD 5.1) e de 2024 (SRD 5.2) **[Paulo]**.
4. Deixar a base pronta para a IA dos próximos projetos, com o mesmo conjunto de ações que um mestre humano usa (ver 6.1).
5. API para bots e servidor MCP, para que Claude, Codex e bots externos ajudem a montar e gerenciar campanhas antes de existir a IA própria **[Paulo]** (ver 6.13).
6. Fichas de outros sistemas além de 5e, para o grupo e os bots usarem a mesa com eles **[Paulo]** (ver 6.14).

## 3. Fora do MVP (entra depois, ver roadmap)

- Qualquer recurso de IA dentro da plataforma, inclusive sugestões. IA externa conectada pela API ou pelo MCP é permitida (ver 6.13).
- Bot do Discord e voz ou vídeo dentro do jogo. A voz fica no Discord **[Paulo]**.
- Pagamento, assinatura e planos.
- Modo solo e companheiros controlados pela IA.
- Subida de nível guiada (no MVP o nível é editado à mão na ficha).
- Editor de conteúdo próprio (homebrew de classes, magias, itens).
- Importação do Roll20.
- Minigames, reações automáticas no estilo Baldur's Gate 3, percepção automática ao entrar numa área.
- XP e drops calculados pelo sistema (no MVP o mestre distribui à mão).
- Baralhos de cartas e marketplace **[escolha do design]**.
- Scripts escritos pelo usuário rodando dentro do nosso servidor, como os Mods do Roll20 **[escolha do design]**: o mesmo resultado sai da API externa (6.13), sem rodar código de terceiros no servidor. Pode voltar depois se a API não bastar.
- Regras automáticas e arena automática para sistemas que não sejam 5e (as fichas desses sistemas entram, ver 6.14).
- Versão para celular **[escolha do design]**: o MVP é para computador, como o Roll20 é usado na prática. Não deve quebrar em tela menor, mas não precisa ser confortável nela.

## 4. Anti-objetivos (fracasso mesmo que funcione)

- **Regra calculada no lugar errado.** Se o navegador de um jogador, ou no futuro a IA, consegue alterar vida, CA ou resultado de rolagem diretamente, o design falhou. O servidor é a única autoridade das regras.
- **Bot com mais poder que uma pessoa.** Um bot ou cliente MCP age sempre em nome de um usuário, com o papel e as permissões dele na campanha, e tudo o que faz aparece no histórico como feito por ele.
- **Mestre sem controle.** Tudo que o sistema automatiza precisa poder ser corrigido ou desfeito pelo mestre na hora, sem sair da tela.
- **Mais lento que o Roll20 no básico.** Mover token, rolar dado, aplicar dano e passar o turno precisam levar no máximo o mesmo número de cliques que no Roll20.
- **Retrabalho para batalhar.** Se o mapa já tem paredes e portas, a arena sai sem nenhuma configuração extra do mestre.
- **Conteúdo ou marca sem licença.** Nada de dados do 5etools, texto de livros da Wizards, o dataset de 2024 do repo, nem "D&D", "Dungeons & Dragons", "Roll20" ou "Baldur's Gate" no nome, na interface ou na divulgação. O produto será vendido **[Paulo]**.

## 5. Restrições

- **Tecnologia [Paulo]:** TypeScript, rodando no navegador.
- **Conteúdo:** apenas SRD 5.1 e SRD 5.2, ambos CC-BY-4.0, com a atribuição exigida visível no produto, mais conteúdo autoral.
- **Grupo típico [escolha do design]:** 1 mestre e de 3 a 6 jogadores na mesma campanha ao mesmo tempo. O MVP não precisa escalar além de algumas dezenas de campanhas simultâneas, mas a arquitetura não pode impedir isso depois.
- **Público e idioma [escolha do design]:** Brasil. Interface em português do Brasil, com textos centralizados para tradução futura.
- **Custo:** sem IA no MVP, o custo é servidor, banco e armazenamento de imagens e músicas. Uploads têm limite por campanha.

## 6. Como funciona

### 6.1 Princípio central: mesa com ações, servidor com regras [escolha do design]

Tudo o que muda a mesa é uma **ação** enviada ao servidor: mover token, revelar área, rolar dado, atacar, aplicar dano, iniciar batalha, tocar música. O servidor valida a ação (quem pode fazer, se a regra permite), calcula o resultado, guarda e transmite o novo estado para todos.

Consequências:
- Desfazer é desfazer ações; o histórico da sessão é a lista de ações.
- A IA dos projetos seguintes usa as mesmas ações que o mestre, com as mesmas permissões e validações. Nada de caminho especial para ela.
- As regras de 5e ficam num módulo próprio, usado pelo servidor (e pelo navegador só para pré-visualizar, nunca para decidir).
- **Desfazer [escolha do design]:** linear. O mestre desfaz a última ação, depois a anterior, e assim por diante, na mesa e na batalha, inclusive ações feitas pela API ou pelo MCP. Não existe desfazer seletivo de uma ação antiga no meio do histórico. Rolagens desfeitas continuam no chat, marcadas como desfeitas, para ninguém "rolar de novo até sair bom".
- **Informação escondida [escolha do design]:** o servidor só envia a cada jogador o que ele pode ver. Tokens fora da visão, a camada do mestre, rolagens secretas, sussurros de outros e handouts não revelados nunca chegam ao navegador dele nem à API com a chave dele. A névoa não é só desenho por cima.

### 6.2 Campanhas e papéis

- Login com a conta do Discord **[escolha do design]**, já que o grupo inteiro usa Discord.
- Tela de entrada com as campanhas do usuário, como no Roll20 **[Paulo]**.
- O mestre cria a campanha, escolhe a versão padrão de regras (2014 ou 2024) e convida por link.
- Papéis: mestre (pode tudo) e jogador (controla os próprios personagens e o que o mestre liberar). Uma campanha pode ter mais de um mestre **[escolha do design]**.
- O mestre pode ver a mesa como um jogador específico, para conferir o que ele enxerga.

### 6.3 Mapa e camadas

- O mestre sobe uma imagem e ajusta o grid (tamanho do quadrado e alinhamento). Vários mapas por campanha; o mestre escolhe em qual cada jogador está.
- Camadas: mapa, tokens, só o mestre vê, e paredes/iluminação.
- Paredes, portas e janelas são traçadas pelo mestre, como no Roll20 **[Paulo]**. Portas podem estar abertas, fechadas ou trancadas. Objetos podem ser marcados como obstáculo ou cobertura (meia, três quartos, total).
- Ferramentas de mesa: régua de distância em quadrados e metros, desenho livre e marcadores, com controle de quem vê **[escolha do design]**.

### 6.4 Iluminação dinâmica e névoa [Paulo]

- Cada token tem visão (normal, visão no escuro com alcance) e pode carregar luz (alcance de luz plena e penumbra).
- Paredes e portas fechadas bloqueiam visão e luz.
- O jogador vê apenas o que os tokens dele enxergam. As áreas já exploradas ficam visíveis em tom apagado, sem mostrar tokens que estejam lá.
- O mestre também pode revelar ou esconder áreas à mão.

### 6.5 Tokens

- Um token pode estar ligado a uma ficha (personagem ou monstro) ou ser só uma imagem.
- Mostra barra de vida e ícones de condição. O mestre escolhe se os jogadores veem a vida exata, uma barra aproximada ou nada, por token.
- Arrastar um monstro do compêndio para o mapa cria o token já ligado à ficha dele. Vários do mesmo monstro recebem nomes numerados.
- Fora da batalha, o movimento é livre (o mestre pode travar o movimento dos jogadores).

### 6.6 Fichas de 5e

- Ficha de personagem: atributos, perícias, salvaguardas, ataques, magias e espaços de magia, recursos de classe, inventário e dinheiro, condições, anotações.
- Valores derivados (modificadores, bônus de proficiência, CD de magia) são calculados; o jogador pode sobrescrever qualquer um, e a sobrescrita fica marcada.
- Rolagem direto da ficha: clicar em perícia, salvaguarda, ataque ou magia rola e manda para o chat.
- No MVP, a subida de nível é feita editando a ficha. As opções são livres, mas o compêndio ajuda a buscar classes, talentos e magias.
- Cada personagem tem uma versão de regras (2014 ou 2024). O mestre pode permitir misturar versões na mesma campanha **[escolha do design]**.
- **Quando as versões se misturam [escolha do design]:** cada criatura usa a própria versão para as próprias características (classe, magias, ataques, ações). Regras gerais da mesa, como as definições de condições, exaustão e ações padrão, seguem a versão padrão da campanha.
- **Regras fora da batalha [escolha do design]:** valem também na mesa. Um ataque rolado da ficha com um token como alvo é comparado com a CA dele, e o dano pode ser aplicado com um clique no resultado do chat (ou automaticamente, se o mestre ligar isso). Assim armadilhas e golpes isolados não exigem abrir a arena.

### 6.7 Dados, chat, macros e tabelas

- Chat da mesa com mensagens, rolagens e sussurro para pessoas específicas.
- Sintaxe de dados compatível com o Roll20 no essencial: `/r 1d20+5`, rolagens embutidas `[[2d6+3]]`, vantagem e desvantagem, manter maiores ou menores **[escolha do design]**.
- Macros **[Paulo]**: botões salvos pelo jogador ou pelo mestre, com texto e rolagens, que podem ler valores da ficha (por exemplo, o bônus de Furtividade).
- Rolagens secretas do mestre.
- Tabelas roláveis criadas pelo mestre **[escolha do design]**.

### 6.8 Compêndio

- Monstros, magias, itens, classes, subclasses, espécies/raças, talentos, condições e regras do SRD 5.1 e 5.2, com busca e filtros, e cada item marcado com a versão.
- Os monstros têm ficha completa e podem ir direto para o mapa.
- Atribuição CC-BY-4.0 visível.

### 6.9 Batalha [Paulo]

A batalha é uma interface própria, montada a partir da posição dos tokens no mapa. A luta acontece toda nela, e no final o jogo atualiza a vida dos jogadores, o resultado e os drops. Detalhamento **[escolha do design]**:

**Entrada**
1. O mestre seleciona os participantes (ou a área) e inicia a batalha.
2. O jogo recorta a área do mapa em volta dos participantes e monta a arena em perspectiva isométrica 2D. Paredes viram blocos, portas viram passagens (abertas, fechadas ou trancadas), obstáculos e cobertura viram objetos. Cada token começa no quadrado em que estava.
3. A iniciativa é rolada automaticamente (o mestre pode ajustar) e a ordem aparece no topo da arena.

**Relação com o resto da mesa [escolha do design]**
- A arena abre para os participantes. Quem não está na batalha continua na mesa e pode assistir à arena em modo espectador.
- Pode haver no máximo uma batalha por mapa ao mesmo tempo; mapas diferentes podem ter batalhas simultâneas (grupo dividido).
- Durante a batalha, os tokens participantes ficam travados no mapa; o resto do mapa continua editável pelo mestre.

**Quanto da 5e é automatizado no MVP [escolha do design]**
- Automático: as peças gerais (ataque contra CA, dano e tipos de dano, salvaguardas, espaços de magia, condições, concentração, testes contra a morte, movimento) e áreas de efeito (cone, esfera, cubo, linha) que escolhem os alvos na arena.
- Efeitos específicos de magias, características de classe e habilidades de monstros são automatizados aos poucos, começando pelos que os personagens e monstros da sessão de teste usam.
- Tudo o que não estiver automatizado tem um caminho manual: o botão rola os dados descritos no compêndio e o jogador ou o mestre aplica o efeito com poucos cliques (dano, cura, condição, recurso gasto). Nenhum conteúdo do SRD fica inutilizável por falta de automação.
- Por isso, o compêndio guarda o texto do SRD e, à parte, os efeitos em formato que o sistema entende, preenchidos aos poucos.

**Durante**
- Todos veem a mesma arena ao vivo, respeitando a visão de cada um.
- Na vez do personagem, o jogador vê os quadrados alcançáveis, as ações disponíveis (ataques, magias, ações padrão como Disparada, Esquiva, Ajuda) e os recursos do turno (ação, ação bônus, movimento, reação).
- O sistema resolve: ataque contra CA com vantagem e desvantagem, dano com resistência, vulnerabilidade e imunidade, salvaguardas contra CD de magia, consumo de espaços de magia e recursos, condições com duração em rodadas, testes de concentração, testes contra a morte, movimento que respeita paredes, terreno difícil e ocupação.
- Na vez de um monstro, o mestre vê quem está ao alcance e quais ataques o monstro tem, e resolve em poucos cliques.
- O mestre pode, a qualquer momento: corrigir qualquer valor, desfazer a última ação, adicionar ou remover participantes, pausar ou encerrar a batalha.
- Reações automáticas (por exemplo, ataque de oportunidade, Escudo) não entram no MVP; no MVP, o jogador ou o mestre usa a reação manualmente pela interface.

**Saída**
1. A batalha termina por vitória, fuga, rendição ou encerramento pelo mestre.
2. A tela de resultado mostra o que mudou: vida, espaços de magia e recursos gastos, condições, quem caiu.
3. No MVP, o mestre informa XP e itens à mão nessa tela e escolhe quem recebe cada item.
4. Ao confirmar, tudo é gravado nas fichas e no mapa: os tokens voltam para a mesa na posição final, e os monstros derrotados ficam marcados como derrotados.

**Arte:** o MVP pode usar arte simples (formas e cores, como no mockup) ou pacotes de arte com licença livre. A arena com mais clima é um diferencial da Fase 3.

### 6.10 Handouts e diário [Paulo]

- Handouts com texto e imagens, entregues a todos ou a jogadores específicos, e revelados quando o mestre quiser.
- Notas do mestre, invisíveis para os jogadores.
- Diário da campanha com as sessões.

### 6.11 Jukebox [Paulo]

- O mestre sobe arquivos de áudio e monta playlists e faixas em loop.
- A música toca sincronizada para todos, com volume individual para cada jogador.
- Só arquivos enviados pelo mestre; links do YouTube ou de streaming não entram, porque não dá para sincronizar de forma confiável e permitida **[escolha do design]**.
- Limite de armazenamento por campanha.

### 6.12 Salvar e retomar

- Tudo é salvo continuamente no servidor. Fechar o navegador não perde nada.
- Quem cai da conexão volta para o estado atual da mesa ou da batalha.

### 6.13 API para bots e servidor MCP [Paulo]

Objetivo: integrar bots e permitir que Claude, Codex e outras ferramentas de IA ajudem a montar e gerenciar campanhas enquanto a IA própria não existe. Detalhamento **[escolha do design]**:

- **API externa:** expõe as mesmas ações de 6.1 (ler o estado, criar mapas, colocar tokens, editar fichas, criar handouts, rolar, conduzir a batalha) e avisa em tempo real o que acontece na mesa. Não existe ação exclusiva da API.
- **Acesso:** o usuário gera uma chave de acesso nas configurações, escolhendo a campanha e o que a chave pode fazer (só ler, agir como jogador, agir como mestre). A chave pode ser revogada a qualquer momento.
- **Servidor MCP:** uma camada fina sobre a API, para Claude Code, Codex e outros clientes MCP. Ferramentas pensadas para montar campanha: criar mapa a partir de imagem, traçar paredes, criar NPC com ficha, popular encontro com monstros do compêndio, escrever handouts, consultar regras e fichas, resumir a sessão a partir do histórico.
- **Bots:** o mesmo acesso serve para um bot do Discord feito por terceiros ou pelo próprio grupo, por exemplo para avisar no canal de quem é o turno.
- **Rastreabilidade:** toda ação feita pela API ou pelo MCP aparece no histórico com o nome do usuário e a indicação "via API" ou "via MCP", e pode ser desfeita pelo mestre como qualquer outra.

### 6.14 Fichas de outros sistemas [Paulo]

- As fichas são definidas por modelos declarativos: campos, valores calculados por fórmula, listas (inventário, magias) e botões de rolagem com a sintaxe de dados de 6.7 **[escolha do design]**.
- A ficha de 5e é um desses modelos, com a automação de regras ligada a ela.
- Outros sistemas usam o mesmo formato. Para eles, a mesa funciona inteira (mapa, tokens com barras ligadas a campos da ficha, dados, macros, iluminação, handouts, jukebox, API e MCP), mas sem regras automáticas: a batalha abre a arena em modo manual, com iniciativa e turnos, e o mestre aplica os resultados.
- **Modelos prontos no MVP [Paulo]:** Tormenta20, Ordem Paranormal e Pathfinder 2e.
- **Cuidado com licença:** Tormenta20 e Ordem Paranormal são sistemas proprietários, e o nome "Pathfinder" é marca da Paizo, mesmo com as regras sob licença aberta (ORC). Os modelos trazem apenas a estrutura da ficha (campos e fórmulas), sem texto de regras, e o uso dos nomes no produto precisa ser confirmado com as editoras ou com um advogado antes do lançamento público. Para o uso do grupo durante o desenvolvimento, isso não bloqueia nada.
- O mestre pode criar ou importar um modelo de ficha. Importar significa trazer um arquivo no nosso próprio formato **[escolha do design]**; converter fichas HTML do Roll20 não entra no MVP. Modelos de sistemas com licença livre podem vir prontos.

## 7. Tecnologia [escolha do design, salvo onde indicado]

- **Navegador:** TypeScript [Paulo], React para a interface, PixiJS para o mapa, a iluminação e a arena.
- **Servidor:** TypeScript (Node.js), conexão em tempo real por WebSocket, PostgreSQL para dados, armazenamento de objetos compatível com S3 para imagens e áudio.
- **Organização:** um único repositório com pacotes separados para navegador, servidor, regras de 5e (usado pelos dois lados), dados do compêndio e servidor MCP.
- **Repositório:** `RpgAi`. Os notebooks de fine-tuning de 2024 continuam no repositório como material de pesquisa para o projeto 5; o dataset não pode ser usado no produto (ver seção 4).

## 8. Roadmap

### Fase 0: Fundação
Repositório organizado, build, testes automatizados, ambiente de desenvolvimento local, publicação num servidor de teste.

### Fase 1: MVP, uma sessão sem Roll20
Marcos internos, cada um utilizável e testável sozinho:

1. **Mesa básica:** login com Discord, campanhas, convite, mapa com grid, tokens, chat e dados, sincronização em tempo real.
2. **Fichas e compêndio:** fichas de 5e com rolagem, compêndio SRD 5.1 e 5.2, monstros arrastáveis para o mapa.
3. **Paredes e visão:** paredes, portas, iluminação dinâmica, névoa e exploração.
4. **Batalha:** arena isométrica a partir do mapa, turnos, regras automáticas e saída com resultado.
5. **Recursos de mesa:** macros, tabelas roláveis, jukebox, handouts e diário.
6. **API, MCP e outros sistemas:** chaves de acesso, API externa, servidor MCP e modelos de ficha para outros sistemas. A API pode ser liberada antes, logo depois do marco 2, para o Paulo já usar Claude e Codex na montagem das campanhas.
7. **Sessão de teste:** o grupo do Paulo joga uma aventura curta nova de 5e, preparada na mesa (o MCP pode ajudar a montar). O que travar vira a lista da Fase 2.

### Fase 2: Corrigir o que a primeira sessão mostrar
Subida de nível guiada (o jogador escolhe as habilidades dentro do jogo, e elas aparecem na ficha e na barra da batalha), editor de conteúdo próprio, importação de personagens e mapas do Roll20, XP e drops calculados pelo sistema.

### Fase 3: Diferenciais de jogo
Arena com animações e efeitos, reações automáticas no estilo Baldur's Gate 3, percepção automática ao entrar numa área, minigames no lugar de rolagens puras (a ficha define a dificuldade, e o jogador pode preferir rolar o dado).

### Depois: os outros projetos
2. IA ajudante e bot do Discord. 3. Produto à venda. 4. Criação com IA. 5. Modo solo com Mestre IA. Cada um recebe o próprio documento de design antes de começar.

## 9. Referências

- Mockups da conversa de design (publicados na conta paulorfholanda@gmail.com):
  - Mesa com reação e três modos: https://claude.ai/artifact/W51rrCQV5FheH3FH9e1K3L
  - Entrada, nova campanha, conversa, batalha e minigame: https://claude.ai/artifact/3fteR6qNEWAF4YixDxr2Mf
- SRD 5.1 e 5.2 (CC-BY-4.0): https://dndbeyond.com/srd

## 10. Deixado para o builder

- Biblioteca de componentes de interface, estado no navegador, ORM e estrutura interna dos pacotes.
- Protocolo de sincronização em tempo real e formato das ações, desde que respeite 6.1.
- Formato de armazenamento de mapas, paredes e fichas.
- Hospedagem do servidor de teste.
- Arte de placeholder para tokens e arena.
- Algoritmo de visão e iluminação.
- Como extrair os dados do SRD para o formato do compêndio.
