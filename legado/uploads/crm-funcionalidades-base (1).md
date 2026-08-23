# CRM Omnichannel com Foco em WhatsApp: Funcionalidades Base

## 1. Introdução e escopo deste documento

Este documento mapeia as funcionalidades fundamentais que compõem a base de qualquer CRM de atendimento omnichannel voltado para WhatsApp, no mesmo modelo de Chatwoot e Whaticket. O objetivo é servir de referência funcional para a etapa de desenho das interfaces no Claude Design.

Cada funcionalidade está descrita com quatro camadas de informação:

- Objetivo: o que a funcionalidade resolve para o usuário
- Página(s) ou tela(s): onde ela vive dentro da navegação do produto
- Componentes e elementos de UI: as peças que precisam ser desenhadas
- Estados e variações: o que muda visualmente dependendo do contexto (vazio, carregando, erro, com dados, etc)

Este documento cobre o que precisa existir em cada tela. Os tokens visuais (cor, tipografia) e a estrutura canônica de layout ficam no documento separado SOLINT_CRM_DESIGN_SPEC.md, que deve ser usado em conjunto com este no Claude Design.

## 2. Arquitetura de informação (mapa de páginas)

Rotas e páginas de topo sugeridas para a navegação principal do CRM:

- /dashboard, Visão geral
- /conversas, Caixa de entrada e conversas
- /kanban, Funil visual de oportunidades
- /contatos, Base de contatos
- /campanhas, Disparos em massa
- /agentes-ia, Configuração de agentes de inteligência artificial
- /automacoes, Regras, macros e respostas automáticas
- /relatorios, Analytics e métricas
- /integracoes, Canais e apps conectados
- /equipe, Agentes, papéis e permissões
- /configuracoes, Configurações gerais da conta, com subpáginas
- /perfil, Conta pessoal do usuário logado

Segundo o SKILL.md solint-crm-design, esses itens aparecem agrupados em 7 ícones na navigation rail: Caixa de Entrada (conversas), Contatos, Kanban, Agentes de IA, Campanhas, Dashboard & Relatórios (dashboard e relatórios sob o mesmo ícone) e Configurações & Conexões (provavelmente reúne também integrações, equipe e automações, a confirmar). Perfil fica fora da rail, acessível pelo avatar no rodapé.

A navegação global também precisa de um espaço para central de notificações e para troca de conta/workspace, que normalmente vivem na topbar em vez de serem páginas próprias.

## 3. Estrutura global da interface (shell do produto)

Objetivo: fornecer o esqueleto de navegação presente em todas as telas internas do CRM.

Página(s): a navigation rail é compartilhada por todas as telas autenticadas. A topbar aparece em todas as páginas, exceto /conversas, que segue o layout de 4 colunas do SKILL.md sem topbar própria (ver seção 6).

Componentes e elementos de UI:

- Navigation rail lateral fixa de 64px, com logo Solint no topo e ícones de navegação ao centro, um por grupo de páginas listado na seção 2 (largura e tokens visuais definidos no SKILL.md)
- Indicador de item ativo na rail
- Badge de contagem (ex: número de conversas não lidas) sobre o ícone de Conversas
- Rodapé da rail com avatar do agente, seletor de status de disponibilidade (online, ausente, offline) e alternância de tema claro/escuro, conforme o SKILL.md
- Topbar, presente em dashboard, contatos, kanban, campanhas, agentes de IA, relatórios, configurações e demais páginas fora de /conversas, com campo de busca global, ícone de notificações com badge de não lidas e seletor de conta/workspace para quem tem acesso a mais de uma conta
- Área de conteúdo central, com breadcrumb ou título de página quando aplicável

Estados e variações: tema claro e escuro, rail em modo mobile (drawer sobreposto ou barra inferior), topbar presente versus ausente dependendo da página, estado de usuário sem notificações versus com notificações pendentes.

## 4. Autenticação e onboarding

Objetivo: permitir que um novo usuário crie conta, entre na plataforma e configure o mínimo necessário para começar a operar.

Página(s):

- /login
- /cadastro
- /recuperar-senha
- /redefinir-senha
- /onboarding (fluxo em etapas)

Componentes e elementos de UI:

- Formulário de login (email, senha, opção mostrar/ocultar senha, lembrar de mim)
- Formulário de cadastro (nome, email, senha, nome da empresa)
- Fluxo de recuperação de senha (solicitar link por email, tela de confirmação de envio, formulário de nova senha)
- Wizard de onboarding em etapas: dados da empresa, criação da primeira caixa de entrada/canal, convite de membros da equipe, tela de conclusão
- Indicador de progresso do onboarding (stepper)
- Tela de convite de equipe por email, com campo para múltiplos endereços e seleção de papel

Estados e variações: erro de credenciais inválidas, campo obrigatório não preenchido, carregamento durante autenticação, sucesso de cadastro, etapa do onboarding pulada versus concluída.

## 5. Dashboard (visão geral)

Objetivo: dar ao usuário uma leitura rápida da saúde do atendimento e das vendas assim que ele entra na plataforma.

Página(s): /dashboard

Componentes e elementos de UI:

- Cards de KPI no topo (conversas abertas, tempo médio de primeira resposta, tempo médio de resolução, CSAT, conversas resolvidas hoje)
- Gráfico de volume de conversas por período (linha ou barras, com seletor de intervalo: hoje, 7 dias, 30 dias, personalizado)
- Gráfico de distribuição de conversas por canal (WhatsApp, Instagram, email, etc)
- Ranking de agentes por produtividade (tabela ou lista com avatar, nome, quantidade de conversas atendidas, tempo médio de resposta)
- Painel de funil resumido (quantidade de oportunidades por etapa do kanban)
- Lista de atividades recentes ou pendências (conversas aguardando resposta há mais tempo)
- Atalhos rápidos para ações comuns (nova conversa, novo contato, novo agente de IA)

Estados e variações: dashboard vazio para conta nova (sem dados suficientes, com chamada para ação de configurar primeiro canal), estado de carregamento dos gráficos, seleção de período sem dados no intervalo.

## 6. Caixa de entrada e conversas

Objetivo: núcleo operacional do CRM, onde o agente humano ou o agente de IA conduz o atendimento em tempo real.

Página(s): /conversas (lista de conversas mais painel de conversa, geralmente em layout de três colunas)

Observação: /conversas é a única página sem a topbar padrão da seção 3. A navegação global fica só na navigation rail; busca, cabeçalho da conversa e ações ficam embutidos nas colunas abaixo.

### 6.1 Lista de conversas

Componentes e elementos de UI:

- Lista de conversas com avatar do contato, nome, prévia da última mensagem, canal de origem (ícone), horário, badge de não lida
- Abas ou filtros de status: abertas, pendentes, resolvidas, em espera (snoozed)
- Filtro rápido: minhas conversas, não atribuídas, todas, menções
- Filtros avançados combináveis (canal, etiqueta, agente responsável, equipe, atributo personalizado, prioridade, data)
- Campo de busca dentro da lista de conversas
- Indicador visual de prioridade (baixa, média, alta, urgente)
- Indicador de SLA (badge de tempo restante ou estourado)
- Ordenação da lista (mais recentes, mais antigas, prioridade)

### 6.2 Painel da conversa

Componentes e elementos de UI:

- Cabeçalho da conversa com nome e avatar do contato, canal de origem, status atual, seletor de status (abrir, resolver, colocar em espera), seletor de prioridade, botão de atribuir a agente/equipe
- Histórico de mensagens em formato de timeline, diferenciando mensagens do contato e do agente/IA
- Bolhas de mensagem por tipo de conteúdo: texto, áudio (com player e transcrição opcional), imagem, vídeo, documento/arquivo, localização, contato compartilhado, template de WhatsApp (HSM), enquete
- Indicador de status de entrega da mensagem (enviada, entregue, lida), no padrão de checks do WhatsApp
- Suporte a resposta citando mensagem anterior (reply/quote)
- Reações a mensagens (emoji)
- Indicador de digitação do contato e de outro agente visualizando a mesma conversa (prevenção de colisão de agentes)
- Nota interna/privada, visualmente distinta das mensagens enviadas ao cliente (ex: fundo amarelo, ícone de cadeado)
- Caixa de composição de resposta: editor de texto, anexar arquivo, gravar áudio, inserir emoji, inserir respostas rápidas/canned responses, agendar envio, alternância entre "responder" e "nota interna"
- Seletor de template de WhatsApp aprovado, quando a janela de atendimento de 24h está fechada
- Botão de transferir conversa para outro agente, equipe ou para o agente de IA

### 6.3 Painel lateral de contexto do contato

Componentes e elementos de UI:

- Dados cadastrais do contato (nome, telefone, email, empresa)
- Atributos personalizados do contato
- Etiquetas (labels) aplicadas à conversa e ao contato
- Histórico de conversas anteriores com o mesmo contato
- Notas sobre o contato
- Card de oportunidade vinculada (se o contato estiver em algum funil do kanban)
- Ações rápidas (bloquear contato, mesclar contatos duplicados, criar nova conversa)

Estados e variações: conversa nova sem histórico, conversa longa com scroll de histórico, contato sem dados cadastrais preenchidos, canal offline/desconectado (banner de aviso), mensagem com falha de envio (ícone de erro e opção de reenviar), estado de "conversa arquivada".

## 7. Kanban / funil visual de oportunidades

Objetivo: transformar conversas em oportunidades de negócio organizadas por etapa, dando visão de funil para gestores e vendedores.

Página(s): /kanban

Componentes e elementos de UI:

- Board com colunas representando etapas do funil, configuráveis por conta
- Seletor de funil/pipeline, para contas com múltiplos funis (por produto, equipe ou processo)
- Cards de oportunidade, exibindo avatar e nome do contato, valor da negociação, responsável, prioridade, próxima ação, tempo parado na etapa
- Drag and drop de cards entre colunas
- Contador de cards e soma de valores no topo de cada coluna
- Botão de criar oportunidade manualmente, sem partir de uma conversa
- Modal ou painel lateral de detalhe do card, com histórico, tarefas vinculadas, anexos e acesso rápido à conversa de origem
- Filtros do board (responsável, etiqueta, faixa de valor, data de entrada na etapa)
- Indicador visual de card parado há muito tempo na mesma etapa (alerta)
- Configuração de etapas do funil (criar, renomear, reordenar, definir cor, marcar como etapa de ganho ou perda)

Estados e variações: funil vazio (chamada para ação de criar primeira etapa ou oportunidade), coluna sem cards, card sendo arrastado (estado de drag ativo), múltiplos funis configurados versus conta com apenas um funil.

## 8. Contatos (base de CRM)

Objetivo: centralizar o cadastro e histórico de todas as pessoas e empresas que já interagiram com a conta.

Página(s): /contatos (lista) e /contatos/:id (perfil detalhado)

Componentes e elementos de UI:

- Tabela ou lista de contatos com colunas configuráveis (nome, telefone, email, empresa, etiquetas, último contato, responsável)
- Busca e filtros avançados combináveis, com opção de salvar filtro como segmento
- Botão de importar contatos via CSV, com tela de mapeamento de colunas
- Botão de exportar contatos filtrados
- Botão de criar contato manualmente
- Página de perfil do contato: dados cadastrais editáveis, atributos personalizados, linha do tempo de interações (conversas, notas, mudanças de etapa no funil), lista de conversas relacionadas, empresa vinculada
- Ação de mesclar contatos duplicados
- Gestão de listas/segmentos salvos, para reutilização em campanhas e filtros

Estados e variações: lista vazia para conta nova, contato sem nenhuma interação registrada, contato com múltiplos números de WhatsApp, estado de importação em andamento com barra de progresso e relatório de erros de importação.

## 9. Agentes de inteligência artificial

Objetivo: permitir configurar assistentes de IA que atendem conversas de forma autônoma, com regras claras de quando transferir para um humano.

Página(s): /agentes-ia (lista) e /agentes-ia/:id (edição de um agente)

Componentes e elementos de UI:

- Lista de agentes de IA configurados, com nome, canal/inbox vinculado, status (ativo/inativo)
- Botão de criar novo agente de IA
- Formulário de configuração do agente: nome, persona/tom de voz, instruções/prompt principal, modelo de linguagem utilizado
- Editor de base de conhecimento do agente (upload de documentos, FAQs, textos de referência)
- Configuração de regras de transferência para humano (por palavra-chave, por intenção detectada, por solicitação explícita do cliente, por horário)
- Configuração de etapas/fluxo de atendimento do agente, em formato de builder visual com blocos conectáveis (semelhante a um editor de fluxo tipo n8n), para quem quiser desenhar jornadas mais estruturadas além do prompt livre
- Ambiente de teste/preview do agente, simulando uma conversa antes de publicar
- Log de conversas conduzidas pelo agente, com indicação de quando houve transferência para humano e o motivo
- Toggle de ativar/desativar o agente por inbox

Estados e variações: agente em rascunho versus publicado, agente sem base de conhecimento configurada, teste do agente em andamento, histórico de logs vazio para agente recém-criado.

## 10. Automações e regras

Objetivo: reduzir trabalho manual repetitivo através de gatilhos automáticos sobre conversas e contatos.

Página(s): /automacoes, com subseções para automações, macros e respostas automáticas

Componentes e elementos de UI:

- Lista de automações criadas, com nome, gatilho resumido e status ativo/inativo
- Construtor de automação no formato gatilho, condição e ação (ex: quando uma conversa é criada, se o canal for WhatsApp, então atribuir à equipe X e aplicar etiqueta Y)
- Lista de macros (sequência de ações executáveis manualmente com um clique, como aplicar etiqueta, enviar mensagem padrão e mudar status)
- Editor de macro, permitindo empilhar múltiplas ações em sequência
- Configuração de mensagem automática de fora do horário comercial
- Configuração de mensagem automática de primeira resposta/saudação
- Seletor de método de atribuição automática de conversas entre agentes de uma equipe

Estados e variações: automação desativada temporariamente, lista vazia com chamada para criar a primeira automação, conflito entre duas automações com o mesmo gatilho (aviso).

## 11. Integrações

Objetivo: conectar o CRM aos canais de comunicação e a outras ferramentas do ecossistema do usuário.

Página(s): /integracoes

Componentes e elementos de UI:

- Galeria de integrações disponíveis, organizada por categoria (canais de mensageria, pagamentos, automação externa, calendário, outros)
- Card de cada integração, com logo, nome, descrição curta e botão de conectar/gerenciar
- Fluxo de conexão de canal de WhatsApp, contemplando tanto conexão via QR Code (sessão tipo WhatsApp Web) quanto via API oficial (Cloud API/BSP), com tela de status da conexão (conectado, desconectado, pareando)
- Fluxo de conexão de outros canais (Instagram Direct, Messenger, email via IMAP/SMTP, webchat para site próprio)
- Tela de configuração de webhooks de saída (URL de destino, eventos disparados, campo com a chave de assinatura)
- Tela de geração e gerenciamento de tokens de API/chaves de acesso, para integração com ferramentas externas de automação
- Indicador de status de cada canal conectado (ativo, com erro, desconectado) visível tanto aqui quanto na lista de conversas

Estados e variações: canal recém-conectado aguardando confirmação, canal com erro de autenticação (banner de aviso com ação de reconectar), múltiplos números de WhatsApp conectados na mesma conta.

## 12. Campanhas (disparo em massa)

Objetivo: permitir comunicação proativa e em lote com contatos ou segmentos, respeitando as regras de template do WhatsApp.

Página(s): /campanhas (lista) e /campanhas/nova (criação)

Componentes e elementos de UI:

- Lista de campanhas com nome, canal, status (rascunho, agendada, em andamento, concluída), taxa de entrega e taxa de leitura
- Assistente de criação de campanha em etapas: seleção de público/segmento, seleção de template de mensagem aprovado, personalização de variáveis, agendamento de data e hora de envio
- Seletor de segmento de contatos (lista salva ou filtro construído na hora)
- Pré-visualização da mensagem como ela aparecerá no WhatsApp do destinatário
- Painel de acompanhamento de envio em tempo real (enviados, entregues, lidos, com erro)
- Relatório pós-campanha com métricas de desempenho

Estados e variações: campanha em rascunho não enviada, campanha pausada, campanha com parte dos envios falhos (detalhamento de erros), ausência de templates aprovados disponíveis (aviso e link para criar/solicitar aprovação).

## 13. Relatórios e analytics

Objetivo: oferecer visão analítica aprofundada além dos KPIs resumidos do dashboard.

Página(s): /relatorios, com abas ou subpáginas por tema (conversas, agentes, funil/vendas, CSAT)

Componentes e elementos de UI:

- Seletor de intervalo de datas e de comparação com período anterior
- Filtro por canal, equipe ou agente específico
- Gráficos de série temporal (volume de conversas, tempo de resposta, tempo de resolução)
- Tabela de desempenho por agente (conversas atendidas, tempo médio de resposta, CSAT médio)
- Relatório de funil (taxa de conversão entre etapas, tempo médio em cada etapa, motivos de perda)
- Relatório de CSAT (distribuição de notas, comentários de clientes)
- Botão de exportação de relatório (CSV/PDF)

Estados e variações: período sem dados suficientes, comparação entre períodos com variação positiva/negativa destacada visualmente, relatório em carregamento para intervalos longos.

## 14. Equipe e permissões

Objetivo: administrar quem tem acesso ao CRM e o que cada pessoa pode fazer dentro dele.

Página(s): /equipe (agentes), /equipe/papeis (papéis e permissões), /equipe/equipes (departamentos)

Componentes e elementos de UI:

- Lista de agentes da conta, com avatar, nome, email, papel, status (ativo, convite pendente, inativo)
- Botão de convidar novo agente por email, com seleção de papel na hora do convite
- Tela de edição de agente (papel, equipes que participa, caixas de entrada que acessa)
- Gestão de papéis/funções com lista de permissões em formato de toggles
- Gestão de equipes/departamentos, com nome, descrição, membros e caixas de entrada vinculadas
- Configuração de horário de trabalho por agente ou por equipe

Estados e variações: convite de agente pendente de aceite, agente desativado mantendo histórico, papel customizado versus papéis padrão do sistema.

## 15. Configurações gerais da conta

Objetivo: reunir os ajustes administrativos que afetam toda a conta/workspace.

Página(s): /configuracoes, com subpáginas por tema

Componentes e elementos de UI:

- Configurações gerais da empresa (nome, logo, domínio, fuso horário padrão)
- Gestão de caixas de entrada/canais (renomear, definir horário comercial por canal, mensagem de ausência, webhook específico do canal)
- Gestão de etiquetas/labels (criar, editar cor, arquivar)
- Gestão de atributos personalizados (para contato ou para conversa, com tipo de dado: texto, número, data, lista, checkbox)
- Gestão de templates de mensagem e respostas rápidas/canned responses
- Base de conhecimento/central de ajuda (criação de artigos, categorias, publicação)
- Faturamento e plano (plano atual, uso do período, histórico de faturas, forma de pagamento, upgrade/downgrade)
- Segurança da conta (autenticação de dois fatores, sessões ativas, log de auditoria)
- Preferências de notificação em nível de conta

Estados e variações: cada subpágina de configuração com seu próprio estado de lista vazia versus lista preenchida, mudança de plano com tela de confirmação de cobrança.

## 16. Perfil e conta pessoal do usuário

Objetivo: permitir que o usuário logado gerencie seus próprios dados e preferências, independente das configurações gerais da conta.

Página(s): /perfil

Componentes e elementos de UI:

- Dados pessoais (nome, avatar, email, telefone)
- Assinatura de mensagem padrão do agente
- Alteração de senha
- Preferências de notificação pessoal (email, push, desktop, por tipo de evento)
- Seletor de idioma da interface
- Seletor de tema (claro, escuro, automático)
- Seletor de status de disponibilidade (online, ausente, offline)
- Lista de contas/workspaces que o usuário participa, com botão de trocar de conta
- Botão de sair (logout) de todas as sessões

Estados e variações: usuário com acesso a uma única conta (sem necessidade de switcher) versus múltiplas contas, alteração de senha com validação de força.

## 17. Notificações

Objetivo: manter o usuário informado sobre eventos relevantes sem precisar estar com o produto aberto o tempo todo.

Página(s): painel/dropdown acessível pela topbar em qualquer página, mais /configuracoes para preferências

Componentes e elementos de UI:

- Ícone de sino na topbar com badge de contagem de não lidas
- Painel dropdown ou drawer lateral com lista de notificações recentes (nova conversa atribuída, menção, SLA prestes a estourar, campanha concluída)
- Marcação de notificação como lida, individual e em lote
- Notificação toast em tempo real para eventos críticos enquanto o usuário está com o produto aberto
- Link direto de cada notificação para o contexto relacionado (a conversa, o card do kanban, o relatório)

Estados e variações: central de notificações vazia, notificação não lida versus lida (peso visual diferente), acúmulo de muitas notificações (paginação ou "carregar mais").

## 18. Tabela-resumo de páginas para o Claude Design

| Página | Rota sugerida | Funcionalidade principal |
|---|---|---|
| Login/Cadastro/Recuperação | /login, /cadastro, /recuperar-senha | Autenticação |
| Onboarding | /onboarding | Configuração inicial |
| Dashboard | /dashboard | Visão geral e KPIs |
| Conversas | /conversas | Caixa de entrada e atendimento |
| Kanban | /kanban | Funil de oportunidades |
| Contatos | /contatos | Base de CRM |
| Perfil do contato | /contatos/:id | Detalhe do contato |
| Agentes de IA | /agentes-ia | Configuração de IA |
| Automações | /automacoes | Regras, macros e respostas automáticas |
| Integrações | /integracoes | Canais e apps conectados |
| Campanhas | /campanhas | Disparo em massa |
| Relatórios | /relatorios | Analytics |
| Equipe | /equipe | Agentes, papéis e equipes |
| Configurações | /configuracoes | Ajustes gerais da conta |
| Perfil pessoal | /perfil | Conta do usuário logado |
