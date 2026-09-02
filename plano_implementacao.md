# Plano de Análise, Correção e Implementação — Solint CRM

> Documento de arquitetura e execução. Nenhuma linha de código foi alterada até aqui:
> tudo abaixo é diagnóstico verificado no repositório (com arquivo e linha) mais a
> especificação do que precisa ser construído.
>
> **Data do levantamento:** 01/09/2026 · **Branch:** `main` · **Commit base:** `31871b3`
> **Stack:** Next.js 15 (App Router) · React 19 · Prisma 7 / PostgreSQL (Supabase) ·
> Baileys 7 (WhatsApp) · Tailwind 4 · Arquitetura hexagonal (`core` / `infrastructure` / `features`)

---

## Sumário

1. [Auditoria e diagnóstico](#1-auditoria-e-diagnóstico)
   - 1.1 [Notificações](#11-notificações)
   - 1.2 [Segurança e sessões](#12-segurança-e-sessões)
   - 1.3 [Métricas: CSAT, tempo de resolução, tempo de 1ª resposta](#13-métricas-csat-tempo-de-resolução-tempo-de-1ª-resposta)
   - 1.4 [Mensagens rápidas e variáveis dinâmicas](#14-mensagens-rápidas-e-variáveis-dinâmicas)
   - 1.5 [Kanban: filtros e taxa de conversão](#15-kanban-filtros-e-taxa-de-conversão)
   - 1.6 [Sincronização de contatos do WhatsApp](#16-sincronização-de-contatos-do-whatsapp)
   - 1.7 [Quadro-resumo do diagnóstico](#17-quadro-resumo-do-diagnóstico)
2. [Especificação das mudanças](#2-especificação-das-mudanças)
   - A. [Multi-tenancy: criação e troca de workspace](#a-multi-tenancy-criação-e-troca-de-workspace)
   - B. [Taxa de conversão do funil](#b-taxa-de-conversão-do-funil)
   - C. [Distribuição de conversas: simplificação](#c-distribuição-de-conversas-simplificação)
   - D. [Auditoria e logs de segurança](#d-auditoria-e-logs-de-segurança)
   - E. [Notificações: os três avisos](#e-notificações-os-três-avisos)
   - F. [CSAT: fechar o ciclo](#f-csat-fechar-o-ciclo)
   - G. [Variáveis dinâmicas e protocolo](#g-variáveis-dinâmicas-e-protocolo)
   - H. [Ajustes de UI, UX e tipografia](#h-ajustes-de-ui-ux-e-tipografia)
3. [Plano de execução por etapas](#3-plano-de-execução-por-etapas)
4. [Migrações de banco consolidadas](#4-migrações-de-banco-consolidadas)
5. [Matriz de QA](#5-matriz-de-qa)
6. [Riscos e decisões em aberto](#6-riscos-e-decisões-em-aberto)

---

# 1. Auditoria e diagnóstico

Legenda de estado:

| Símbolo | Significado |
|---|---|
| 🟢 | Funciona ponta a ponta (banco → domínio → UI) |
| 🟡 | Parcial: existe metade do caminho (schema sem escrita, UI sem backend, etc.) |
| 🔴 | Não implementado: só existe como *seed*, texto na tela ou estado local de React |

---

## 1.1 Notificações

### Infraestrutura comum

| Camada | Estado | Evidência |
|---|---|---|
| Tabela `Notification` | 🟢 existe | `prisma/schema.prisma:516` — `id, accountId, userId?, kind, text, timeLabel, read, href, createdAt` |
| Tipo de domínio `NotificationKind` | 🟢 existe | `src/core/domain/notification.ts:3` — `atribuicao / sla / campanha / mencao / sistema / mensagem` |
| Repositório (leitura, marcar lida) | 🟢 existe | `src/infrastructure/repositories/prisma/misc-repositories.ts:486-520` |
| Preferências por usuário | 🟡 gravadas, nunca lidas | `User.notificationPrefs`, tipo em `src/core/domain/user.ts:154-186` |
| Sininho + SSE em tempo real | 🟢 existe | `src/components/layout/notifications-menu.tsx`, `src/features/realtime/live-notifications.tsx` |
| **Escrita de notificações** | 🔴 **ausente** | Único `prisma.notification.create` do sistema está em `src/infrastructure/automations/automation-effects.ts:172` |

> **Achado central.** O sistema de notificações tem tabela, tipos, repositório de leitura,
> sininho, SSE e tela de preferências — e **nenhum produtor**. As notificações que aparecem
> hoje vêm de `src/infrastructure/seed/notifications.ts` (linhas 8, 17, 26, 35), que semeia
> exatamente uma de cada tipo. Numa conta criada pelo cadastro (`signupAction`), o sininho
> nasce e permanece vazio para sempre.
>
> **Achado secundário.** A única escrita real grava `kind: 'automacao'`
> (`automation-effects.ts:178`), que **não é um valor de `NotificationKind`**. Passa porque
> a coluna é `String` e o `kind` só é validado no domínio, na leitura. É um bug latente de
> renderização: o sininho não tem ícone nem rótulo para `automacao`.

### 1.1.1 🔴 Conversa atribuída diretamente a mim

- Preferência existe: `assigned: boolean`, padrão `true` (`src/core/domain/user.ts:156, 178`).
- Rótulo na tela: `src/features/perfil/components/profile-view.tsx:39`.
- A atribuição acontece em `assignConversationAction`
  (`src/app/(workspace)/conversas/actions.ts:422-446`) → `container.useCases.assignConversation`
  → repositório → `waEventBus`. **Nenhum ponto do caminho cria uma `Notification`.**
- **Falta:** um efeito pós-atribuição que (a) leia `notificationPrefs.assigned` do
  destinatário, (b) grave a linha com `kind: 'atribuicao'` e
  `href: /conversas?conversa=<id>`, (c) emita no barramento SSE para o sininho acender sem
  recarregar a página.

### 1.1.2 🔴 Menções com `@` em notas internas

- Preferência existe: `mentions` (`user.ts:158`). Rótulo em `profile-view.tsx:40`.
- Notas internas funcionam: `Message.isPrivate` (`schema.prisma:345+`), alternância no
  composer (`src/features/conversas/components/composer.tsx:714, 850-855`), bolha própria
  (`message-bubble.tsx:72-77`).
- **Não existe nada de menção.** Um `grep` por `@` em `composer.tsx` só encontra o
  `eslint-disable` da linha 764. Sem autocomplete, sem *parser*, sem persistência de quem
  foi mencionado, sem destaque na bolha.
- **Falta:** o recurso inteiro — *combobox* de `@`, extração de menções no servidor,
  gravação (coluna nova ou JSON em `Message`), notificação `kind: 'mencao'` e realce visual.

### 1.1.3 🔴 Aviso de prazo de resposta (SLA) esgotando

- Colunas existem: `Conversation.slaDeadlineAt`, `slaLabel`, `slaBreached`
  (`prisma/schema.prisma`, mapeadas em `mappers.ts:212-214`).
- São consumidas na UI: *badge* na lista (`conversation-list-item.tsx:131-133`), filtro
  "SLA estourado" (`inbox-filters.tsx:374`, `use-inbox.ts:386`), painel de atenção e tom
  vermelho no dashboard (`analytics-repository.ts:241, 358`).
- **Nenhum código escreve essas três colunas.** As únicas ocorrências de escrita estão em
  `src/infrastructure/seed/conversations.ts:105-106` e `:302`. O filtro "SLA estourado"
  funciona *tecnicamente* e sempre devolve zero resultados numa conta real.
- **Falta:** política de SLA (por caixa ou por conta), cálculo do prazo no momento em que
  a conversa entra em espera de resposta, e um varredor que marque `slaBreached` e dispare
  o aviso *antes* do vencimento — a preferência se chama "quando o prazo **estiver acabando**".

### 1.1.4 ⛔ Campanhas em massa e resumo diário — removidos do escopo

Conforme decidido, as preferências `campaigns`, `dailySummary` e `dailySummaryEmail` saem
do produto. Não será criada infraestrutura de envio de e-mail, provedor, *mailer*, template,
runner nem variável de ambiente relacionada.

Para campanhas:

- Remover a entrada `{ key: 'campaigns', ... }` de `NOTIFICATION_ITEMS`
  (`profile-view.tsx:42`).
- Remover `campaigns` de `NotificationPreferences` e de
  `DEFAULT_NOTIFICATION_PREFERENCES` (`user.ts:162, 181`).
- Remover `campaigns` do schema Zod de `updateProfileAction`
  (`src/app/(workspace)/perfil/actions.ts:40-47`).
- Remover `'campanha'` de `NotificationKind` (`notification.ts:6`) **e** do *seed*
  (`seed/notifications.ts:26`).
- Remover `dailySummary` e `dailySummaryEmail` do domínio, validação e tela de perfil.
- Migração de dados: desnecessária. `notificationPrefs` é `Json?` e a leitura já faz
  *merge* com o padrão; chaves órfãs são ignoradas. (Opcional: script de limpeza.)

---

## 1.2 Segurança e sessões

### 1.2.1 🔴 Autenticação em dois fatores (2FA) — mock completo

| Item | Estado |
|---|---|
| `User.twoFactorEnabled` (coluna) | 🟢 existe, `Boolean @default(false)` |
| Coluna de segredo TOTP | 🔴 não existe |
| Códigos de recuperação | 🔴 não existem |
| Biblioteca TOTP no `package.json` | 🔴 nenhuma (`otplib`/`speakeasy` ausentes) |
| Etapa de verificação no login | 🔴 `loginAction` não a tem (`src/app/(auth)/actions.ts`) |
| UI da seção | 🔴 **totalmente estática** |

Detalhe da UI (`src/features/configuracoes/components/sections/security-section.tsx`):

- Linha 44: `const [twoFactorRequired, setTwoFactorRequired] = useState(true)` — e o *badge*
  **"Ativado na sua conta"** (linha 128) é literal fixo, não lê `session.user.twoFactorEnabled`.
- Linhas 140-152: o botão **"Reconfigurar 2FA"** só chama `show({ tone: 'info', ... })` com
  a frase *"Seu aplicativo autenticador já está vinculado com sucesso"*. Não há autenticador
  vinculado nenhum.
- Linhas 160-174: o *toggle* "Exigir 2FA para todos os membros" grava em estado local e
  exibe *toast* de "Política atualizada". Recarregar a página desfaz.

> **Resposta direta:** o 2FA **não funciona**. A tela afirma ativamente o contrário, o que
> é pior do que não existir: é uma falsa garantia de segurança para o dono da conta.

### 1.2.2 🟡 Sessões ativas — a tela lê a fonte errada

Existem **duas** fontes de "sessão" no sistema, e a tela lê a fictícia:

| Fonte | Natureza | Quem lê |
|---|---|---|
| `AuthSession` (tabela) | **Real.** `tokenId` (= `jti` do JWT), `userAgent`, `ip`, `createdAt`, `expiresAt`, `revokedAt`. Escrita em `createSession` (`src/infrastructure/auth/session.ts:47`), conferida em toda requisição (`session.ts:162`). | `readSession`, `readSuperAdmin` |
| `AccountSettings.activeSessions` (coluna `Json`) | **Fictícia.** Lista estática semeada em `src/infrastructure/seed/settings.ts:278-300` (`"Chrome · Windows 11"`, `"Safari · iPhone 15"`, `"Chrome · macOS"`). | **A tela de Segurança** |

Consequências verificadas:

1. `SecuritySection` recebe `activeSessions` de `settings.activeSessions`
   (`settings-repository.ts:278`) — três dispositivos de mentira, iguais para qualquer
   usuário da conta.
2. `terminateSessionAction` / `terminateOtherSessionsAction` chamam `writeSessions`
   (`settings-repository.ts:1023-1045`), que apenas **filtra itens do JSON**. Nenhum
   `AuthSession.revokedAt` é gravado: o "dispositivo encerrado" continua com acesso total
   até o token expirar (7 dias, `SESSION_TTL_SECONDS`).
3. A lista é **por conta**, não por usuário — viola a semântica de "Sessões ativas na
   **sua** conta" e, num workspace com 10 pessoas, misturaria as sessões de todos.
4. Numa conta criada pelo cadastro, `activeSessions` nasce `[]` → a seção aparece vazia.

> **Resposta direta:** a seção **não funciona**. É decorativa e, pior, o botão de encerrar
> dá a impressão de ter derrubado um acesso que continua vivo.

### 1.2.3 🔴 Botão "Sair de todas as sessões" — a que se refere e por que está desabilitado

O botão fica no topo da página **Meu perfil**:

```
src/app/(workspace)/perfil/page.tsx:44
  <Button variant="danger" size="sm" icon={<LogOut .../>}
          {...planned('Encerrar todas as sessões ativas desta conta')}>
    Sair de todas as sessões
  </Button>
```

`planned()` (`src/components/ui/planned.ts:13-17`) é um marcador do próprio projeto que
devolve `{ disabled: true, title: '<texto> — em desenvolvimento, ainda não disponível.' }`.

**Portanto: está desabilitado porque foi deliberadamente marcado como "ainda não implementado".**

**A que se refere:** derrubar todos os *logins* do usuário em todos os navegadores e
dispositivos (inclusive o atual), forçando novo login com senha. É a ação padrão de
"perdi meu notebook" ou "troquei minha senha".

**O que falta é pouco — a função de backend já existe e está pronta:**

```
src/infrastructure/auth/session.ts:80-87
  export const revokeAllSessions = async (userId: string): Promise<number> => {
    const { count } = await prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  };
```

Ela **não tem um único chamador** em todo o `src/`. Falta apenas: uma Server Action que a
invoque, apague o cookie e redirecione para `/login`, um modal de confirmação, e trocar
`planned(...)` por `onClick`.

Outros usos de `planned()` no sistema, como contexto de priorização:
`context-panel.tsx:239, 246, 252` (nova conversa, mesclar contatos, bloquear contato),
`profile-view.tsx:343` (alterar senha), `profile-view.tsx:487` (**trocar de workspace**, §2.A).

---

## 1.3 Métricas: CSAT, tempo de resolução, tempo de 1ª resposta

Esta é a área **mais bem implementada** do sistema. Os três indicadores são reais.

### 1.3.1 🟢 Tempo de 1ª resposta

- **Onde é carimbado:** `src/infrastructure/repositories/prisma/conversation-repository.ts:154-171`,
  dentro de `persistMessage`, o único ponto por onde toda mensagem passa.
- **Fórmula:** `firstResponseSecs = agora − createdAt(primeira mensagem do contato)`,
  gravado junto com `firstResponseAt`.
- **Regras de exclusão, corretas e deliberadas:**
  - só conta `author === 'agent'`;
  - `isPrivate === false`, porque nota interna não é resposta ao cliente;
  - mensagens automáticas entram como `author: 'system'` (`auto-reply.ts:56`) e portanto
    **não zeram** o indicador. Uma saudação sairia em 2 segundos e mascararia a equipe;
  - a contagem parte da **primeira mensagem do contato**, não de `createdAt` da conversa:
    conversa aberta por nós (campanha) ficaria com 0 s falso;
  - sem mensagem do contato o campo fica `null`, que é diferente de zero.
- **Agregação:** média dos `firstResponseSecs` não-nulos no período
  (`analytics-repository.ts:256-257`), com comparação contra o período anterior
  (`variacao(...)`). Série temporal em `:422`; por agente em `:464`; sem-resposta em `:549`.

### 1.3.2 🟢 Tempo de resolução

- **Onde é carimbado:** `conversation-repository.ts:224-250`, na troca de status.
  `resolvedAt = agora`, `resolutionSecs = agora − createdAt(conversa)`. Sair de "resolvida"
  limpa os dois (`{ resolvedAt: null, resolutionSecs: null }`).
- **Caminho paralelo:** a ação `resolver_conversa` das automações grava os mesmos campos
  (`automation-effects.ts:105-106`). Os dois caminhos concordam.
- **Agregação:** média dos `resolutionSecs` **apenas das conversas com `status === 'resolvida'`**
  no período (`analytics-repository.ts:253-259`). Exibido em minutos no relatório (`:534-535`).

### 1.3.3 🟡 CSAT — calculado corretamente, mas quase sempre sem dados

**Como é calculado** (`src/core/domain/csat.ts`):

| Métrica | Fórmula | Linha |
|---|---|---|
| Escala | fixa, 1 a 5 (`CSAT_MIN`/`CSAT_MAX`). Não é configurável de propósito: CSAT comparável exige escala fixa | `:12-13` |
| Índice do painel | **média aritmética** simples das notas do período | `:44-47` (`csatAverage`) |
| Legenda "% satisfeitos" | `(notas ≥ 4) / total × 100` | `:56-59` (`csatSatisfactionRate`) |
| Sem avaliações | `undefined` → exibe `—`, nunca `0` | `:69-70` (`csatLabel`) |

Agregação no painel: `analytics-repository.ts:261-263`, e o KPI em `:317-331`.

**Leitura da resposta do cliente** — `parseCsatScore` (`csat.ts:27-38`) é deliberadamente
restritivo, e essa é a decisão correta:

- aceita: `"5"`, `"nota 4"`, `"3/5"`, `"4 de 5"`, `"⭐⭐⭐⭐"`, `"2 pontos"`, com `.`/`!` final;
- **rejeita** qualquer frase com mais de 40 caracteres ou que não seja *sobre* a nota
  (`"meu pedido 3 chegou"` não conta). Um falso positivo contamina a média da equipe
  permanentemente;
- janela de validade: **24 h** após a pergunta (`CSAT_WINDOW_MS`, `inbox-auto-messages.ts:38`).

### 1.3.4 🔴 Por que a pesquisa não foi enviada ao finalizar o atendimento

O caminho está **inteiro e correto**. Rastreando:

```
chat-panel.tsx:418            onChangeStatus('resolvida')
  └─ inbox-data.tsx:88        changeConversationStatusAction
      └─ conversas/actions.ts:301-324
          ├─ useCases.changeConversationStatus  (grava resolvedAt/resolutionSecs)
          └─ if (status === 'resolvida') → runClosingAutoReply(accountId, conversationId)
              └─ inbox-auto-messages.ts:182-232
                  ├─ carrega config da caixa (loadInboxAutoConfig)
                  ├─ envia mensagem de encerramento (se ligada)
                  └─ if (!config.csatEnabled || csatScore !== null) RETURN   ← linha 220
                      └─ enviar(destino, config.csatQuestion, 'csat', ...)
                          └─ auto-reply.ts:39  dispatchAutoMessage
```

**Causa raiz, em ordem de probabilidade:**

1. **`csatEnabled` está `false` na caixa de entrada.** A linha 220 de
   `inbox-auto-messages.ts` é uma saída silenciosa. O padrão do schema é
   `csatEnabled Boolean @default(false)` e o *seed* grava `false` nas duas caixas
   (`seed/settings.ts:138, 156`). O *toggle* fica em
   **Configurações → Caixas de entrada → (selecionar a caixa) → Pesquisa de satisfação (CSAT)**
   (`inboxes-section.tsx:1032-1057`) — **não** na tela de Segurança nem em Automações.
   O salvamento só ocorre ao clicar em salvar; `dirty` compara contra `connection.csatEnabled`
   (`:713-714`), então mexer no *toggle* e sair da tela descarta a mudança.
2. **A conversa já tinha `csatAskedAt` recente** — a trava de 24 h (`:220-223`) impede
   reperguntar no mesmo atendimento.
3. **A conversa já tem `csatScore`** — não repergunta a quem já respondeu.
4. **Falha silenciosa no despacho ao canal.** `dispatchAutoMessage` grava a mensagem no
   banco e depois tenta enviá-la ao WhatsApp dentro de um `try/catch` que apenas escreve
   `console.warn` (`auto-reply.ts:118-120`). Se o worker estiver offline ou a caixa
   desconectada, **a mensagem aparece na timeline do CRM e nunca chega ao cliente**, sem
   nenhum aviso na tela.
5. **A ação roda no processo Next.js, não no worker.** `dispatchAutoMessage` ramifica em
   `process.env.SOLINT_WORKER === '1'` (`auto-reply.ts:81`): fora do worker chama
   `channel.sendText` direto; se o ambiente estiver com `QueueChannel` e o worker parado,
   cai no `catch` do item 4.

> **Roteiro de diagnóstico, a executar antes de codar:** §3, Etapa 0.

### 1.3.5 Lacuna correlata: nenhuma visibilidade de falha de mensagem automática

Nenhuma das quatro mensagens automáticas (saudação, ausência, encerramento, espera) nem a
pesquisa de CSAT reporta falha de entrega para a interface. `deliveryStatus` existe na
tabela `Message`, mas `dispatchAutoMessage` grava `null`. É isso que torna o sintoma
"finalizei e não foi enviada" impossível de diagnosticar pelo próprio usuário.

---

## 1.4 Mensagens rápidas e variáveis dinâmicas

### 1.4.1 🔴 As variáveis não funcionam

O bloco "Variáveis dinâmicas" da tela de nova mensagem rápida está em
`src/features/configuracoes/components/sections/canned-responses-section.tsx:29-32`:

```ts
{ tag: '{{cliente.nome}}', label: 'Nome do cliente' },
{ tag: '{{agente.nome}}',  label: 'Nome do atendente' },
{ tag: '{{empresa}}',      label: 'Nome da empresa' },
{ tag: '{{protocolo}}',    label: 'Número de protocolo' },
```

Isso é a **lista inteira de ocorrências no projeto**. Um `grep` por `cliente.nome` fora
desse arquivo não retorna nada: não existe função de interpolação, nem no cliente nem no
servidor.

O que acontece hoje ao usar uma resposta rápida:

```
composer.tsx:247-250
  const applyCanned = (response: CannedResponse) => {
    handleTextChange(response.content);   // texto cru, sem substituição
    textareaRef.current?.focus();
  };
```

→ O agente insere a resposta e o cliente recebe literalmente
`Olá {{cliente.nome}}, aqui é {{agente.nome}}`.

**Agravante:** `sendMessageAction` (`conversas/actions.ts:93-116`) também não interpola. A
mensagem é gravada e despachada exatamente como digitada. Não há rede de segurança.

### 1.4.2 O que é `{{protocolo}}`

O conceito **existe no banco** e é gerado, mas nunca foi documentado nem exposto:

- **Tipo:** `Protocol { code: string; date: string; status: 'Resolvido' | 'Pendente' | 'Em andamento' }`
  (`src/core/domain/conversation.ts:41-45`).
- **Coluna:** `Conversation.protocols Json @default("[]")`.
- **Geração:** no nascimento da conversa vinda do WhatsApp, em dois pontos —
  `wa-store.ts:395-401` e `wa-store.ts:627-633`:
  ```ts
  code: `#AT-${Math.floor(10000 + Math.random() * 90000)}`,
  date: dataCurtaLabel(at),
  status: 'Em andamento',
  ```
- **Exibição:** painel de contexto da conversa, `context-panel.tsx:209-215`.

**Definição para o produto:** o protocolo é o **número de atendimento** — o código que o
cliente cita ao voltar ("é sobre o protocolo #AT-48213"). Uma conversa pode acumular
vários, um por ciclo de atendimento.

**Problemas da implementação atual, que a correção precisa resolver:**

| # | Problema | Consequência |
|---|---|---|
| 1 | Código é `Math.random()` de 5 dígitos, sem unicidade garantida | Colisão em ~1/90.000 por conversa. Numa conta com 300 conversas/dia, colisão esperada em semanas |
| 2 | Só é gerado no caminho do WhatsApp (`wa-store`) | Conversa criada por outro caminho nasce com `protocols: []`, e `{{protocolo}}` não teria valor |
| 3 | `status` nasce `'Em andamento'` e **nunca é atualizado** | Resolver a conversa não fecha o protocolo |
| 4 | Nenhum protocolo novo é aberto na reabertura | Um cliente que volta 3 meses depois continua no protocolo original |
| 5 | `date` é rótulo formatado (`"27 ago."`), não instante | Impossível ordenar ou filtrar por período |

---

## 1.5 Kanban: filtros e taxa de conversão

### 1.5.1 🟡 Filtros — três dos sete estão quebrados

Contrato dos filtros: `BoardFilters` em `kanban-toolbar.tsx:26-34`.
Aplicação: `useBoard` → `filteredDeals` em `kanban/hooks/use-board.ts:83-119`.

| Filtro | UI | Lógica | Estado | Diagnóstico |
|---|---|---|---|---|
| `searchQuery` | ✅ | ✅ `:85-92` | 🟡 **parcial** | Busca em `title`, `contactName`, `company`, `nextAction`. Mas `deal.title` **nunca existe**, então esse critério é morto |
| `owner` | ✅ | ✅ `:95` | 🟢 funciona | Compara `deal.ownerName`, coluna real |
| `team` | ✅ | ✅ `:98` | 🔴 **inerte** | `deal.team` **não existe no banco** |
| `source` | ✅ | ✅ `:101` | 🔴 **inerte** | `deal.source` **não existe no banco** |
| `priority` | ✅ | ✅ `:104` | 🟢 funciona | Coluna real |
| `valueRange` | ✅ | ✅ `:107-113` | 🟢 funciona | Faixas em centavos |
| **`period`** | ✅ `PERIOD_OPTIONS` `:46-52` | ❌ **inexistente** | 🔴 **não faz nada** | Não há bloco `if (filters.period)` em `filteredDeals`. Selecionar "Criados Hoje" **não altera o quadro** |

**Causa raiz de `team`, `source` e `title`:** a interface `Deal`
(`src/core/domain/pipeline.ts:131-155`) declara `title?`, `source?`, `team?`, `tags?` e
`expectedCloseDate?` — mas o **modelo Prisma `Deal` não tem essas colunas**
(`schema.prisma:459-487`: só `contactName, company, amountInCents, ownerName, priority,
enteredStageAt, stageAgeLabel, nextAction, conversationId, history`). Confirmando pelo
mapeador, `dealRow` (`mappers.ts:330-355`) **não emite nenhum desses campos**. São
propriedades opcionais que nunca são preenchidas, e o TypeScript não acusa porque são `?`.

Efeito colateral visível: a lista de opções do filtro de Equipe é derivada dos próprios
cards (`use-board.ts:76-82`, um `Set` de `d.team`) → **o `<select>` de Equipe aparece sempre
vazio**. O de Responsável só tem valor porque `ownerName` é coluna real.

> **Resposta direta:** os filtros **não estão 100%**. Responsável, Prioridade e Faixa de
> valor funcionam. Período está declarado e não aplicado. Equipe e Origem filtram por
> campos que o banco nunca preenche. A busca textual funciona parcialmente.

### 1.5.2 🔴 Taxa de conversão inicia em 25%

```
src/core/domain/pipeline.ts:211
  const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 25;
                                                                                       ^^
```

`closedCount` só conta cards em etapa com `isWon` ou `isLost`. Num funil novo, sem nenhum
negócio fechado, o denominador é zero e a função devolve o literal **25**. O cartão do
Kanban exibe `25% est.` (`kanban-metrics-strip.tsx:103`), sugerindo um desempenho que
nunca foi medido.

Além do valor inicial, a fórmula atual tem duas limitações estruturais:

1. É **binária**: um card só contribui se estiver numa etapa marcada `isWon` ou `isLost`.
   Todo o meio do funil é invisível para o indicador.
2. Não há como um estágio intermediário representar conversão parcial — que é exatamente
   o que a mudança pedida requer para "Em Negociação".

---

## 1.6 Sincronização de contatos do WhatsApp

### Sintoma

Alguns contatos chegam na coluna **"Nome / Identificação"** como `+55∙∙∙∙∙∙∙∙01`, com o
caractere `∙` (U+2219, *bullet operator*), às vezes repetido em duas linhas.

### Diagnóstico

O caractere `∙` **não existe no código-fonte** (`grep -rn "∙" src/` → zero ocorrências).
Ele vem de fora: é o **número mascarado que o próprio WhatsApp entrega**, resultado das
mudanças de privacidade que ocultam parte do telefone de participantes não salvos
(Comunidades, grupos grandes, contatos por LID).

Caminho da contaminação — `src/infrastructure/whatsapp/worker/session.ts`:

```
:1204-1206   const addressBookName = contact.name?.trim();
             const pushName = contact.notify?.trim() || contact.verifiedName?.trim();
             const resolvedName = addressBookName || pushName || PhoneNumber.format(phone) || phone;
:1230        const daAgenda = Boolean(addressBookName) || conversasDiretas.has(phoneDigits);
:1231        if (!daAgenda) continue;
```

O mesmo par aparece no caminho em tempo real, `handleContactSync` (`:1046-1048`, `:1065-1077`).

O código **confia cegamente** em `contact.name` e `contact.notify`. Quando o WhatsApp manda
`name: "+55∙∙∙∙∙∙∙∙01"`:

1. `addressBookName` recebe a string mascarada;
2. `daAgenda` vira `true` — o contato é **importado**, quando na verdade não está na agenda
   (o mascaramento é justamente o sinal de que *não* é conhecido);
3. `resolvedName` vira a máscara, e é isso que é gravado em `Contact.name`;
4. Na tabela, a coluna de identificação renderiza `contact.name`
   (`contacts-explorer.tsx:913-915`) e a coluna ao lado renderiza
   `PhoneNumber.format(contact.phone)` (`:946`) — daí a impressão de **duas linhas iguais**.

Agravante em `handleContactSync:1065-1067`: a condição de atualização é
`existing.name.startsWith('+')`. Um contato cujo nome legítimo já era o telefone formatado
(`"+55 79 99999-0000"`) **também** começa com `+`, então uma máscara futura sobrescreve um
nome bom.

**Riscos secundários no mesmo caminho:**

- Nenhuma normalização Unicode: `∙` (U+2219), `•` (U+2022), `·` (U+00B7) e `*` são todos
  usados por WhatsApp e aparelhos diferentes.
- `phoneFromJid` (`wa-identity.ts:44-48`) exige `^\d{8,15}$`, então o **telefone** em si
  está protegido. O vazamento é só no **nome**.
- `daAgenda` usar `Boolean(addressBookName)` sem qualificar o valor faz o contador de
  contatos importados inflar. O comentário em `:1211-1229` documenta o caso dos "500
  contatos que viraram 2000" — este é o mesmo problema, por outra porta.

---

## 1.7 Quadro-resumo do diagnóstico

| # | Funcionalidade | Banco | Backend | UI | Veredito |
|---|---|:--:|:--:|:--:|---|
| 1 | Notificação de conversa atribuída | 🟢 | 🔴 | 🟢 | **Não funciona** — falta o produtor |
| 2 | Menções `@` em notas internas | 🔴 | 🔴 | 🔴 | **Não existe** |
| 3 | Aviso de SLA esgotando | 🟢 | 🔴 | 🟢 | **Não funciona** — colunas nunca escritas |
| 4 | 2FA | 🟡 (flag só) | 🔴 | 🔴 mock | **Não funciona** — e a tela afirma o contrário |
| 5 | Sessões ativas | 🟢 (`AuthSession`) | 🟡 | 🔴 lê fonte fictícia | **Não funciona como anunciado** |
| 7 | "Sair de todas as sessões" | 🟢 | 🟢 pronta e órfã | 🔴 `planned()` | **Desabilitado de propósito**; falta só ligar |
| 8 | Tempo de 1ª resposta | 🟢 | 🟢 | 🟢 | **Funciona** |
| 9 | Tempo de resolução | 🟢 | 🟢 | 🟢 | **Funciona** |
| 10 | Cálculo do CSAT | 🟢 | 🟢 | 🟢 | **Funciona**, quando há notas |
| 11 | Disparo da pesquisa CSAT | 🟢 | 🟢 | 🟡 | **Código correto**; provável `csatEnabled = false` + falha silenciosa |
| 12 | Variáveis `{{...}}` | — | 🔴 | 🟢 texto | **Não funciona** — sem interpolador |
| 13 | `{{protocolo}}` | 🟡 | 🟡 | 🟡 | Gerado, mas frágil e nunca atualizado |
| 14 | Filtros do Kanban | 🟡 | 🟡 | 🟢 | **3 de 7 quebrados** (período, equipe, origem) |
| 15 | Taxa de conversão | — | 🔴 | 🟢 | **Bug**: literal `25` quando não há fechados |
| 16 | Sync de contatos WhatsApp | 🟢 | 🔴 | 🟢 | **Bug**: aceita nome mascarado como nome de agenda |
| 17 | Troca de workspace | 🟢 | 🔴 | 🔴 cosmética | **Não funciona** (§2.A) |
| 18 | Log de auditoria | 🟢 tabela | 🔴 sem escrita | 🟡 lista de *seed* | **Não funciona** |
| 19 | Método de distribuição (`assignmentMethod`) | 🟢 | 🔴 nunca aplicado | 🟢 | **Decorativo** (§2.C) |

---

# 2. Especificação das mudanças

---

## A. Multi-tenancy: criação e troca de workspace

### A.1 Estado atual

**O que já existe e está correto:**

| Peça | Onde | Observação |
|---|---|---|
| Modelo multi-tenant | `Account` ↔ `Membership` ↔ `User` | `Membership` já guarda papel, disponibilidade e *overrides* **por conta** (`schema.prisma:147-179`). O desenho está certo |
| `email` global e único | `User.email @unique` | A mesma pessoa em dois workspaces é **um** `User` |
| Lista de workspaces da pessoa | `readSession` já consulta `membership.findMany({ where: { userId } })` (`session.ts:143-147`) e devolve em `session.availableAccounts` | Marcado `// tenant-ok`: exceção deliberada e documentada |
| Conta ativa no token | `SessionClaims.act` (`tokens.ts:23`), assinada no JWT | É o *tenant* de toda a requisição |
| Isolamento | Toda consulta é escopada por `accountId`; há verificador (`npm run check:tenant`) | |
| Receita de provisionamento | `signupAction` (`src/app/(auth)/actions.ts:148-270`) já cria, numa transação: `Account` + `Role[]` de sistema + `User` + `Membership` + `AccountSettings` + `Inbox` padrão + `Pipeline` + `PipelineStage[]` | **É o molde a reaproveitar** |

**O que falta:**

| Peça | Estado |
|---|---|
| Server Action de **troca** de workspace | 🔴 não existe |
| Server Action de **criação** de workspace | 🔴 não existe (só via cadastro de conta nova) |
| `WorkspaceSwitcher` funcional | 🔴 **puramente cosmético** — `workspace-switcher.tsx:24, 55-58`: o clique só faz `setSelected(account)` em estado local. Nada é enviado ao servidor; a tela inteira continua na conta anterior |
| Botão "Alternar" no perfil | 🔴 `planned('Trocar para este workspace')` (`profile-view.tsx:487`) |
| Entrada de "criar workspace" | 🔴 inexistente na UI |
| Permissão para criar workspace | 🔴 não existe em `PERMISSIONS` (`user.ts:5+`) |

### A.2 Decisão de arquitetura: como a troca acontece

Três desenhos possíveis. **Escolha: opção 2.**

| Opção | Como | Prós | Contras |
|---|---|---|---|
| 1. `accountId` na URL (`/w/[accountId]/conversas`) | Rotas aninhadas | Explícito, *deep-linkable*, duas abas em contas diferentes | Reescreve **todas** as rotas do App Router e todos os `Link`. Semanas de trabalho |
| **2. Re-assinar o JWT mantendo a mesma `AuthSession`** ✅ | Server Action gera token com `act` diferente e o mesmo `jti` | Superfície mínima; `readSession` já lê `act`; a sessão continua a mesma na lista de sessões e no "sair de todas" | Duas abas compartilham a conta ativa. Aceitável: é como Slack e Notion desktop se comportam |
| 3. Cookie separado `solint_account` | Cookie extra | Simples | **Inseguro**: o *tenant* deixaria de ser assinado; trocar o cookie daria acesso a qualquer conta. **Rejeitado** |

**Por que manter o mesmo `jti`:** `AuthSession` é do **usuário**, não da conta
(`schema.prisma:180-195`: só tem `userId`). Emitir novo `jti` a cada troca inflaria a lista
de sessões ativas e faria "encerrar sessão" derrubar apenas um workspace — comportamento
errado. Mantendo o `jti`, a revogação continua sendo do acesso da pessoa, como deve ser.

**Segurança obrigatória:** a action **precisa** reconferir a `Membership` no servidor antes
de assinar. O `accountId` vem do cliente e não pode ser confiado.

### A.3 Fluxo de troca de workspace

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Topbar → WorkspaceSwitcher (dropdown)                                      │
│   • lista session.availableAccounts                                        │
│   • marca a ativa com Check                                                │
│   • rodapé: [ + Criar novo workspace ]  ← só se pode criar                 │
└───────────────────────────┬────────────────────────────────────────────────┘
                            │ clique em outra conta
                            ▼
              switchWorkspaceAction({ accountId })          [Server Action]
                            │
        ┌───────────────────┴────────────────────┐
        │ 1. readSession() → quem é o usuário    │
        │ 2. membership.findUnique(userId,       │  ← autorização real
        │      accountId); se não achar: erro    │
        │ 3. signSessionToken({ sub, jti (o      │  ← MESMO jti
        │      mesmo), act: accountId })         │
        │ 4. cookies().set(SESSION_COOKIE, ...)  │
        │ 5. writeAuditLog('workspace.trocado')  │
        │ 6. revalidatePath('/', 'layout')       │
        └───────────────────┬────────────────────┘
                            ▼
              redirect(landingRouteFor(permissões da NOVA conta))
                            │
                            ▼
      Todas as telas recarregam com session.account trocada.
      Não há estado de cliente a limpar: caixa de entrada, kanban,
      contatos e configurações são Server Components escopados por
      session.account.id — o próprio re-render resolve.
```

**Ponto de atenção crítico — SSE.** As conexões de tempo real
(`/api/conversas/events`, `/api/whatsapp/events`, `/api/inboxes/[id]/whatsapp/events`) são
abertas com a conta antiga. Como `redirect()` provoca navegação completa, os `EventSource`
são destruídos e reabertos. **Ainda assim é preciso verificar** que
`src/features/realtime/conversation-events.tsx` não mantém a conexão viva entre navegações:
se usar `useEffect` sem dependência de `accountId`, adicionar `session.account.id` como
dependência ou como `key`.

### A.4 Fluxo de criação de workspace

```
Dropdown → "+ Criar novo workspace"
   └─► Modal CreateWorkspaceModal
         ├─ Nome do workspace        (obrigatório, 2–60 caracteres)
         ├─ CNPJ / documento         (opcional)
         └─ [Criar e entrar]
              │
              ▼
        createWorkspaceAction({ name, document? })      [Server Action]
              │
   ┌──────────┴───────────────────────────────────────────────┐
   │ 1. session = readSession()                               │
   │ 2. GUARDA DE QUOTA: contar memberships do usuário com    │
   │    roleSlug='administrador'. Se ≥ MAX_WORKSPACES → erro  │
   │ 3. prisma.$transaction, reaproveitando o molde de        │
   │    signupAction (actions.ts:165-270):                    │
   │      • Account   (plan: 'starter')                       │
   │      • Role[]    (SYSTEM_ROLES: administrador + colab.)  │
   │      • Membership (userId atual, roleSlug administrador) │
   │      • AccountSettings (billing padrão)                  │
   │      • Inbox padrão ("WhatsApp Principal")               │
   │      • Pipeline + PipelineStage[] padrão                 │
   │        ← já com conversionWeight (§2.B)                  │
   │ 4. writeAuditLog('workspace.criado')                     │
   │ 5. switchWorkspaceAction(novoAccountId)  (reaproveita)   │
   └──────────┬───────────────────────────────────────────────┘
              ▼
        redirect('/configuracoes?secao=caixas')
        (cai direto onde ele precisa parear o WhatsApp)
```

> **Refatoração exigida:** extrair o corpo da transação de `signupAction` para
> `src/core/use-cases/provision-account.ts`, chamado pelos **dois** caminhos. Duplicar 100
> linhas de provisionamento garante que os dois divirjam na primeira etapa de funil nova.

### A.5 Quem pode criar um workspace

O sistema **não** tem hoje uma permissão para isso. Duas alternativas:

| Alternativa | Regra | Recomendação |
|---|---|---|
| **A — sem permissão nova** | Qualquer usuário autenticado pode criar; ele vira `administrador` do que criou | ✅ **Recomendada.** É o que o cadastro público já permite (basta criar outra conta com outro e-mail). Não adiciona superfície de permissão |
| B — permissão `conta:criar` | Nova entrada em `PERMISSIONS`, no padrão do `administrador` | Mais controle, mas exige migração dos papéis existentes de todas as contas |

Com a alternativa A, a **quota** é o freio: constante `MAX_WORKSPACES_POR_USUARIO`
(sugestão: **5**), conferida no servidor. Sem ela, um formulário aberto cria contas
indefinidamente.

O texto que hoje promete a funcionalidade ("o dono da conta pode criar um novo workspace")
deve ser revisto para casar com a regra escolhida.

### A.6 Inventário de mudanças — Workspaces

| Arquivo | Ação |
|---|---|
| `src/app/(workspace)/workspaces/actions.ts` | **novo** — `switchWorkspaceAction`, `createWorkspaceAction` |
| `src/core/use-cases/provision-account.ts` | **novo** — molde de provisionamento extraído de `signupAction` |
| `src/app/(auth)/actions.ts` | editar — `signupAction` passa a chamar `provisionAccount` |
| `src/components/layout/workspace-switcher.tsx` | reescrever — `useTransition` + action; item "criar"; estado de carregamento; remover `useState(selected)` |
| `src/features/configuracoes/components/create-workspace-modal.tsx` | **novo** |
| `src/features/perfil/components/profile-view.tsx:487` | editar — trocar `planned()` pela action |
| `src/infrastructure/auth/session.ts` | editar — expor `reissueSessionToken(userId, jti, accountId)` |
| `src/core/domain/user.ts` | editar — constante `MAX_WORKSPACES_POR_USUARIO` |
| `src/infrastructure/audit/*` | usar (§2.D) |

**Sem migração de banco.** O modelo já suporta N contas por pessoa.

---

## B. Taxa de conversão do funil

### B.1 Regra de negócio nova

1. A taxa **começa em 0%**. Nunca há valor de exemplo.
2. Cada `PipelineStage` ganha um **peso de conversão** (`conversionWeight`), de 0 a 100,
   editável pelo usuário ao criar ou editar a etapa.
3. Um card parado numa etapa contribui com o peso **daquela** etapa.
4. Padrões ao criar um funil:
   - `"Fechado Ganho"` (etapa com `isWon = true`) → **100**
   - `"Em Negociação"` / `"Negociação"` → **50** (a confirmar, §6.1 D1)
   - todas as demais → **0**
5. Etapa de perda (`isLost`) permanece em **0** e não é editável para valor maior.

### B.2 Fórmula

Substituir `calculatePipelineSummary` (`src/core/domain/pipeline.ts:172-220`):

```
taxaDeConversao = ( Σ conversionWeight(etapa(card)) ) / ( 100 × totalDeCards ) × 100
```

Ou seja: a **média dos pesos** das etapas em que os cards estão.

| Situação | Resultado | Verificação |
|---|---|---|
| Funil vazio (0 cards) | **0%** | Substitui o literal `25`; divisão por zero devolve 0 |
| 4 cards, todos em "Novo Lead" (peso 0) | **0%** | ✅ atende ao pedido |
| 4 cards: 2 em "Novo Lead" (0), 2 em "Fechado Ganho" (100) | **50%** | (0+0+100+100)/400 |
| 2 cards em "Em Negociação" (50) | **50%** | Etapa intermediária passa a contribuir |
| Todos em "Fechado Ganho" | **100%** | |

**Consequência importante:** o número deixa de ser "taxa de fechamento histórica" e passa a
ser **"maturidade ponderada do funil"** — que é exatamente o que o pedido descreve
(*"acrescida quando uma etapa é setada pra sinalizar essa conversão"*). O rótulo do cartão
deve mudar de `"Taxa de Conversão ... est."` para algo honesto, por exemplo
**"Conversão ponderada"**, com *tooltip* explicando a regra.

**Compatibilidade:** os campos `inNegotiationCount`, `inNegotiationValueInCents`,
`totalDeals` e `totalValueInCents` de `PipelineSummary` não mudam. Só `conversionRate` muda
de semântica.

### B.3 Mudanças técnicas

**Banco** — migração `kanban_peso_de_conversao`:

```prisma
model PipelineStage {
  // ...
  /// Quanto esta etapa representa de conversão, de 0 a 100.
  ///
  /// É o que substituiu a taxa binária (ganho/perdido), que ignorava todo o
  /// meio do funil e devolvia um literal 25% quando não havia nada fechado.
  /// "Fechado Ganho" nasce em 100; as demais em 0, e o usuário ajusta.
  conversionWeight Int @default(0)
}
```

*Backfill* na mesma migração:

```sql
UPDATE "PipelineStage" SET "conversionWeight" = 100 WHERE "isWon" = true;
-- Etapas de negociação existentes, por nome (heurística única, só na migração):
UPDATE "PipelineStage" SET "conversionWeight" = 50
 WHERE "isWon" = false AND "isLost" = false
   AND lower("name") LIKE '%negocia%';
```

**Domínio** — `src/core/domain/pipeline.ts`:
- `PipelineStage` ganha `readonly conversionWeight: number`
- `calculatePipelineSummary` reescrita conforme §B.2
- Constantes: `DEFAULT_WON_WEIGHT = 100`, `DEFAULT_NEGOTIATION_WEIGHT = 50`

**Mapeador** — `mappers.ts:300-309` (o `stages.map`): emitir `conversionWeight`.

**Provisionamento** — `provision-account.ts` (§A.4) e `seed/pipelines.ts`: gravar os pesos
padrão nas etapas criadas.

**UI de edição** — `src/features/kanban/components/stages-modal.tsx`:
- acrescentar ao estado local o campo `conversionWeight: number` (`:38-57`)
- `<input type="number" min={0} max={100} step={5}>` por linha de etapa, com sufixo `%`
- rótulo: *"Conversão que esta etapa representa"*, com auxílio:
  *"Um card nesta etapa conta como X% de conversão no indicador do funil."*
- ao marcar `isWon`, sugerir 100 automaticamente (se o campo ainda estiver em 0)
- ao marcar `isLost`, forçar 0 e desabilitar o campo

**Server Action** — `updateStagesAction` (`kanban/actions.ts:194-207`): adicionar ao Zod
`conversionWeight: z.number().int().min(0).max(100).default(0)`.

**Repositório** — `pipeline-repository.updateStages`: propagar a coluna.

**Exibição** — `kanban-metrics-strip.tsx:95-107`: novo rótulo + `InfoTooltip` com a fórmula.

**Colateral** — `analytics-repository.ts:376-390` calcula uma `conversionRate` **própria**,
por etapa, para o cartão de funil do dashboard (`funnel-summary-card.tsx:84-90`). Essa é
outra métrica (taxa de passagem entre etapas) e **não deve ser alterada** — apenas verificar
que o rótulo não induz confusão com a nova.

---

## C. Distribuição de conversas: simplificação

### C.1 O que sai

Tudo em `src/features/configuracoes/components/sections/automations-section.tsx`:

| Item | Linhas | Ação |
|---|---|---|
| Sub-aba **"Distribuição"** (`atribuicao`) inteira | `:57` (`AUTO_TABS`), `:423-575` (render) | **remover** |
| Título "Quem atende cada conversa nova" + os 3 cartões de método | `:426-490` | **remover** |
| Cartão "Ajustes da distribuição" (online, limite, devolver, tempo) | `:495-570` | **remover** |
| Sub-aba **"Ações em 1 clique"** (`macros`) | `:58`, `:585-700+` | **remover** |
| Tipo `AutoSubTab` | `:53` | reduzir a `'regras'`, ou eliminar as sub-abas se sobrar uma só |

**Estados locais que ficam órfãos** (nunca eram persistidos — eram `useState` puro):
`onlyOnlineAgents`, `agentConcurrencyLimit`, `autoReassignUnanswered`, `reassignMinutes`.
Remover todos.

**Backend correlato.** `assignmentMethod` é lido do banco e **nunca aplicado a nenhuma
conversa** (confirmado por `grep`: gravado em `settings-repository.ts:319`, lido em `:215`,
sem consumidor). Portanto:

| Alvo | Ação |
|---|---|
| `setAssignmentMethodAction` (`configuracoes/actions.ts:112`) | remover |
| `AssignmentMethod`, `ASSIGNMENT_METHOD_LABELS` (`core/domain/settings.ts:17, 27-28`) | remover |
| `SettingsSnapshot.assignmentMethod` (`ports/settings-repository.ts:26`) | remover |
| Leitura em `settings-repository.ts:215` e escrita em `:319` | remover |
| Coluna `AccountSettings.assignmentMethod` | **manter no banco por ora** (`@default("round_robin")`, ninguém lê). Remover numa migração de limpeza posterior, para não acoplar esta entrega a um `DROP COLUMN` |
| `seed/settings.ts:118` | remover a chave |

**Macros:** a sub-aba sai da UI, mas a tabela `Macro` e o tipo `MacroAction` **permanecem**
no banco e no domínio (podem voltar). Só o ponto de entrada some. Registrar isso com um
comentário no código, para não parecer resíduo esquecido.

### C.2 O que entra: caixa comum + posse pelo primeiro atendimento

**Regra:**

> Toda conversa nova nasce **sem responsável** e visível para todos que alcançam a caixa.
> O **primeiro agente que responder** (mensagem pública, não nota interna) torna-se o
> responsável automaticamente.

**Estado atual, bom ponto de partida:** conversas do WhatsApp já nascem sem responsável —
`wa-store.ts:385-392` não grava `assigneeId`, e o painel já conta "Sem responsável"
(`analytics-repository.ts:230`). O acesso já é por equipe/caixa (`resolveInboxAccess`,
`session.ts:255+`). **Nada precisa mudar na entrada.**

**O que falta é a posse automática.** Onde implementar:

```
src/infrastructure/repositories/prisma/conversation-repository.ts
  persistMessage(...)   ← :110-200, o único ponto por onde toda mensagem passa
```

É o mesmo lugar onde `firstResponseAt` já é carimbado (`:154-171`), com condições quase
idênticas. Acrescentar à mesma leitura e à mesma transação:

```ts
// Já lido em `exists`: adicionar assigneeId ao select de :115-123.
const assumirConversa =
  message.author === 'agent' &&
  !message.isPrivate &&
  !exists.assigneeId &&
  Boolean(message.authorId);      // ← ver nota abaixo

// ... dentro do prisma.$transaction, no mesmo conversation.update de :189-198:
...(assumirConversa
  ? { assigneeId: message.authorId, assigneeName: message.authorName }
  : {}),
```

**Nota / dependência:** `Message` hoje guarda `authorName` (texto) mas **não** o id do
usuário. Duas saídas:

| Opção | Custo | Recomendação |
|---|---|---|
| Passar o `Session` (ou `userId`) até `persistMessage` como parâmetro | Mudança de assinatura em `appendMessage`/`sendMessage` | ✅ **Recomendada** — não altera o schema, e o `userId` já está disponível no caso de uso |
| Adicionar `Message.authorId` no schema | Migração + *backfill* | Útil no futuro (auditoria por mensagem), mas não necessário agora |

> A coluna `authorId` **se torna necessária** para a auditoria de "quem enviou cada
> mensagem" (§2.D). Avaliar fazer as duas juntas — §4.

**Concorrência.** Dois agentes respondendo ao mesmo tempo: a escrita é
`UPDATE ... WHERE id = ? AND accountId = ?` dentro de transação, e o segundo `UPDATE`
sobrescreveria o primeiro. Blindagem: aplicar a atribuição por `updateMany` com a condição
`assigneeId: null` no `where`. Só a primeira transação encontra a linha e vence; a segunda
não altera nada. É a mesma técnica de *compare-and-swap* já usada em outros pontos do
repositório.

**Efeito colateral desejável:** essa atribuição é exatamente o gatilho da notificação
`kind: 'atribuicao'` (§2.E) — mas **não** deve notificar quem se auto-atribuiu ao responder.
A notificação só sai quando `assignConversationAction` atribui a **outra** pessoa.

**Notificar a equipe (recomendado).** Ao assumir, emitir no `waEventBus` um
`conversation_updated`; os outros agentes com a tela aberta veem o responsável aparecer em
tempo real e param de digitar. O evento **já é emitido** em `broadcast()`
(`conversas/actions.ts:400-413`) — basta garantir que também saia por este caminho.

### C.3 Texto na tela

A sub-aba de distribuição some. Onde houver texto explicando o comportamento (base de
conhecimento em `seed/knowledge.ts`, ajuda contextual da caixa de entrada), atualizar para:

> *"Toda conversa nova cai na caixa de entrada e fica visível para toda a equipe que alcança
> aquela caixa. Quem responder primeiro assume o atendimento."*

---

## D. Auditoria e logs de segurança

### D.1 Estado atual

- Tabela pronta e bem modelada: `AuditLogEntry` (`schema.prisma:874-892`) —
  `accountId, actorId, actorName, action, targetType, targetId?, targetName?, ip?,
  userAgent?, metadata Json, createdAt`, com `@@index([accountId, createdAt])`.
- Leitura pronta: `settings-repository.ts:178-182` (`take: 50`, ordem decrescente) e
  projeção para o domínio em `:270-277`.
- Renderização pronta: `security-section.tsx:308-345`.
- **Escrita: zero.** `grep -rn "auditLogEntry" src/` retorna **uma** linha, a de leitura.
  Tudo que a tela mostra vem de `seed/settings.ts:252+`.

### D.2 Catálogo de eventos a registrar

Análise das ações do sistema, classificadas por relevância para auditoria:

#### Grupo 1 — Atendimento (volume alto, exige filtro forte)

| Ação | `action` | `targetType` | Onde instrumentar |
|---|---|---|---|
| Assumiu conversa (auto, ao responder) | `conversa.assumida` | `conversa` | `conversation-repository.persistMessage` (§C.2) |
| Atribuiu conversa a outra pessoa | `conversa.atribuida` | `conversa` | `assignConversationAction` (`conversas/actions.ts:422`) |
| Devolveu para a fila | `conversa.liberada` | `conversa` | idem, quando `assignee === null` |
| Resolveu / reabriu | `conversa.status` | `conversa` | `changeConversationStatusAction:301` |
| Moveu entre caixas | `conversa.movida` | `conversa` | `moveConversationInbox` |
| **Enviou mensagem** | `mensagem.enviada` | `mensagem` | `sendMessageAction:93` |
| Apagou mensagem | `mensagem.apagada` | `mensagem` | `deleteMessageAction` |
| Mudou prioridade | `conversa.prioridade` | `conversa` | `changeConversationPriorityAction:454` |

#### Grupo 2 — Ações administrativas (volume baixo, alto valor)

| Ação | `action` |
|---|---|
| Convidou / removeu membro | `membro.convidado`, `membro.removido` |
| Alterou papel ou permissões individuais | `membro.papel`, `membro.permissoes` |
| Criou / editou / **excluiu** papel | `papel.*` |
| Criou / editou / **excluiu caixa de entrada** | `caixa.*` (a exclusão apaga conversas e mensagens: **crítica**) |
| Conectou / desconectou WhatsApp | `whatsapp.conectado`, `whatsapp.desconectado` |
| Alterou horário de atendimento, mensagens automáticas ou CSAT | `caixa.configurada` |
| Alterou perfil da empresa | `empresa.alterada` |
| Criou / editou / excluiu etapa do funil | `funil.etapas` |
| Criou / excluiu automação | `automacao.*` |
| **Criou workspace / trocou de workspace** | `workspace.criado`, `workspace.trocado` |

#### Grupo 3 — Segurança e sessão (volume baixo, altíssimo valor)

| Ação | `action` |
|---|---|
| Login bem-sucedido | `sessao.login` |
| **Login recusado** (senha errada) | `sessao.login_falhou` |
| Logout | `sessao.logout` |
| Encerrou uma sessão / **todas** | `sessao.encerrada`, `sessao.encerrada_todas` |
| Alterou a própria senha | `senha.alterada` |
| Ativou / desativou 2FA | `2fa.*` |

#### Grupo 4 — Dados sensíveis saindo da conta

| Ação | `action` |
|---|---|
| **Exportou contatos em CSV** | `contatos.exportados` (registrar a **quantidade** no `metadata`) |
| Exportou relatório | `relatorio.exportado` |
| Importou contatos | `contatos.importados` |
| Disparou campanha em massa | `campanha.disparada` |
| Excluiu contatos em massa | `contatos.excluidos` |

> **Ações urgentes/críticas** (destaque visual e filtro dedicado "Somente críticas"):
> exclusão de caixa de entrada, exclusão de papel, alteração de permissões, exportação de
> contatos, login recusado (3 ou mais seguidos), desconexão de WhatsApp, exclusão em massa,
> `sessao.encerrada_todas`.

### D.3 O problema do volume, e a solução do filtro

`mensagem.enviada` é, de longe, o evento mais frequente. Uma conta com 5 agentes e 300
conversas/dia gera cerca de 2.000 linhas/dia só desse tipo. Sem tratamento, o painel vira a
"pilha de mensagens de conversas diferentes" que o pedido quer evitar.

**Quatro medidas combinadas:**

1. **Agrupamento por conversa (padrão da tela).** A visão padrão colapsa mensagens da mesma
   conversa, do mesmo autor, no mesmo dia, numa linha só:
   > *"Ana Ribeiro enviou **14 mensagens** na conversa com Carlos Menezes · hoje, 09:12–11:40"*

   Expandir mostra os horários. Consulta: `GROUP BY` sobre `targetId` (id da conversa)
   quando `action = 'mensagem.enviada'`.

2. **Filtro obrigatório de conversa.** Para ver mensagem por mensagem é preciso **escolher
   uma conversa** (busca por contato, telefone ou protocolo). Sem esse filtro, a aba de
   mensagens só mostra o agregado.

3. **Metadata enxuta.** `mensagem.enviada` **não guarda o conteúdo da mensagem** — apenas
   `{ conversationId, contactName, contentType, isPrivate, length }`. Guardar o texto
   duplicaria a tabela `Message` e criaria um segundo lugar com dado pessoal do cliente:
   problema de LGPD, não só de espaço.

4. **Retenção de 7 dias** (item seguinte).

### D.4 Política de retenção: 7 dias

Conforme o pedido, TTL curto. Implementação em **duas camadas**:

**Camada 1 — varredura periódica (obrigatória).** Novo runner
`src/infrastructure/scheduling/audit-retention-runner.ts`, no mesmo padrão de
`waiting-message-runner.ts`, executado pelo worker uma vez por dia:

```ts
const CORTE_DIAS = 7;
await prisma.auditLogEntry.deleteMany({
  where: { createdAt: { lt: new Date(Date.now() - CORTE_DIAS * 86_400_000) } },
});
```

> **Sem `accountId` no `where` de propósito:** é manutenção de infraestrutura, não consulta
> de negócio. Marcar com `// tenant-ok:` e a justificativa, no padrão já usado em
> `session.ts:141`, para não quebrar `npm run check:tenant`.

**Camada 2 — janela na leitura (defesa em profundidade).** Toda consulta do painel filtra
`createdAt >= agora − 7 dias`, para que uma falha do runner nunca exponha dados que
deveriam ter expirado.

**Índices necessários** (migração): o índice atual, `@@index([accountId, createdAt])`, é
ótimo para a leitura. A varredura de expurgo parte só de `createdAt`, então acrescentar:

```prisma
@@index([createdAt])                    // expurgo
@@index([accountId, action, createdAt]) // filtro por tipo de ação
```

**Estimativa de volume** (conta média, 5 agentes, 300 conversas/dia): cerca de
2.500 linhas/dia × 7 dias ≈ **17.500 linhas** por conta em regime. Com `metadata` enxuta
(~200 B), aproximadamente 4 MB por conta. Aceitável.

### D.5 Arquitetura do módulo de auditoria

```
src/core/domain/audit.ts                    ← NOVO
   • type AuditAction  (união literal fechada, o catálogo de §D.2)
   • type AuditTargetType = 'conversa' | 'mensagem' | 'contato' | 'membro'
                          | 'papel' | 'caixa' | 'funil' | 'automacao'
                          | 'sessao' | 'workspace' | 'empresa' | 'campanha'
   • AUDIT_ACTION_LABELS   : Record<AuditAction, string>   (pt-BR, para a tela)
   • AUDIT_CRITICAL_ACTIONS: readonly AuditAction[]        (destaque e filtro)
   • AUDIT_RETENTION_DAYS = 7

src/infrastructure/audit/write-audit-log.ts ← NOVO
   • writeAuditLog(input): Promise<void>
       - NUNCA lança: try/catch + console.warn.
         Auditoria que derruba a ação auditada é pior que auditoria ausente.
       - captura ip/userAgent de next/headers quando disponível
       - dispara sem await onde a latência importa (envio de mensagem)

src/infrastructure/repositories/prisma/audit-repository.ts ← NOVO
   • list(accountId, filtros, paginação)
   • listAgrupado(accountId, filtros)   ← agregação de mensagens
   • actorsDoPeriodo(accountId)         ← alimenta o <select> de pessoas

src/app/(workspace)/configuracoes/audit-actions.ts ← NOVO
   • listAuditLogAction(filtros)  — exige 'config.seguranca:ler'
   • exportAuditLogAction()       — CSV; e ela própria vira 'relatorio.exportado'

src/features/configuracoes/components/sections/audit-log-panel.tsx ← NOVO
```

### D.6 UI do painel de auditoria

Substitui a seção 4 atual (`security-section.tsx:308-345`), hoje uma lista corrida de 50
itens.

```
┌─ Registro de auditoria ────────────────────────────────────────────────────┐
│ Ações da equipe nos últimos 7 dias. Registros mais antigos são             │
│ descartados automaticamente.                                              │
├────────────────────────────────────────────────────────────────────────────┤
│ [ Tudo ] [ Atendimento ] [ Administrativas ] [ Segurança ] [ ⚠ Críticas ] │  ← abas
├────────────────────────────────────────────────────────────────────────────┤
│ 🔎 buscar…    👤 Pessoa ▾   🏷 Ação ▾   💬 Conversa ▾   📅 Período ▾  [limpar]│
├────────────────────────────────────────────────────────────────────────────┤
│ hoje                                                                       │
│  11:42  👤 Ana Ribeiro    assumiu a conversa com  Carlos Menezes   #AT-48213│
│  11:40  💬 Ana Ribeiro    enviou 14 mensagens em  Carlos Menezes    [ ▾ ]  │
│  10:15  ⚠️ Marcos Vieira   excluiu a caixa         Suporte Antigo          │
│         └ 412 conversas e 8.930 mensagens apagadas · IP 187.x.x.x          │
│  09:58  🔐 Ana Ribeiro    entrou no sistema        Chrome · Windows        │
│ ontem                                                                      │
│  17:30  📤 Marcos Vieira  exportou 1.204 contatos  CSV                     │
└────────────────────────────────────────────────────────────────────────────┘
                                        [ Exportar CSV ]  [ carregar mais ]
```

**Detalhes de comportamento:**

- **Abas** pré-filtram por grupo (§D.2), resolvendo a "pilha" antes de qualquer clique.
- **Filtro de conversa** é o que destrava a visão mensagem a mensagem (§D.3, medida 2).
  Busca por nome do contato, telefone ou código de protocolo.
- **Agrupamento por dia**, com cabeçalhos "hoje / ontem / dd/mm".
- **Críticas** ganham fundo âmbar ou vermelho, ícone `⚠️` e aba própria.
- **Paginação por cursor** (`createdAt` + `id`), 50 por página. `OFFSET` degrada.
- **Exportar CSV** reaproveita `src/lib/csv.ts`.
- Vazio: *"Nenhuma ação registrada no período."* Nunca dados de exemplo.

### D.7 O que sai da tela de Segurança

**Remover integralmente** a seção 3, "Políticas de acesso e expiração"
(`security-section.tsx:255-303`), incluindo:

- o `<select>` "Expiração automática por inatividade" (estado `sessionTimeout`, `:45`)
- o `<select>` "Renovação periódica de senhas" (estado `enforcePasswordChange`, `:46`)

Justificativa técnica: os dois são `useState` sem persistência **e sem qualquer efeito**.
O TTL real de sessão é a constante `SESSION_TTL_SECONDS = 7 dias`
(`infrastructure/auth/tokens.ts:18`), fixa e não configurável. A tela oferecia uma escolha
que o sistema não honra.

### D.8 2FA e Sessões — decisão de escopo

As duas seções restantes de Segurança são mock (§1.2.1, §1.2.2). São **decisões de produto**,
não correções triviais:

| Item | Custo | Proposta |
|---|---|---|
| **Sessões ativas — trocar a fonte** | 🟢 **Baixo** | **Fazer nesta entrega.** Ler `AuthSession` por `userId` em vez do JSON; derivar "dispositivo" do `userAgent`; marcar a atual comparando `tokenId` com o `jti` do cookie; `terminateSessionAction` passa a gravar `revokedAt`. Aposentar `AccountSettings.activeSessions` |
| **"Sair de todas as sessões"** | 🟢 **Baixo** | **Fazer nesta entrega.** `revokeAllSessions` já existe (§1.2.3) |
| **2FA real (TOTP)** | 🔴 **Alto** | **Fora desta entrega.** Exige biblioteca TOTP, colunas `twoFactorSecret`/`recoveryCodes` cifradas, fluxo de vinculação com QR, etapa extra no login, códigos de recuperação e a política "exigir no workspace". **Ação imediata obrigatória:** trocar o mock por um estado honesto — *badge* neutro "Não configurado", botão "Configurar 2FA" com `planned()`, e remover o *toggle* e o *toast* que afirmam falsamente que a política foi aplicada. Manter uma tela que diz "Ativado na sua conta" sem 2FA nenhum é um risco real |

---

## E. Notificações: os três avisos

### E.1 Infraestrutura comum (pré-requisito dos três)

```
src/infrastructure/notifications/create-notification.ts   ← NOVO
   createNotification({
     accountId, userId?, kind, text, href?, respeitarPreferencia?
   })
     1. se `respeitarPreferencia`, lê User.notificationPrefs e sai se desligada
     2. grava a linha (id no padrão `ntf-<base36>-<rand>`, timeLabel via horaLabel)
     3. emite no waEventBus para o sininho acender sem recarregar
     4. NUNCA lança: try/catch + console.warn
```

**Correção junto:** trocar a escrita de `kind: 'automacao'`
(`automation-effects.ts:178`) por `'sistema'`, que é valor válido de `NotificationKind`.

**Retenção:** notificações também crescem. Adicionar ao mesmo runner de retenção (§D.4) o
expurgo de `Notification` lidas com mais de 30 dias.

### E.2 🔴→🟢 Conversa atribuída

- **Gatilho:** `assignConversationAction` (`conversas/actions.ts:437-446`), após sucesso.
- **Condições:** `assignee !== null` **e** `assignee.id !== session.user.id` (não avisar
  quem atribuiu a si mesmo) **e** `prefs.assigned === true`.
- **Payload:** `kind: 'atribuicao'`, texto *"{quem atribuiu} atribuiu a conversa com
  {contato} a você"*, `href: /conversas?conversa=<id>`.
- **Não notificar** na auto-posse de §C.2: a pessoa acabou de agir, ela sabe.

### E.3 🔴→🟢 Menções `@` em notas internas

Recurso novo, quatro partes:

**1. Autocomplete no composer** (`composer.tsx`).
Reaproveitar integralmente o mecanismo de respostas rápidas, que já existe e funciona
(`:183-190` filtra por prefixo, `:660-690` renderiza a lista, `:247` aplica):

- gatilho: `@` no início de palavra, **apenas quando `isNote === true`**
- fonte: membros da conta (`settings.members`), filtrados por nome
- inserção no cursor (mesma técnica de `inserirEmoji`, `:259-275`)
- formato inserido: `@Nome Sobrenome`

**2. Extração no servidor** (`sendMessageAction`).
Nunca confiar na lista que o cliente mandaria. O servidor recebe o texto, carrega os
membros da conta e casa nomes por *longest-match* (nomes compostos primeiro), devolvendo
`userId[]`.

**3. Persistência.**
`Message.mentions Json @default("[]")` — array de `userId`. Coluna JSON pela regra do topo
do `schema.prisma`: é agregado lido e gravado inteiro com a mensagem, nunca consultado
isoladamente.

**4. Notificação e realce.**
- `kind: 'mencao'`, texto *"{autor} mencionou você em uma nota na conversa com {contato}"*,
  respeitando `prefs.mentions`
- não notificar auto-menção
- na bolha (`message-bubble.tsx:72-77`), destacar `@Nome` com fundo suave, e mais forte
  quando o mencionado é quem está lendo

### E.4 🔴→🟢 Aviso de SLA

**Decisão de escopo — política de SLA.** Não existe configuração de SLA no produto. Duas
alternativas:

| Alternativa | Descrição | Recomendação |
|---|---|---|
| **A — SLA global padrão** | Constantes no domínio: primeira resposta **15 min**, próximas **60 min**, aviso a **80%** do prazo. Sem UI de configuração | ✅ **Recomendada para esta entrega.** Entrega valor imediato sem abrir uma tela nova |
| B — SLA por caixa | Campos novos em `Inbox` + UI em "Caixas de entrada" | Etapa seguinte, natural |

**Só conta tempo dentro do expediente.** `isWithinBusinessHours` já existe
(`core/domain/business-hours.ts`) e é usado pelas mensagens automáticas; a mesma função
calcula o prazo. Sem isso, toda conversa recebida às 18h nasce estourada às 9h do dia
seguinte.

**Cálculo (`src/core/domain/sla.ts`, novo):**

```
slaDeadlineAt = lastInboundAt + minutosDeSLA, avançando apenas em horário útil
slaLabel      = "SLA em 12 min" | "SLA estourado"
slaBreached   = agora > slaDeadlineAt
```

**Escrita:** em `persistMessage` (`conversation-repository.ts`), o mesmo ponto único:
- mensagem do **contato** → calcula e grava `slaDeadlineAt`, limpa `slaBreached`
- mensagem pública do **agente** → limpa os três campos (o relógio parou)

**Varredor** (`src/infrastructure/scheduling/sla-runner.ts`, novo), no padrão de
`waiting-message-runner.ts`, a cada 2 minutos:

1. conversas com `slaDeadlineAt` entre agora e agora+20% do prazo, ainda sem aviso →
   `kind: 'sla'`, *"O prazo de resposta da conversa com {contato} vence em {n} min"*,
   destinada ao responsável (ou à conta inteira, `userId: null`, se não houver)
2. conversas com `slaDeadlineAt < agora` e `slaBreached = false` → marca `slaBreached = true`
   e emite `conversation_updated`; o *badge* vermelho da lista acende sozinho

**Trava de repetição:** um aviso por conversa por ciclo. Como não há coluna para isso, usar
a existência de uma `Notification` com `kind: 'sla'` e `href` daquela conversa criada depois
do último `lastInboundAt` — mesma técnica de `ultimoDisparo`
(`inbox-auto-messages.ts:51-60`), que usa a própria tabela como trava em vez de memória de
processo. O worker reinicia, e memória some junto.

**Ganho colateral:** o filtro "SLA estourado" (`inbox-filters.tsx:374`) e o tom vermelho do
painel de atenção (`analytics-repository.ts:358`) passam a funcionar de verdade.

## F. CSAT: fechar o ciclo

Além do diagnóstico (§1.3.4), o código precisa de **quatro correções** para que "finalizei
um atendimento e não foi enviada a mensagem" deixe de ser possível sem aviso:

**F.1 — Tornar o estado visível na tela.** Em "Caixas de entrada", quando `csatEnabled`
estiver ligado, exibir junto ao *toggle* um resumo do que vai acontecer
(*"Ao resolver uma conversa desta caixa, o cliente recebe: «\<pergunta\>»"*) e, se a caixa
estiver desconectada, um aviso âmbar de que nada sairá.

**F.2 — Feedback ao resolver.** Em `changeConversationStatusAction`, `runClosingAutoReply` é
chamada dentro de `try/catch` que só escreve `console.warn`
(`conversas/actions.ts:317-325`). Passar a devolver um resultado
(`{ csatEnviado: boolean; motivo?: string }`) e mostrar um *toast*:
- ✅ *"Atendimento resolvido. Pesquisa de satisfação enviada."*
- ℹ️ *"Atendimento resolvido. A pesquisa não foi enviada: já perguntamos há menos de 24 h."*
- ⚠️ *"Atendimento resolvido, mas a pesquisa não saiu: a caixa está desconectada."*

**F.3 — Não gravar como enviada uma mensagem que não saiu.** Em `dispatchAutoMessage`
(`auto-reply.ts:118-120`), o `catch` engole a falha depois de a mensagem já estar gravada.
Gravar `deliveryStatus: 'falhou'` no `catch` e renderizar isso na timeline.

**F.4 — Diagnóstico dos dados existentes.** §3, Etapa 0.

**Sem mudança na fórmula do CSAT** — ela está correta (§1.3.3).

---

## G. Variáveis dinâmicas e protocolo

### G.1 Interpolador

```
src/core/domain/message-variables.ts        ← NOVO (puro, sem I/O)

  export interface VariableContext {
    readonly clienteNome?: string;
    readonly agenteNome?: string;
    readonly empresa?: string;
    readonly protocolo?: string;
  }

  export const MESSAGE_VARIABLES = [
    { tag: '{{cliente.nome}}',  label: 'Nome do cliente',     campo: 'clienteNome' },
    { tag: '{{agente.nome}}',   label: 'Nome do atendente',   campo: 'agenteNome'  },
    { tag: '{{empresa}}',       label: 'Nome da empresa',     campo: 'empresa'     },
    { tag: '{{protocolo}}',     label: 'Número de protocolo', campo: 'protocolo'   },
  ] as const;

  export const interpolate = (texto: string, ctx: VariableContext): string
```

Regras:
- tolerante a espaços: `{{ cliente.nome }}` funciona
- **variável sem valor vira string vazia**, nunca a chave crua. O cliente jamais pode
  receber `{{protocolo}}` literal
- variável desconhecida é removida, com `console.warn` no servidor
- puro e sem I/O, para poder ser testado e usado nos dois lados

### G.2 Onde interpolar — duas camadas

| Camada | Onde | Por quê |
|---|---|---|
| **1. Ao inserir (cliente)** | `composer.applyCanned` (`composer.tsx:247`) | O agente **vê** o texto final antes de enviar e pode editá-lo. É o comportamento que a tela promete |
| **2. Ao enviar (servidor)** ✅ obrigatório | `sendMessageAction` (`conversas/actions.ts:112-116`), logo antes de `withSignature` | Rede de segurança: qualquer caminho (agendada, automação, macro, API) fica coberto. **Sem isso, um texto digitado à mão com `{{...}}` chega cru ao cliente** |

Estender também a `dispatchAutoMessage` (mensagens automáticas), `ScheduledMessage`
(mensagens agendadas) e campanhas. Todos os quatro devem aceitar as mesmas variáveis.

**Contexto disponível em cada ponto:**
`clienteNome` ← `conversation.contact.name` · `agenteNome` ← `session.user.name` ·
`empresa` ← `session.account.name` (ou `company.tradeName` de `AccountSettings`, se
preenchido) · `protocolo` ← protocolo **aberto** da conversa (§G.3).

### G.3 Protocolo: corrigir a geração

**Definição para a UI** (auxílio na tela de respostas rápidas):

> *"O número do atendimento, o código que o cliente cita quando volta a falar com você.
> Um novo protocolo é aberto a cada atendimento e fechado quando a conversa é resolvida."*

**Correções:**

| # | Correção | Como |
|---|---|---|
| 1 | Unicidade | Trocar `Math.random()` de 5 dígitos por sequência **por conta e por ano**: `#AT-26-000431`. Requer contador: coluna `Account.protocolSeq Int @default(0)`, incrementada atomicamente (`UPDATE ... SET protocolSeq = protocolSeq + 1 RETURNING`) |
| 2 | Ponto único | Extrair `abrirProtocolo(accountId, conversationId)` para `src/core/use-cases/` e chamá-la nos dois pontos de `wa-store.ts` (`:395`, `:627`) **e** em qualquer outro caminho de criação de conversa |
| 3 | Fechar ao resolver | Em `changeConversationStatusAction`, ao ir para `resolvida`, marcar o protocolo aberto como `'Resolvido'` |
| 4 | Abrir na reabertura | Ao sair de `resolvida` para `aberta`, ou ao chegar mensagem nova em conversa resolvida, abrir um protocolo novo |
| 5 | Data ordenável | Acrescentar `openedAt: string` (ISO) ao tipo `Protocol`, mantendo `date` como rótulo. Sem *backfill*: campo opcional |

`{{protocolo}}` resolve para o **último protocolo com status diferente de `'Resolvido'`**;
sem nenhum, para o mais recente; sem protocolo nenhum, string vazia.

---

## H. Ajustes de UI, UX e tipografia

### H.1 Logotipo da barra lateral

**Estado atual** (`src/components/layout/navigation-rail.tsx:212-223`): um `<Link>` com
gradiente azul, a letra `S` como `<span>` e, quando expandida, o texto *"Solint CRM"*.
Nunca usa os arquivos de marca.

**Assets:**

| Arquivo | Dimensões | Peso | Uso hoje |
|---|---|---|---|
| `public/favicon.png` | 5000 × 5000 RGB | **1,4 MB** | Metadata (`app/layout.tsx:36-38`) |
| `public/logo.png` | 2246 × 600 RGBA | 311 KB | Login/cadastro (`auth-split-layout.tsx:25`) e onboarding |

**⚠️ Bloqueio a resolver antes:** `favicon.png` tem **5000×5000 e 1,4 MB**. Colocá-lo num
ícone de 40 px carregado em toda navegação é inaceitável. Gerar variantes otimizadas:

```
public/brand/solint-mark.png     ~128×128,  < 10 KB   (rail colapsada)
public/brand/solint-mark.svg     vetorial              (preferível, se houver o vetor)
public/brand/solint-logo.png     ~600×160,  < 40 KB   (rail expandida)
```

> Se o vetor original não estiver disponível, gerar os PNG a partir dos atuais e **não**
> usar `favicon.png` diretamente. Alternativa sem novo asset: `next/image` com
> `width`/`height` corretos e `quality` reduzida, mas o download original ainda ocorreria.

**Implementação:**

```tsx
<Link href="/dashboard" aria-label="Solint CRM"
      className={cn('mb-2 flex h-10 items-center transition-transform hover:scale-[1.03]',
                    expanded ? 'px-3' : 'w-full justify-center')}>
  {expanded ? (
    <Image src="/brand/solint-logo.png" alt="Solint CRM"
           width={600} height={160} priority className="h-8 w-auto" />
  ) : (
    <Image src="/brand/solint-mark.png" alt="Solint"
           width={128} height={128} priority className="size-9" />
  )}
</Link>
```

Detalhes:
- `expanded` já existe (`railWidth >= RAIL_LABEL_FROM`, `:41-45`)
- as **duas** imagens com `priority`, para não piscar ao arrastar a barra
- verificar contraste no **tema escuro**: se a marca for azul sobre transparente, pode
  sumir. Se preciso, `dark:brightness-0 dark:invert` ou uma variante para tema escuro
- **aplicar o mesmo no menu mobile** (`navigation-rail.tsx`, bloco do *drawer*, ~`:560+`),
  que hoje repete o `S` em gradiente

### H.2 Remover GIF da foto de perfil

| Arquivo | Linha | Ação |
|---|---|---|
| `src/core/domain/image-upload.ts` | 12-17 | Remover `'image/gif'` de `ALLOWED_AVATAR_MIME_TYPES` |
| `src/features/perfil/components/profile-view.tsx` | 199 | `"JPG, PNG, WEBP ou GIF, até 5 MB."` → `"JPG, PNG ou WEBP, até 5 MB."` |

O `accept` do `<input type="file">` (`:187`) deriva da constante e corrige sozinho. A
validação do servidor (`perfil/actions.ts`) e a rota que serve
(`api/users/[userId]/avatar/route.ts:2`) usam a mesma constante, e também corrigem sozinhas.

**Dado legado:** avatares GIF já enviados continuariam no *storage*, mas a rota passaria a
recusá-los na leitura (ela revalida o `t=` contra a lista) → avatar quebrado. Duas saídas:

1. **Recomendada:** *script* pontual que zera `avatarUrl` de quem tem `t=image%2Fgif`,
   voltando para as iniciais coloridas. Uma consulta.
2. Manter a leitura tolerante ao GIF e bloquear só o envio. Menos limpo.

> `image/gif` em `conversas/actions.ts:880` é para **anexo de mensagem**, não avatar.
> **Não mexer**: mandar GIF ao cliente é uso legítimo.

### H.3 Formato de data com ano de 2 dígitos

**Achado:** `dateFormat` é gravado (`CompanyProfile.dateFormat`,
`core/domain/settings.ts:158`) e **nunca lido por nenhum formatador**. Todas as datas do
sistema usam `toLocaleDateString('pt-BR')` com padrões fixos (`src/lib/datetime.ts`).
Acrescentar a opção sem implementar o consumo repetiria o problema.

**Portanto, duas partes:**

**1. Opção nova** (`company-section.tsx:379-389`):

```tsx
<option value="DD/MM/YYYY">DD/MM/AAAA (ex.: 01/09/2026)</option>
<option value="DD/MM/YY">DD/MM/AA (ex.: 01/09/26)</option>     {/* NOVA */}
<option value="YYYY-MM-DD">AAAA-MM-DD (ISO 8601)</option>
<option value="MM/DD/YYYY">MM/DD/AAAA (US)</option>
```

Sem migração: é chave dentro de `AccountSettings.company` (`Json`).
`configuracoes/actions.ts:1042` já valida como string de até 16 caracteres.

**2. Formatador que honra a preferência** (`src/lib/datetime.ts`):

```ts
export type DateFormatPreference = 'DD/MM/YYYY' | 'DD/MM/YY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';

export const formatarData = (date: Date, pref: DateFormatPreference = 'DD/MM/YYYY'): string
// DD/MM/YY   → toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' })
// YYYY-MM-DD → toLocaleDateString('en-CA', ...)
// MM/DD/YYYY → toLocaleDateString('en-US', ...)
// sempre com timeZone: APP_TIMEZONE
```

**Propagação — a parte cara.** A preferência vive no servidor; os componentes que formatam
datas são de cliente. Alternativas:

| Alternativa | Como | Recomendação |
|---|---|---|
| Contexto React | `<DateFormatProvider value={pref}>` no layout do workspace + `useDateFormat()` | ✅ **Recomendada.** Um lugar só; os componentes trocam `toLocaleDateString` por `formatarData(d, pref)` |
| Formatar tudo no servidor | Enviar rótulos prontos | Já é o padrão em vários pontos (`stageAgeLabel`, `lastMessageAt`), mas espalhado |
| Só nas telas novas | Escopo mínimo | Deixa o sistema inconsistente |

**Escopo pragmático (recomendado):** implementar o provedor e aplicá-lo aos pontos de **data
absoluta** — cartão do contato, painel de contexto, protocolos, timeline do negócio,
auditoria, relatórios. **Não** tocar em horas ("14:32") nem em rótulos relativos
("há 3 dias"), que não dependem da preferência.

### H.4 Limpeza de travessões

**Escopo: o que sai e o que fica.** A regra é semântica, não textual. Sai o travessão que
substitui vírgula, dois-pontos, ponto-e-vírgula ou parênteses. **Fica** o travessão que é
**valor de dado**:

| Ocorrência | Fica? | Motivo |
|---|---|---|
| `csatLabel` → `'—'` quando não há nota (`csat.ts:70`) | ✅ **fica** | É o "sem dado" da interface, não pontuação |
| `rate`/`average` → `'—'` (`analytics-repository.ts:576-577`) | ✅ **fica** | idem |
| `ip: al.ip ?? '—'` (`settings-repository.ts:274`) | ✅ **fica** | idem |
| `renewalLabel: '—'` (`auth/actions.ts:210`) | ✅ **fica** | idem |
| `"...não depende do período — é o estado atual da fila."` | ❌ **sai** | Vale por dois-pontos |
| `"Ignora a restrição por equipe — enxerga todos os canais"` | ❌ **sai** | Vale por dois-pontos |
| Travessões em **comentários** de código e JSDoc | ✅ **ficam** | Não são interface. Reescrever 700 comentários é ruído de revisão sem ganho |

**Levantamento quantitativo (medido):**

| Escopo | Ocorrências de `—` |
|---|---|
| Todo o `src/` (`.ts` + `.tsx`) | **931** |
| Apenas `.tsx` (80 arquivos) | **214** |
| `analytics-repository.ts` (descrições dos KPI) | 20, dos quais ~5 são texto de tela |

A grande maioria das 931 está em comentários. O alvo real é da ordem de **150 a 200 strings**.

**Como o travessão deve ser substituído** (decidir caso a caso, nunca com `sed` cego):

| Uso original | Substituição |
|---|---|
| Aposto explicativo | vírgula, ou vírgulas duplas |
| Introdução de explicação | dois-pontos |
| Comentário lateral | parênteses |
| Emenda de duas orações | ponto final e nova frase (**preferível**: encurta) |

**Procedimento em 4 passos:**

1. **Extrair candidatos.** Varredura por `—` em `.tsx`, mais os arquivos `.ts` que geram
   texto de tela: `analytics-repository.ts` (descrições dos KPI — os "popups informativos
   dos cards de dashboard" citados no pedido), `core/domain/permissions.ts` (*hints*),
   `core/domain/system-roles.ts`, `infrastructure/seed/knowledge.ts`, `planned.ts:16`.
2. **Classificar** cada ocorrência em `[dado]` (fica), `[comentário]` (fica) ou
   `[interface]` (sai). Gerar uma tabela de revisão.
3. **Reescrever** as `[interface]`, uma a uma.
4. **Guarda de regressão:** *script* `npm run check:travessao` que falha se um `—` aparecer
   dentro de um literal de string em `.tsx` fora de uma lista curta de exceções (`'—'` exato
   como placeholder). Sem isso, a limpeza volta a se degradar.

**Arquivos com maior concentração de texto de tela** (prioridade): `security-section.tsx`,
`automations-section.tsx`, `inboxes-section.tsx`, `company-section.tsx`, `profile-view.tsx`,
`contacts-explorer.tsx`, `analytics-repository.ts` (descrições), `permissions.ts` (*hints*),
`agent-ranking-card.tsx:214`, `csat-report.tsx`.

> **Nota:** o `·` (U+00B7, ponto médio) é usado como separador em vários lugares
> (`"Aracaju, SE · Última atividade: ..."`). **Não faz parte deste pedido** e deve ser
> preservado.

### H.5 Correção dos filtros do Kanban

Complemento de §1.5.1, tratado aqui porque é majoritariamente UI:

**1. Filtro de período — implementar** (`use-board.ts`, dentro de `filteredDeals`):

```ts
// 7. Período (referência: enteredStageAt — quando o card entrou na etapa atual)
if (filters.period && filters.period !== 'todos') {
  const entrada = new Date(deal.enteredStageAt).getTime();
  const corte = inicioDoPeriodo(filters.period);   // hoje | semana | mes | trimestre
  if (entrada < corte) return false;
}
```

Usar `inicioDoDia` de `src/lib/datetime.ts` como base, para respeitar `APP_TIMEZONE`.

> **Ambiguidade a confirmar:** o rótulo diz *"Criados Hoje"*, mas o único campo temporal do
> card é `enteredStageAt` (**entrada na etapa atual**), não a criação. Um card criado ontem
> e movido hoje apareceria em "Criados Hoje" — errado. Duas saídas:
> (a) renomear os rótulos para "Movidos hoje / esta semana / ..."; (b) adicionar
> `Deal.createdAt DateTime @default(now())` (migração + *backfill* com `enteredStageAt`) e
> filtrar por ele. **Recomendação: (b)**, porque "criado" é a pergunta comercial correta, e
> a coluna serve a relatórios futuros.

**2. Filtros de Equipe e Origem — decidir.** Duas saídas:

| Saída | Trabalho | Resultado |
|---|---|---|
| **A — remover os dois filtros** | Baixo: tirar da toolbar, de `BoardFilters` e de `filteredDeals`; tirar `source`/`team`/`title`/`tags`/`expectedCloseDate` da interface `Deal` (são campos fantasma) | Honesto e imediato. O Kanban deixa de oferecer o que não pode entregar |
| **B — implementar de verdade** ✅ | Migração: `Deal.source String?`, `Deal.team String?`, `Deal.title String?`. Preencher em `createDealAction`/`updateDealAction` (a UI **já coleta** `source` em `new-deal-modal.tsx`). Mapear em `dealRow` | Entrega o que a tela promete. `DEAL_SOURCES` já existe (`pipeline.ts:118-128`) |

**Recomendação: B** para `source` e `title` (a UI já os coleta e a busca textual depende de
`title`), e **A** para `team` — não há de onde derivar a equipe de um negócio hoje, e
inventar um campo livre criaria dado sujo. Se `team` ficar, deve vir de `Team` por relação,
não de texto.

**3. Busca textual.** Passa a funcionar plenamente assim que `title` existir.

### H.6 Correção da sincronização de contatos (§1.6)

**1. Sanitizador de nome** — `src/infrastructure/whatsapp/wa-format.ts`:

```ts
/** Bullets que o WhatsApp usa para mascarar números de quem não está na agenda. */
const MASCARA = /[∙•·‧・･*]/;

/**
 * O nome que o WhatsApp mandou serve como nome de contato?
 *
 * Não serve quando é o próprio número mascarado: o formato que o WhatsApp usa
 * justamente para dizer "esta pessoa NÃO está na sua agenda". Aceitá-lo gravava
 * `+55∙∙∙∙∙∙∙∙01` na coluna de identificação e, pior, fazia o contato ser
 * importado como se fosse da agenda.
 */
export const nomeUtilizavel = (nome: string | undefined): string | undefined => {
  const limpo = nome?.trim();
  if (!limpo) return undefined;
  if (MASCARA.test(limpo)) return undefined;            // máscara do WhatsApp
  const digitos = limpo.replace(/[\s()+.-]/g, '');
  if (/^\d{6,}$/.test(digitos)) return undefined;       // é só o número
  return limpo;
};
```

**2. Aplicar nos pontos de `worker/session.ts`:**

| Linha | Mudança |
|---|---|
| `:1046-1047` (`handleContactSync`) | `addressBookName = nomeUtilizavel(contact.name)`; idem `pushName` |
| `:1065-1067` | `existing.name.startsWith('+')` → `!nomeUtilizavel(existing.name)`, evitando que uma máscara sobrescreva um nome legítimo que por acaso começa com `+` |
| `:1204-1206` (`syncAddressBook`) | idem |
| `:1230` (`daAgenda`) | Continua `Boolean(addressBookName)`, mas agora já sanitizado: o contato mascarado **deixa de ser importado**, que é o comportamento correto |
| `:1715`, `:1796` (nome vindo de mensagem) | Aplicar `nomeUtilizavel` ao `msg.pushName` / `verifiedBizName` |

**3. Limpeza dos dados já contaminados** — *script* pontual em `scripts/`:

```sql
-- Diagnóstico
SELECT id, name, phone FROM "Contact"
 WHERE name ~ '[∙•·*]' OR name ~ '^\+?[0-9\s()-]+$';
```

Nomes contaminados voltam para `PhoneNumber.format(phone)`, o mesmo *fallback* de
`fallbackPersonName` (`wa-format.ts:57-58`). **Não apagar** os contatos: eles podem ter
conversas e histórico.

**4. Verificar a coluna de identificação** (`contacts-explorer.tsx:913-950`): quando o nome
for igual ao telefone formatado, a tabela exibe a mesma informação duas vezes (nome + coluna
Telefone). Suprimir a repetição, mostrando o nome apenas quando ele **não for** o telefone.

---

# 3. Plano de execução por etapas

Etapas ordenadas por dependência. Cada uma é entregável e verificável isoladamente.

## Progresso

| Etapa | Descrição | Estado |
|---|---|---|
| 0 | Diagnóstico em produção | ⬜ pendente (as consultas SQL seguem válidas) |
| 1 | Correções cirúrgicas | ✅ concluída |
| 2 | Contatos do WhatsApp e logotipo | ✅ concluída |
| 3 | Distribuição de conversas | ✅ concluída |
| 4 | Taxa de conversão ponderada | ✅ concluída |
| 5 | Auditoria e sessões reais | ✅ concluída |
| 6 | Workspaces | ✅ concluída |
| 7 | Variáveis dinâmicas e protocolo | ✅ concluída |
| 8 | Notificações | 🟡 parcial: E.1 a E.4 concluídas; **resumo diário (E.5) bloqueado** |
| 9 | CSAT: fechar o ciclo | ✅ concluída |
| 10 | Tipografia e formato de data | ✅ concluída |
| 11 | Filtros do Kanban | ✅ concluída |

**Verificação ao fim de cada onda:** `npx tsc --noEmit`,
`npx next lint --max-warnings=0`, `npx next build --no-lint`,
`node scripts/check-travessao.mjs` e `npm run worker:build` passaram limpos.

### O resumo diário (E.5) está bloqueado, e por quê

Duas coisas o impedem, e nenhuma é código:

1. **A preferência não existe mais no produto.** A Etapa 1 removeu
   `dailySummary` e `dailySummaryEmail` de `NotificationPreferences` junto com a
   preferência de campanhas — mais do que o item 1.3 pedia. Reconstruí-la é
   decisão de produto, não continuação de implementação.
2. **A decisão D4 continua em aberto e tem custo externo.** O projeto não tem
   nenhum provedor de e-mail: nenhuma dependência de envio, nenhuma variável
   SMTP, nenhum módulo `mailer`. Implementar exige acrescentar uma dependência
   (`resend`, na recomendação do plano), uma conta no provedor e uma
   `RESEND_API_KEY` em produção.

O que **não** está bloqueado, e ficaria pronto no dia em que a decisão sair: o
agregador dos números do dia já existe inteiro em
`analytics-repository.getDashboard()` com período "hoje", e o padrão de runner
diário já está estabelecido por `audit-retention-runner`.

### Achados corrigidos durante a Etapa 6

Três defeitos que não estavam no plano e apareceram ao integrar:

1. **Cliente Prisma desatualizado.** As migrações das etapas 4 e 5 haviam sido
   escritas sem `prisma generate`, e sete erros de tipo estavam mascarados por
   isso (`conversionWeight`, `Message.authorId`).
2. **Auditoria colada no lugar errado.** `sendTemplateAction` gravava
   `conversa.movida` com o payload da ação de mover caixa — lia
   `result.value.contact` (um `Message`) e `parsed.data.inboxId` (inexistente
   no schema de template). Passou a gravar `mensagem.enviada` com o
   `templateId` e o nome do template no metadata.
3. **SSE vazando entre workspaces (⚠️ isolamento).** `/api/conversas/events`
   resolve a conta **uma vez**, quando a conexão abre. Trocar de workspace
   reassina o cookie e navega, mas a navegação do App Router **preserva** o
   layout: o `EventSource` continuava aberto e o servidor seguia empurrando
   eventos da conta anterior. `ConversationEventsProvider` passou a receber
   `accountId` como dependência do efeito, e `LiveNotificationsProvider` a
   esvaziar a lista de avisos vivos na troca — sem isso o sininho mostraria
   conversas do workspace anterior, com links que a pessoa não alcança mais.

### Achados corrigidos durante as Etapas 7 a 9

1. **`dispatchAutoMessage` engolia a falha de entrega.** A mensagem automática
   era gravada e o `catch` do despacho só escrevia no console: ela aparecia na
   timeline indistinguível de uma que saiu, e o cliente nunca a recebia. Era
   exatamente o que tornava "finalizei o atendimento e a pesquisa não chegou"
   impossível de diagnosticar de dentro do produto. Agora grava
   `deliveryStatus: 'falha'` e devolve o motivo a quem chamou.
2. **O protocolo nascia em dois lugares e nunca fechava.** `Math.random()` de
   cinco dígitos (colisão esperada em semanas numa conta com 300 conversas/dia),
   só no caminho do WhatsApp, e o status `'Em andamento'` valia para sempre.
   Virou sequencial por conta (`#AT-26-000431`, `UPDATE ... RETURNING`, atômico),
   com ponto único de abertura e fechamento ao resolver.
3. **O SLA precisava de dois pontos de escrita, não um.** A entrada do WhatsApp
   grava direto em `wa-store` e não passa por `persistMessage`: carimbar só num
   deles deixaria metade das conversas sem prazo. O relógio também só corre
   dentro do expediente — sem isso, toda conversa recebida às 18h nasceria
   estourada às 9h do dia seguinte.

### Decisão tomada na Etapa 11 (§H.5.2)

**Opção B para `title`, `source` e `createdAt`; opção A (remoção) para `team`.**

- `title` e `source` já eram coletados pela modal, validados pelas Server
  Actions e aceitos pela assinatura do repositório. Só faltavam as colunas: o
  título sobrevivia apenas dentro do texto do histórico e a origem não
  sobrevivia. Duas colunas e a busca textual e o filtro de Origem passam a
  funcionar de verdade.
- `createdAt` porque o filtro de período passou a recortar pela **criação**, e
  não por `enteredStageAt` — um card de março arrastado hoje aparecia em
  "Criados hoje".
- `team` **removido**: nada no sistema sabe derivar a equipe de um negócio, e um
  campo de texto livre só produziria dado sujo. O `<select>` de Equipe era
  alimentado pelos próprios cards, então aparecia sempre vazio e descartava
  todos eles quando usado. Se a equipe voltar, virá por relação com `Team`.
- `tags` e `expectedCloseDate` saíram da interface `Deal` pelo mesmo motivo:
  eram opcionais que nenhuma consulta jamais preenchia.

---

### ✅ Etapa 0 — Diagnóstico em produção · CONCLUÍDA em 01/09/2026

Nada aqui altera código. Serve para confirmar as hipóteses de §1.3.4 e §1.6.

| # | Verificação | Comando / passo |
|---|---|---|
| 0.1 | `csatEnabled` das caixas | `SELECT id, name, "csatEnabled", "csatQuestion" FROM "Inbox";` |
| 0.2 | Estado de CSAT das conversas resolvidas | `SELECT id, status, "resolvedAt", "csatAskedAt", "csatScore" FROM "Conversation" WHERE status='resolvida' ORDER BY "resolvedAt" DESC LIMIT 20;` |
| 0.3 | Mensagens de CSAT gravadas | `SELECT id, "conversationId", origin, "deliveryStatus", "createdAt" FROM "Message" WHERE origin='csat' ORDER BY "createdAt" DESC LIMIT 20;` |
| 0.4 | Se 0.3 tem linhas e 0.2 não tem nota, o problema é **entrega ao canal**, não o gatilho | conferir o log do worker por `[auto-reply] Falha ao despachar` |
| 0.5 | Contatos mascarados | `SELECT count(*) FROM "Contact" WHERE name ~ '[∙•·*]';` |
| 0.6 | Volume esperado de auditoria | `SELECT count(*) FROM "Message" WHERE "createdAt" > now() - interval '7 days';` |
| 0.7 | Sessões reais | `SELECT "userId", "userAgent", ip, "createdAt", "revokedAt" FROM "AuthSession" ORDER BY "createdAt" DESC LIMIT 20;` |
| 0.8 | Contas por usuário | `SELECT "userId", count(*) FROM "Membership" GROUP BY 1 ORDER BY 2 DESC;` |

**Saída da etapa:** confirmação (ou refutação) das causas raízes, e o número real de
contatos a limpar em §H.6.3.

---

### ✅ Etapa 1 — Correções cirúrgicas e de baixo risco · CONCLUÍDA em 01/09/2026

Ganho imediato, sem migração, sem dependência entre si.

| # | Item | Arquivos | § |
|---|---|---|---|
| 1.1 | Taxa de conversão: `25` → `0` (correção mínima, antes da fórmula completa) | `core/domain/pipeline.ts:211` | B |
| 1.2 | Remover GIF do avatar | `image-upload.ts:12-17`, `profile-view.tsx:199` | H.2 |
| 1.3 | Remover a preferência de campanhas | `profile-view.tsx:42`, `user.ts:162,181`, `perfil/actions.ts`, `notification.ts:6`, `seed/notifications.ts:26` | 1.1.5 |
| 1.4 | Ligar "Sair de todas as sessões" | `perfil/page.tsx:44` + nova action usando `revokeAllSessions` | 1.2.3 |
| 1.5 | Remover "Políticas de acesso e expiração" | `security-section.tsx:255-303, 45-46` | D.7 |
| 1.6 | 2FA: substituir o mock por estado honesto | `security-section.tsx:117-176` | D.8 |
| 1.7 | Ano de 2 dígitos no `<select>` | `company-section.tsx:385` | H.3.1 |
| 1.8 | Corrigir `kind: 'automacao'` → `'sistema'` | `automation-effects.ts:178` | E.1 |
| 1.9 | Filtro de período do Kanban | `use-board.ts` | H.5.1 |

**Aceite:** funil novo mostra 0%; upload de GIF recusado; sininho sem opção de campanhas;
o botão de sair de todas as sessões derruba o próprio acesso; tela de Segurança sem a seção
de políticas e sem afirmar 2FA ativo; filtro de período do Kanban altera o quadro.

---

### ✅ Etapa 2 — Sincronização de contatos e logotipo · CONCLUÍDA em 01/09/2026

| # | Item | § |
|---|---|---|
| 2.1 | `nomeUtilizavel()` em `wa-format.ts` | H.6.1 |
| 2.2 | Aplicar nos 5 pontos de `worker/session.ts` | H.6.2 |
| 2.3 | *Script* de limpeza dos contatos contaminados | H.6.3 |
| 2.4 | Suprimir nome duplicado na tabela de contatos | H.6.4 |
| 2.5 | Gerar `solint-mark` e `solint-logo` otimizados | H.1 |
| 2.6 | Trocar o `S` em gradiente pelos assets (rail e drawer mobile) | H.1 |

**Aceite:** nova sincronização não cria contato mascarado; contatos existentes limpos; barra
colapsada mostra o "S" da marca e expandida mostra a logo, legível em ambos os temas.

---

### ✅ Etapa 3 — Distribuição de conversas · CONCLUÍDA em 01/09/2026

| # | Item | § |
|---|---|---|
| 3.1 | Remover sub-abas "Distribuição" e "Ações em 1 clique" | C.1 |
| 3.2 | Remover `assignmentMethod` do domínio, porta, repositório e actions | C.1 |
| 3.3 | Passar `userId` do autor até `persistMessage` | C.2 |
| 3.4 | Auto-posse na primeira resposta pública, com *compare-and-swap* | C.2 |
| 3.5 | Emitir `conversation_updated` ao assumir | C.2 |
| 3.6 | Atualizar textos de ajuda e base de conhecimento | C.3 |

**Aceite:** Automações tem só a aba de regras; conversa nova nasce sem responsável e visível
a todos; ao responder, o agente vira responsável; um segundo agente respondendo ao mesmo
tempo **não** rouba a posse.

---

### Etapa 4 — Taxa de conversão ponderada · ~1,5 dia

| # | Item | § |
|---|---|---|
| 4.1 | Migração `kanban_peso_de_conversao` + *backfill* | B.3 |
| 4.2 | `conversionWeight` no domínio, mapeador e repositório | B.3 |
| 4.3 | Reescrever `calculatePipelineSummary` | B.2 |
| 4.4 | Campo de peso no `stages-modal`, com regras de `isWon`/`isLost` | B.3 |
| 4.5 | Zod de `updateStagesAction` | B.3 |
| 4.6 | Pesos padrão no provisionamento e no *seed* | B.3 |
| 4.7 | Rótulo e `InfoTooltip` do cartão | B.3 |

**Aceite:** funil vazio = 0%; cards só em "Novo Lead" = 0%; mover um card para "Fechado
Ganho" eleva o número; editar o peso de uma etapa reflete no cartão após salvar.

---

### Etapa 5 — Auditoria e sessões reais · ~3 dias

| # | Item | § |
|---|---|---|
| 5.1 | Migração: índices de `AuditLogEntry` (+ `Message.authorId`, se adotado) | D.4, §4 |
| 5.2 | `core/domain/audit.ts` (catálogo, rótulos, críticas, TTL) | D.5 |
| 5.3 | `writeAuditLog` (à prova de falha, com ip/userAgent) | D.5 |
| 5.4 | Instrumentar o Grupo 3 (segurança) e o Grupo 2 (administrativas) | D.2 |
| 5.5 | Instrumentar o Grupo 4 (exportações) | D.2 |
| 5.6 | Instrumentar o Grupo 1 (atendimento), com metadata enxuta | D.2, D.3 |
| 5.7 | `audit-repository` com filtros, agrupamento e cursor | D.5 |
| 5.8 | `audit-log-panel.tsx` (abas, filtros, agrupamento, exportar) | D.6 |
| 5.9 | `audit-retention-runner` (7 dias) + janela na leitura | D.4 |
| 5.10 | **Sessões ativas: trocar a fonte** para `AuthSession` por usuário | D.8 |
| 5.11 | `terminateSession` passa a gravar `revokedAt` | D.8 |
| 5.12 | Aposentar `AccountSettings.activeSessions` (parar de ler e escrever) | D.8 |

**Aceite:** cada ação da matriz gera exatamente uma linha; a aba "Atendimento" agrupa
mensagens por conversa; filtrar por conversa abre a visão detalhada; linhas com mais de 7
dias somem; "Encerrar sessão" derruba o acesso **de verdade** (validar em duas janelas).

---

### Etapa 6 — Workspaces · ~2,5 dias

| # | Item | § |
|---|---|---|
| 6.1 | Extrair `provisionAccount` de `signupAction` | A.4 |
| 6.2 | `reissueSessionToken` em `auth/session.ts` | A.2 |
| 6.3 | `switchWorkspaceAction`, com reconferência de `Membership` | A.3 |
| 6.4 | `createWorkspaceAction`, com quota | A.4, A.5 |
| 6.5 | `WorkspaceSwitcher` funcional + item "criar" | A.6 |
| 6.6 | `CreateWorkspaceModal` | A.6 |
| 6.7 | Ligar o botão "Alternar" do perfil | A.6 |
| 6.8 | Auditar `workspace.criado` / `workspace.trocado` | D.2 |
| 6.9 | **Verificar SSE**: reabertura por conta ao trocar | A.3 |
| 6.10 | Revisar o texto que promete a funcionalidade | A.5 |

**Aceite:** trocar de workspace muda conversas, contatos, funil, configurações e permissões;
tentar trocar para uma conta sem `Membership` é recusado no servidor; criar workspace
entrega uma conta usável (caixa + funil + papéis) e entra nela; o SSE não vaza eventos da
conta anterior.

---

### Etapa 7 — Variáveis dinâmicas e protocolo · ~2 dias

| # | Item | § |
|---|---|---|
| 7.1 | `message-variables.ts` (interpolador puro) | G.1 |
| 7.2 | Interpolar no `applyCanned` | G.2 |
| 7.3 | Interpolar em `sendMessageAction` (rede de segurança) | G.2 |
| 7.4 | Estender às automáticas, agendadas e campanhas | G.2 |
| 7.5 | Migração `Account.protocolSeq` | G.3 |
| 7.6 | `abrirProtocolo()` sequencial, ponto único | G.3 |
| 7.7 | Fechar protocolo ao resolver; abrir novo na reabertura | G.3 |
| 7.8 | Texto de ajuda explicando o protocolo | G.3 |

**Aceite:** resposta rápida com as 4 variáveis chega ao cliente sem nenhuma chave crua;
`{{protocolo}}` traz o código do atendimento; protocolos são sequenciais e sem colisão;
resolver fecha o protocolo.

---

### Etapa 8 — Notificações · ~2,5 dias

| # | Item | § |
|---|---|---|
| 8.1 | `createNotification` + emissão em tempo real + retenção | E.1 |
| 8.2 | Notificação de atribuição | E.2 |
| 8.3 | Menções `@`: autocomplete, extração, `Message.mentions`, notificação, realce | E.3 |
| 8.4 | `core/domain/sla.ts` + escrita em `persistMessage` | E.4 |
| 8.5 | `sla-runner` (aviso antecipado e marcação de estouro) | E.4 |

**Aceite:** atribuir a outra pessoa acende o sininho dela **sem recarregar**; `@` numa nota
notifica o mencionado; conversa parada além de 80% do prazo gera aviso **antes** de estourar
e o *badge* vermelho aparece sozinho.

---

### Etapa 9 — CSAT: fechar o ciclo · ~1 dia

| # | Item | § |
|---|---|---|
| 9.1 | Resumo do comportamento no cartão da caixa; aviso se desconectada | F.1 |
| 9.2 | `runClosingAutoReply` devolve resultado; *toast* ao resolver | F.2 |
| 9.3 | `deliveryStatus: 'falhou'` quando o canal recusa | F.3 |

**Aceite:** resolver com CSAT ligado e caixa conectada envia e confirma na tela; com caixa
desconectada, avisa que não saiu; a mensagem que falhou aparece como falhada na timeline,
não como enviada.

---

### Etapa 10 — Limpeza tipográfica · ~1,5 dia

| # | Item | § |
|---|---|---|
| 10.1 | Extrair e classificar as ocorrências de `—` | H.4 |
| 10.2 | Reescrever as de interface (prioridade: descrições dos KPI do dashboard) | H.4 |
| 10.3 | `npm run check:travessao` como guarda | H.4 |
| 10.4 | Provedor de formato de data + aplicação nos pontos de data absoluta | H.3.2 |

**Aceite:** nenhuma string de interface usa travessão como pontuação; os placeholders `'—'`
continuam intactos; a guarda falha se um travessão novo entrar; escolher `DD/MM/AA` faz as
datas absolutas exibirem `01/09/26`.

---

### Etapa 11 — Filtros do Kanban (decisão pendente) · ~1 dia

Depende da decisão de §H.5.2. Se **B**: migração `Deal.source/title` (+ `createdAt`),
preenchimento nas actions, mapeamento em `dealRow`, remoção de `team`/`tags`/
`expectedCloseDate` da interface. Se **A**: remoção dos filtros.

---

## Resumo de esforço

| Etapa | Descrição | Estimativa |
|---|---|---|
| 0 | Diagnóstico | 0,25 d |
| 1 | Correções cirúrgicas | 1 d |
| 2 | Contatos e logotipo | 1 d |
| 3 | Distribuição | 1,5 d |
| 4 | Conversão ponderada | 1,5 d |
| 5 | Auditoria e sessões | 3 d |
| 6 | Workspaces | 2,5 d |
| 7 | Variáveis e protocolo | 2 d |
| 8 | Notificações | 2,5 d |
| 9 | CSAT | 1 d |
| 10 | Tipografia e data | 1,5 d |
| 11 | Filtros Kanban | 1 d |
| | **Total** | **~18,75 dias úteis** |

**Ordem sugerida de entrega em ondas:**

- **Onda 1 (correções):** Etapas 0, 1, 2, 9 — *~3,25 d*. Resolve o que está visivelmente quebrado.
- **Onda 2 (funil e fluxo):** Etapas 3, 4, 11 — *~4 d*.
- **Onda 3 (governança):** Etapas 5, 6 — *~5,5 d*.
- **Onda 4 (comunicação):** Etapas 7, 8, 10 — *~6 d*.

---

# 4. Migrações de banco consolidadas

Seguindo `npm run db:migrate -- <nome>` (`scripts/new-migration.mjs`), que faz `migrate diff`
contra o banco real e aplica com `migrate deploy`. O Supabase não permite *shadow database*.

| # | Nome | Conteúdo | Etapa |
|---|---|---|---|
| 1 | `kanban_peso_de_conversao` | `PipelineStage.conversionWeight Int @default(0)` + *backfill* (`isWon` → 100; nome contendo "negocia" → 50) | 4 |
| 2 | `auditoria_indices` | `@@index([createdAt])` e `@@index([accountId, action, createdAt])` em `AuditLogEntry` | 5 |
| 3 | `mensagem_autor_e_mencoes` | `Message.authorId String?` + `Message.mentions Json @default("[]")` + `@@index([conversationId, authorId])` | 5 / 8 |
| 4 | `protocolo_sequencial` | `Account.protocolSeq Int @default(0)` | 7 |
| 5 | `negocio_origem_e_titulo` *(se §H.5.2 = B)* | `Deal.source String?`, `Deal.title String?`, `Deal.createdAt DateTime @default(now())` + *backfill* de `createdAt` com `enteredStageAt` | 11 |
| 6 | `limpeza_distribuicao` *(opcional, tardia)* | `DROP COLUMN AccountSettings.assignmentMethod` e `activeSessions` | pós-5 |

**Sem migração:** workspaces (§A), remoção de GIF (§H.2), formato de data (§H.3 — vive no
`Json` de `company`), remoção da preferência de campanhas (§1.1.5 — `notificationPrefs` é
`Json?` com *merge* no padrão), sanitização de contatos (§H.6 — só *script* de dados).

**Regras do projeto a respeitar em toda migração:**

- Nenhum `enum` de banco: estado de domínio é `String` validado no domínio (documentado no
  cabeçalho do `schema.prisma`).
- Dinheiro sempre em centavos, `Int` (REGRAS-GLOBAIS §4).
- Coluna relacional quando se consulta, filtra ou escreve individualmente; `Json` para
  agregado lido e gravado inteiro.
- Toda consulta escopada por `accountId`; exceções marcadas `// tenant-ok:` com
  justificativa (verificado por `npm run check:tenant`).

---

# 5. Matriz de QA

## 5.1 Verificações automáticas (rodar a cada etapa)

```
npm run typecheck        # tsc --noEmit
npm run lint
npm run format:check
npm run check:tenant     # isolamento multi-tenant
npm run check:travessao  # NOVO (etapa 10)
npm run build
```

## 5.2 Roteiros manuais críticos

### R1 — Isolamento entre workspaces (⚠️ o teste mais importante)

1. Usuário A é administrador de W1 e W2 (`Membership` nas duas).
2. Em W1, criar contato "Teste W1", uma conversa e um negócio.
3. Trocar para W2 → **nenhum** dos três aparece em contatos, conversas ou Kanban.
4. Chamar `switchWorkspaceAction({ accountId: '<conta de terceiro>' })` direto (DevTools)
   → **recusado**.
5. Editar o cookie de sessão à mão trocando o `act` → assinatura inválida → deslogado.
6. Papéis diferentes por conta (administrador em W1, colaborador em W2) → a barra lateral e
   o menu de Configurações mudam ao trocar.

### R2 — Posse pela primeira resposta

1. Dois navegadores, agentes X e Y, mesma caixa.
2. Cliente manda mensagem → a conversa aparece sem responsável para os dois.
3. X responde → X vira responsável, e a tela de Y atualiza sozinha.
4. Repetir com os dois clicando "enviar" simultaneamente → apenas um vira responsável
   (valida o *compare-and-swap*).
5. Nota interna **não** atribui.

### R3 — Taxa de conversão

| Cenário | Esperado |
|---|---|
| Funil recém-criado, 0 cards | `0%` |
| 3 cards em "Novo Lead" (peso 0) | `0%` |
| 2 em "Novo Lead" (0) + 2 em "Fechado Ganho" (100) | `50%` |
| 2 em "Em Negociação" (50) | `50%` |
| Editar "Qualificação" para 30, 1 card lá, mais nada | `30%` |
| Todos em "Fechado Perdido" | `0%` |

### R4 — CSAT ponta a ponta

1. Ligar CSAT na caixa, salvar, **recarregar** e confirmar que ficou ligado.
2. Resolver uma conversa com WhatsApp conectado → cliente recebe a pergunta; *toast* confirma.
3. Cliente responde `"5"` → nota gravada; o painel sai de `—`.
4. Cliente responde `"meu pedido 3 chegou"` → **não** vira nota.
5. Resolver de novo em menos de 24 h → não repergunta; *toast* explica.
6. Desconectar a caixa e resolver → *toast* de aviso; mensagem marcada como falhada.

### R5 — Auditoria

1. Executar uma ação de cada grupo → uma linha cada, com ator, alvo, IP e horário corretos.
2. Enviar 20 mensagens na mesma conversa → a aba "Atendimento" mostra **uma** linha agrupada.
3. Filtrar por conversa → detalhamento mensagem a mensagem.
4. Excluir uma caixa → linha crítica destacada, com a contagem no metadata.
5. Inserir linha com `createdAt` de 8 dias atrás, rodar o runner → some.
6. Colaborador sem `config.seguranca:ler` → não vê a seção.

### R6 — Sessões

1. Entrar em dois navegadores → duas linhas reais em Sessões ativas, com o `userAgent` certo.
2. Encerrar a outra → **na outra janela**, a próxima requisição desloga.
3. "Sair de todas as sessões" → ambas caem, inclusive a atual.
4. Confirmar `revokedAt` preenchido em `AuthSession`.

### R7 — Notificações

1. Atribuir a outra pessoa → o sininho dela acende **sem recarregar**.
2. Desligar a preferência `assigned` → não notifica.
3. `@Nome` em nota interna → notifica; `@Nome` em mensagem pública → não.
4. Conversa parada além de 80% do SLA → aviso; além de 100% → *badge* vermelho.
5. Conversa recebida fora do expediente → **não** estoura durante a madrugada.

### R8 — Variáveis e protocolo

1. Resposta rápida com as 4 variáveis → texto final correto no composer **e** no WhatsApp.
2. Digitar `{{protocolo}}` à mão → interpolado pelo servidor.
3. Variável sem valor → some, não vaza a chave.
4. Criar 100 conversas → 100 protocolos distintos e sequenciais.
5. Resolver → o protocolo vira "Resolvido"; nova mensagem → protocolo novo.

### R9 — Contatos do WhatsApp

1. Sincronizar uma conta com contatos mascarados → nenhum `∙` na tabela.
2. Contato salvo na agenda continua importado com o nome certo.
3. Rodar o script de limpeza → contaminados voltam ao telefone formatado, sem perder conversas.

### R10 — Interface

1. Barra colapsada → "S" da marca; expandida → logo completa; ambos legíveis em tema claro
   e escuro.
2. Arrastar a barra → troca sem piscar.
3. Menu mobile também usa a marca.
4. Tentar enviar `.gif` como avatar → recusado, com mensagem clara.
5. Escolher `DD/MM/AA` → datas absolutas viram `01/09/26`; horas e "há 3 dias" inalterados.
6. Passar o mouse nos cartões do dashboard → descrições sem travessão como pontuação.
7. Sem dados → o `—` de "sem valor" continua aparecendo.

## 5.3 Regressões a vigiar

| Área | Risco | Como verificar |
|---|---|---|
| `persistMessage` | Recebe 3 mudanças (auto-posse, SLA, `authorId`). É o caminho de **toda** mensagem | Enviar mensagem, nota, automática e agendada; conferir `firstResponseSecs`, `lastActivityAt` e a ordenação da caixa |
| `readSession` | Ganha reemissão de token | Login, refresh, expiração, revogação, superadmin |
| `analytics-repository` | Depende de `slaBreached`, que passa a ser escrito | Painel antes e depois; conversas antigas sem SLA não podem sumir |
| Worker | Ganha 3 runners novos | `npm run worker` sem erro; um runner falhando não derruba os outros |
| `dealRow` / `Deal` | Campos fantasma removidos ou preenchidos | Kanban carrega; filtros coerentes |
| Tema escuro | Logo e painel de auditoria | Alternar tema em todas as telas tocadas |

---

# 6. Riscos e decisões em aberto

## 6.1 Decisões que precisam da sua confirmação

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| **D1** | Peso padrão de "Em Negociação" | 30 / **50** / 70 | **50**: metade do caminho é a leitura intuitiva |
| **D2** | Quem pode criar workspace | Qualquer usuário / permissão nova | **Qualquer usuário**, com quota (§A.5) |
| **D3** | Quota de workspaces por pessoa | 3 / **5** / 10 / ilimitado | **5** |
| **D5** | Política de SLA | **Global fixa** / por caixa | **Global** nesta entrega; por caixa depois |
| **D6** | Minutos de SLA | 1ª resposta **15** min, seguintes **60** min, aviso a **80%** | confirmar os números |
| **D7** | Filtros Equipe e Origem do Kanban | Remover / **implementar** | **Implementar `source` e `title`; remover `team`** |
| **D8** | Rótulo do filtro de período | Renomear para "Movidos" / **adicionar `Deal.createdAt`** | **Adicionar a coluna** |
| **D9** | Retenção de notificações | 30 dias / ilimitado | **30 dias** para as lidas |
| **D10** | 2FA real | **Fora desta entrega** / incluir | **Fora**, mas corrigir o mock enganoso já na Etapa 1 |
| **D11** | Avatares GIF já enviados | **Zerar `avatarUrl`** / manter leitura tolerante | **Zerar** |
| **D12** | Nome do indicador do Kanban | "Taxa de Conversão" / **"Conversão ponderada"** | **Renomear**: a semântica mudou |

## 6.2 Riscos técnicos

| Risco | Impacto | Mitigação |
|---|---|---|
| `persistMessage` acumula 3 responsabilidades novas | Alto: é o caminho de toda mensagem | Fazer em etapas separadas (3, depois 5, depois 8), com R2/R4/R7 entre elas |
| Auditoria de mensagens infla o banco | Médio | Agrupamento + metadata enxuta + TTL 7 dias + monitorar `pg_total_relation_size` na 1ª semana |
| Troca de workspace com SSE aberto | Médio: vazamento de evento entre contas | `redirect()` derruba o `EventSource`; validar em R1 e adicionar `accountId` às dependências dos hooks de realtime |
| `favicon.png` de 1,4 MB na barra lateral | Médio: regressão de performance em toda navegação | Gerar assets otimizados **antes** de trocar (§H.1) |
| Limpeza de travessões com `sed` | Médio: apagaria placeholders `'—'` legítimos | Proibido `sed`. Classificação manual em 3 passos + guarda automatizada |
| Novos runners derrubando o worker | Médio | `try/catch` por runner, no padrão de `waiting-message-runner.ts:98` |
| Reescrita de `calculatePipelineSummary` | Baixo | Função pura: testar com os 6 cenários de R3 |
| Auditoria falhando e derrubando a ação auditada | Alto | `writeAuditLog` **nunca** lança; `try/catch` + `console.warn` |
| Migração `Deal.createdAt` sem *backfill* | Médio: cards antigos somem do filtro | *Backfill* com `enteredStageAt` na própria migração |

## 6.3 Itens fora do escopo (registrados para depois)

- 2FA real com TOTP e códigos de recuperação (§D.8)
- Timeout de sessão por inatividade configurável (a seção foi removida; `SESSION_TTL_SECONDS`
  segue fixo em 7 dias)
- SLA configurável por caixa de entrada (§E.4, alternativa B)
- Reativar "Ações em 1 clique" (macros); tabela e domínio ficam preservados
- Fila de retentativa para mensagens automáticas que falharam no canal
- Deep-link de workspace por URL (`/w/[accountId]/...`) — §A.2, opção 1
- Retenção configurável de auditoria (hoje: constante de 7 dias)
- Outros `planned()` pendentes: alterar senha, nova conversa pelo painel de contexto,
  mesclar contatos, bloquear contato

---

## Anexo — Índice de evidências

| Achado | Arquivo:linha |
|---|---|
| Taxa de conversão fixa em 25 | `src/core/domain/pipeline.ts:211` |
| Filtro de período não aplicado | `src/features/kanban/hooks/use-board.ts:83-119` |
| `Deal.source/team/title` não existem no banco | `prisma/schema.prisma:459-487` vs `src/core/domain/pipeline.ts:131-155`; mapeador em `mappers.ts:330-355` |
| CSAT: gatilho correto | `src/app/(workspace)/conversas/actions.ts:313-325` → `inbox-auto-messages.ts:182-232` |
| CSAT: saída silenciosa | `src/infrastructure/whatsapp/inbox-auto-messages.ts:220` |
| Falha de envio engolida | `src/infrastructure/whatsapp/auto-reply.ts:118-120` |
| Cálculo do CSAT | `src/core/domain/csat.ts:27-70`; agregação em `analytics-repository.ts:261-331` |
| Tempo de 1ª resposta | `src/infrastructure/repositories/prisma/conversation-repository.ts:154-171` |
| Tempo de resolução | `src/infrastructure/repositories/prisma/conversation-repository.ts:224-250` |
| Variáveis só como texto | `src/features/configuracoes/components/sections/canned-responses-section.tsx:29-32` |
| Resposta rápida sem interpolação | `src/features/conversas/components/composer.tsx:247-250` |
| Protocolo aleatório | `src/infrastructure/whatsapp/wa-store.ts:395-401` e `:627-633` |
| Nome mascarado aceito | `src/infrastructure/whatsapp/worker/session.ts:1046-1048`, `:1065-1067`, `:1204-1206`, `:1230` |
| Sessões ativas fictícias | `src/infrastructure/seed/settings.ts:278-300`; leitura em `settings-repository.ts:278` |
| Encerrar sessão não revoga | `src/infrastructure/repositories/prisma/settings-repository.ts:1023-1045` |
| `revokeAllSessions` órfã | `src/infrastructure/auth/session.ts:80-87` |
| Botão desabilitado por `planned()` | `src/app/(workspace)/perfil/page.tsx:44`; helper em `src/components/ui/planned.ts:13-17` |
| 2FA mock | `src/features/configuracoes/components/sections/security-section.tsx:44, 128, 140-152, 160-174` |
| Políticas sem efeito | `src/features/configuracoes/components/sections/security-section.tsx:45-46, 255-303` |
| Auditoria só lida | `src/infrastructure/repositories/prisma/settings-repository.ts:178-182` |
| Notificações só semeadas | `src/infrastructure/seed/notifications.ts:8, 17, 26, 35` |
| Único produtor de notificação | `src/infrastructure/automations/automation-effects.ts:172-186` |
| `kind` inválido | `src/infrastructure/automations/automation-effects.ts:178` |
| SLA nunca escrito | `src/infrastructure/seed/conversations.ts:105-106, 302` (únicas escritas) |
| Switcher cosmético | `src/components/layout/workspace-switcher.tsx:24, 55-58` |
| Molde de provisionamento | `src/app/(auth)/actions.ts:165-270` |
| `availableAccounts` já resolvido | `src/infrastructure/auth/session.ts:143-147, 204` |
| `act` no JWT | `src/infrastructure/auth/tokens.ts:23, 51-60` |
| `assignmentMethod` nunca aplicado | gravado em `settings-repository.ts:319`, lido em `:215`, sem consumidor |
| Distribuição e macros na UI | `automations-section.tsx:57-58, 423-575, 585-700` |
| Logo da barra é `S` em gradiente | `src/components/layout/navigation-rail.tsx:212-223` |
| Logo da marca no login | `src/features/auth/components/auth-split-layout.tsx:25` |
| GIF no avatar | `src/core/domain/image-upload.ts:12-17`; texto em `profile-view.tsx:199` |
| `dateFormat` gravado e nunca lido | `company-section.tsx:379-389`; `src/lib/datetime.ts` não o consome |
| Descrições dos KPI com travessão | `src/infrastructure/repositories/prisma/analytics-repository.ts:276, 308, 329` |
| Placeholders `—` legítimos | `csat.ts:70`; `analytics-repository.ts:576-577`; `settings-repository.ts:274` |
