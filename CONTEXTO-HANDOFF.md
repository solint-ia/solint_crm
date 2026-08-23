# Solint CRM — Contexto do protótipo e handoff para desenvolvimento

Protótipo de interface (HTML/Design Components) do Solint CRM, sistema de atendimento omnichannel focado em WhatsApp, no modelo Chatwoot/Whaticket. Modo claro. Fontes de verdade: `uploads/SKILL.md` (design system) e `uploads/crm-funcionalidades-base (1).md` (funcionalidades).

## 1. Telas construídas (10 arquivos .dc.html)

| Arquivo | Rota alvo | Conteúdo |
|---|---|---|
| Conversas.dc.html | /conversas | Layout 4 colunas sem topbar: rail 64px, lista (busca, filtros Minhas/Não atrib./Todas, abas de status, ordenação, prioridade, SLA, etiquetas), chat (divisores de data, balões cliente/agente/IA, nota interna âmbar, áudio com transcrição, checks WhatsApp, falha de envio + reenviar, digitando, colisão de agentes, banner canal desconectado), painel de contexto (dados, etiquetas, campos personalizados, protocolos, notas, ações rápidas). Composer com modo Mensagem pública / Nota interna funcional. |
| Kanban.dc.html | /kanban | Seletor de pipeline, board com drag-and-drop real entre colunas, contador + soma por coluna, alerta de card parado, filtros, botão Configurar etapas (estático), painel lateral de detalhe com histórico e link para conversa. |
| Contatos.dc.html | /contatos, /contatos/:id | Tabela com seleção, busca, filtros, salvar segmento, importar CSV/exportar (botões estáticos), perfil com dados, atributos, etiquetas, linha do tempo e conversas relacionadas. |
| Agentes-IA.dc.html | /agentes-ia, /agentes-ia/:id | Lista de agentes com métricas, edição com abas: Configuração (persona, prompt, modelo), Base de conhecimento, Regras de transferência (toggles funcionais), Fluxo visual (blocos estáticos), Testar agente (chat simulado funcional), Logs. Toggle ativo por inbox. |
| Campanhas.dc.html | /campanhas, /campanhas/nova | Lista com status/entrega/leitura, aviso de poucos templates aprovados, painel de acompanhamento em tempo real (enviados/entregues/lidos/erros), wizard 4 etapas (público → template → variáveis → agendamento) com pré-visualização estilo WhatsApp. |
| Dashboard.dc.html | /dashboard, /relatorios | Visão geral: 5 KPIs, gráfico de volume 7 dias, distribuição por canal, ranking de agentes, funil resumido, pendências, atalhos, dropdown de notificações funcional. Relatórios: abas Conversas (série temporal), Agentes (tabela), Funil (conversão + motivos de perda), CSAT (distribuição + comentários). |
| Configuracoes.dc.html | /configuracoes (hub) | Sub-sidebar com: Automações e Regras (automações com toggles, macros, mensagens automáticas, método de atribuição), Integrações e Conexões (galeria de canais com status, webhooks, tokens API), Equipe e Permissões (agentes, papéis, equipes/filas), Etiquetas, Respostas rápidas, Atributos personalizados, Empresa, Faturamento e Plano (plano, uso, faturas), Segurança (2FA, sessões ativas, log de auditoria). |
| Login.dc.html | /login, /cadastro, /recuperar-senha | Lado de marca com gradiente institucional + formulários alternáveis: login (mostrar/ocultar senha, lembrar de mim, estado de erro de credenciais, loading), cadastro (indicador de força de senha → leva ao Onboarding), recuperação (envio de link com confirmação). Demo: qualquer email + senha vazia ou "solint" entra; outra senha mostra erro. |
| Onboarding.dc.html | /onboarding | Wizard 4 etapas com stepper funcional: Empresa (dados), Canal (seleção com QR Code de pareamento WhatsApp e estado "aguardando"), Equipe (convite por emails + papel, pulável), Conclusão (→ caixa de entrada). |
| Perfil.dc.html | /perfil | Dados pessoais, seletor de disponibilidade (Disponível/Ocupado/Ausente refletido no avatar da rail), assinatura de mensagem, alteração de senha, preferências de notificação (toggles funcionais), idioma/tema, múltiplos workspaces com troca de conta, sair de todas as sessões. Acessível pelo avatar no rodapé da rail em todas as telas. |

Navegação: rail de 7 ícones (SKILL.md §4.1) com links reais entre todas as telas; item ativo destacado; avatar com status no rodapé (ciclo de status funcional só em Conversas).

## 2. Complementos já aplicados nas telas

- Conversas: banner de janela HSM 24h fechada com seleção de template (conversa Carlos Eduardo), botão agendar envio no composer, mensagem com falha de envio + Reenviar (conversa Pedro Henrique), banner de canal desconectado, indicador de colisão de agentes (conversa Mariana), abas de status, ordenação, indicador de prioridade por conversa.
- Kanban: modal de configurar etapas (renomear, cor, reordenar, flags ganho/perda, excluir, nova etapa).
- Contatos: modal de importação CSV com mapeamento de colunas → progresso 64% + relatório de erros.
- Dashboard: dropdown de notificações funcional (lidas/não lidas).

## 2b. Pendências de UI restantes

- Reações emoji nas mensagens, respostas rápidas via "/" (só o hint), filtro "menções", conversa arquivada/snoozed.
- Mesclar duplicados em Contatos (só botão), tarefas/anexos no card do Kanban, estado de funil vazio.
- Base de conhecimento pública/central de ajuda (§15).
- Estados vazios/carregando em geral (o doc pede por seção).
- Responsivo mobile (rail como drawer/barra inferior).

## 3. Backend — o que construir (para Claude Code / Antigravity)

### 3.1 Fundações
- **Multi-tenant**: workspace/conta como raiz de tudo; usuário pode pertencer a várias contas (switcher na topbar).
- **Auth**: email+senha, recuperação, sessões, 2FA; RBAC com papéis Administrador/Supervisor/Agente + papéis customizados (permissões granulares em toggles).
- **Realtime**: WebSocket (ou Supabase Realtime/Socket.io) para: novas mensagens, digitação, colisão de agentes (presença por conversa), status de entrega, contadores de não lidas, progresso de campanha.

### 3.2 Entidades principais (modelo de dados)
- `accounts`, `users`, `roles`, `teams` (equipes/filas com inboxes vinculadas)
- `inboxes` (canal: whatsapp_cloud | whatsapp_baileys | instagram | webchat | email; status de conexão; horário comercial; mensagens automáticas)
- `contacts` (telefone E.164, email, empresa, atributos personalizados JSONB, etiquetas M:N, merge de duplicados preservando histórico)
- `conversations` (status: aberta/pendente/resolvida/espera; prioridade; agente/equipe responsável; SLA deadline; protocolo #AT-xxxxx sequencial por conta)
- `messages` (tipos: text, audio, image, video, document, location, contact, template_hsm, poll; direção; status de entrega enviando→enviado→entregue→lido→falha; `is_private` para notas internas; reply_to; transcrição de áudio)
- `pipelines` + `stages` (cor, ordem, flag ganho/perda) + `cards` (valor, responsável, prioridade, próxima ação, timestamps por etapa para alerta de parado)
- `ai_agents` (persona, prompt, modelo, regras de transferência, documentos da KB com embeddings, logs com motivo de handoff)
- `automations` (gatilho/condição/ação, ordem de execução, detecção de conflito), `macros`, `canned_responses`
- `campaigns` (segmento, template, variáveis, agendamento, contadores enviado/entregue/lido/erro por destinatário)
- `labels`, `custom_attributes`, `webhooks`, `api_tokens`, `notifications`, `csat_ratings`

### 3.3 Integrações críticas
- **WhatsApp Cloud API (oficial)**: envio/recebimento via webhook Meta, templates HSM (sincronizar status de aprovação), janela de 24h (bloquear mensagem livre fora da janela → forçar template), status de entrega por webhook.
- **WhatsApp não-oficial (Baileys/Evolution API)**: pareamento por QR Code, reconexão automática, sincronização de estado da sessão (o banner "canal desconectado" da UI consome esse status).
- **Instagram Direct / Messenger** (Meta Graph), **email** (IMAP/SMTP), **webchat** (widget próprio + SDK JS).
- **IA**: Anthropic API para agentes (responder com RAG sobre a KB, decidir handoff por palavra-chave/intenção/horário), transcrição de áudio (Whisper ou similar), ambiente de teste isolado (não grava em conversas reais).

### 3.4 Regras de negócio importantes
- Atribuição automática: round-robin | balanceada por carga | manual (configurável por conta, respeitando status online do agente).
- SLA: prazo por fila/prioridade; job que marca estourado e notifica supervisor.
- Automações: engine gatilho→condição→ação executada em eventos (conversa criada, mensagem recebida, tempo pendente); avisar conflito de gatilhos iguais.
- Campanhas: fila de envio com rate limiting (limites do WhatsApp), retry de falhas, relatório por destinatário.
- Notas internas nunca são enviadas ao canal externo.
- CSAT disparado ao resolver conversa (configurável).

### 3.5 API sugerida
REST (ou tRPC) com recursos espelhando as entidades acima + endpoints de relatório agregado (KPIs do dashboard, série temporal, desempenho por agente, conversão do funil, CSAT). Webhooks de saída configuráveis por evento com assinatura HMAC (a UI de Configurações → Integrações já prevê isso).

## 4. Design system (resumo operacional)
- Fontes: Sora (display/títulos/números), Inter (corpo/UI), JetBrains Mono (telefones, códigos, protocolos).
- Cores-chave: `#168CFF` primário, `#174EFF` deep, `#35D9FF` IA/automação, `#FFB65C`/âmbar notas internas e SLA, `#25D366` WhatsApp, `#10B981` online/aberto, `#EF4444` erro/urgente, fundo `#F4F7FB`, bordas `#E5E9F0`.
- Nota interna: fundo `#FFFBEB`, borda `#FCD34D`, ícone de cadeado, texto "visível apenas para a equipe".
- Rail 64px fixa; topbar em todas as páginas exceto /conversas.

### Modo claro/escuro (implementado)
Cada tela define tokens CSS em `:root` e `:root[data-theme="dark"]` no `<helmet>`; todos os estilos inline referenciam `var(--token)`. O botão de tema na rail (`[data-theme-toggle]`) alterna `document.documentElement.dataset.theme` e persiste em `localStorage` na chave `solint-theme` — o tema escolhido vale para todas as telas.

Tokens principais: `--app-bg`, `--surface`, `--surface-2`, `--border`, `--border-soft`, `--text`, `--text-muted`, `--text-dim`, `--accent-soft` / `--accent-soft-text` (balão do atendente), `--note-bg` / `--note-border` / `--note-text` (nota interna âmbar), `--cyan-soft` / `--cyan-text` (agente de IA), e pares soft/text para amber, green, red, violet, blue, slate, pink e indigo (badges e tags). Cores de marca e de canal (`#168CFF`, `#174EFF`, `#35D9FF`, `#25D366`, `#E1306C`, `#6366F1`, `#10B981`, `#EF4444`) são fixas nos dois temas.

Valores dark seguem o SKILL.md §2.3B: fundo `#050A14`, painéis `#0D121A`, superfície ativa `#141A24`, bordas `rgba(255,255,255,0.08)`, texto `#FAFCFF` / `#A3AEBD`, balão do atendente `#0E335C`, nota interna `#1E1A11` com borda `rgba(255,182,92,0.4)`. No produto real, o tema deve vir da preferência do usuário (`/perfil` → Tema: claro/escuro/automático) e ser servido no primeiro render para evitar flash.
