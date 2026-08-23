# Solint CRM — Handoff da migração para Next.js

> Documento de continuidade escrito em 21/08/2026 por Claude Code.
> Objetivo: permitir que outro agente (Antigravity) continue exatamente de onde parei.
> O documento do protótipo original continua em `CONTEXTO-HANDOFF.md` (telas, regras de negócio,
> backend a construir). Este arquivo cobre **só a migração para Next.js**.

---

## 1. Situação em uma frase

O protótipo Claude Design (10 arquivos `.dc.html`) foi reescrito como app **Next.js 15 + React 19 +
TypeScript strict + Tailwind CSS v4**, com arquitetura em camadas (domínio → portas → casos de uso →
infraestrutura → UI). **7 das 12 rotas estão prontas.** Faltam 5 rotas, o arquivo de regras globais,
o README e a movimentação dos arquivos antigos para `legado/`.

**O build ainda NÃO passa** — ver seção 6 (bloqueios conhecidos). É esperado: `typedRoutes` do Next
rejeita `<Link>` apontando para rotas que ainda não existem.

---

## 2. Como rodar

```bash
npm install          # já executado; dependências em node_modules
npm run dev          # http://localhost:3000  → redireciona para /conversas
npm run typecheck    # tsc --noEmit (passava na última verificação)
npm run build        # FALHA hoje: rotas faltantes (seção 6)
npm run lint
npm run format
```

Node >= 20.11. Windows + PowerShell/Git Bash.

---

## 3. Arquitetura adotada (respeitar ao continuar)

```
src/
├── core/                    ← DOMÍNIO PURO. Proibido importar React, Next ou infraestrutura.
│   ├── domain/              entidades, tipos, value objects e regras (13 arquivos)
│   ├── ports/               interfaces de repositório (DIP + ISP)
│   └── use-cases/           casos de uso; recebem portas por injeção
│
├── infrastructure/          ← ADAPTADORES. Único lugar que conhece implementações concretas.
│   ├── seed/                dados de demonstração extraídos dos .dc.html
│   ├── repositories/in-memory/   implementam as portas; store em globalThis
│   └── container.ts         composition root (troque aqui para plugar API real)
│
├── app/                     ← ROTAS FINAS. Server Components carregam dados via container.
│   ├── (workspace)/         shell autenticado: rail + conteúdo
│   └── layout/error/not-found/page
│
├── features/<feature>/      ← UI por funcionalidade (components + hooks). Client Components aqui.
├── components/ui/           ← design system genérico (Button, Badge, Modal, Toggle...)
├── components/domain/       ← componentes que traduzem estado de domínio em cor/rótulo
├── components/layout/       ← NavigationRail, Topbar, PageShell, ThemeToggle
├── config/navigation.ts     ← fonte única da navegação (rail + seções de configurações)
└── lib/                     ← cn, format, theme, search-params
```

### Regras que os arquivos já seguem (mantenha)

- **SRP**: um arquivo = uma responsabilidade. Página nunca contém lógica de negócio.
- **OCP**: nada de `switch (canal)` na UI — consulte `CHANNEL_REGISTRY` e os mapas em
  `src/components/domain/presentation-maps.ts`.
- **LSP/ISP**: portas pequenas (`ConversationReader` vs `ConversationWriter`).
- **DIP**: casos de uso dependem de interfaces; só `container.ts` instancia classes concretas.
  O ESLint bloqueia import de `react`/`next`/`@/infrastructure` dentro de `src/core`.
- **Sem cor literal na UI**: sempre token (`bg-surface`, `text-muted`, `tone="amber"`). Tokens em
  `src/app/globals.css` (`:root` e `:root[data-theme="dark"]`, mapeados em `@theme inline`).
- **Dinheiro em centavos** (`amountInCents`), formatado só na borda (`formatMoneyFromCents`).
- **Toda Server Action valida a entrada com zod** antes de tocar no domínio.
- **Multi-tenant**: todo acesso a repositório filtra por `accountId`.
- **Acessibilidade**: `aria-label` em ícones, `role="switch"` nos toggles, `<caption>` nas tabelas,
  foco visível global, `prefers-reduced-motion` respeitado.

---

## 4. O que JÁ está pronto

### 4.1 Configuração de projeto
| Arquivo | Conteúdo |
|---|---|
| `package.json` | scripts dev/build/lint/typecheck/format; deps: next 15, react 19, zod, clsx, tailwind-merge, lucide-react, server-only |
| `tsconfig.json` | strict + `noUncheckedIndexedAccess` + alias `@/*` |
| `next.config.ts` | `typedRoutes`, `poweredByHeader:false` e **cabeçalhos de segurança** (CSP, HSTS, X-Frame-Options, Permissions-Policy...) |
| `eslint.config.mjs` | `next/core-web-vitals` + regra que isola `src/core` de framework/infra |
| `.env.example` | APP_ENV, NEXT_PUBLIC_APP_URL, DATA_SOURCE, API_BASE_URL, SESSION_SECRET, WEBHOOK_SIGNING_SECRET |
| `.gitignore`, `.prettierrc.json`, `.prettierignore`, `postcss.config.mjs` | prontos |

### 4.2 Domínio (`src/core/domain/`)
`shared` (Id, Result, DomainError), `channel` (registro de canais + Inbox), `label` (tons),
`user` (User/Role/Account/Session/Permission + `can()`), `contact` (+ VO `PhoneNumber` E.164),
`message` (conteúdo polimórfico, `isPrivate`), `conversation` (status, prioridade, **`isHsmWindowOpen`
= regra da janela de 24h**, `matchesScope`, `PRIORITY_WEIGHT`), `pipeline` (`isDealStale`, `sumDeals`),
`ai-agent`, `campaign` (`rate`, `renderTemplate`), `analytics`, `notification`, `settings`.

### 4.3 Casos de uso (`src/core/use-cases/`)
`listConversations`, `sendMessage` (permissão + vazio + limite 4096 + janela HSM + nota interna
nunca sai pro canal), `changeConversationStatus`, `moveDeal` (valida etapa ∈ funil), `listContacts`.

### 4.4 Infraestrutura
Seeds fiéis ao protótipo: 8 contatos, 7 conversas (com nota interna, áudio+transcrição, falha de
envio, colisão de agente, canal offline, SLA estourado), 2 funis + 9 oportunidades, 3 agentes de IA,
5 campanhas + 3 templates + 3 segmentos, KPIs/relatórios, 4 notificações, settings completo
(automações, macros, respostas rápidas, conexões, webhooks, tokens, equipes, atributos, faturamento,
auditoria, sessões). Repositórios in-memory implementam todas as portas. `container.ts` amarra tudo.

### 4.5 Rotas prontas
| Rota | Arquivo | Observações |
|---|---|---|
| `/` | `src/app/page.tsx` | redireciona para `/conversas` |
| `/conversas` | `(workspace)/conversas/page.tsx` | layout 4 colunas, sem topbar; lista com escopo/status/ordenação/busca, chat com banners (HSM, canal offline, colisão), composer público/nota, painel de contexto. Server Actions: `sendMessageAction`, `changeConversationStatusAction` |
| `/dashboard` | `(workspace)/dashboard/page.tsx` | 5 KPIs, gráfico de volume acessível, canais, ranking, funil, pendências, atalhos; período via `?periodo=` |
| `/relatorios` | `(workspace)/relatorios/page.tsx` | abas `?aba=conversas\|agentes\|funil\|csat` |
| `/kanban` | `(workspace)/kanban/page.tsx` | drag-and-drop nativo, soma por coluna, alerta de card parado, painel de detalhe, modal de etapas, funil via `?funil=`; action `moveDealAction` |
| `/contatos` e `/contatos/[id]` | `(workspace)/contatos/...` | tabela com seleção, busca, importar CSV (modal com mapeamento + progresso + erros), perfil com linha do tempo |
| `/agentes-ia` e `/agentes-ia/[id]` | `(workspace)/agentes-ia/...` | lista com métricas; abas Configuração/Conhecimento/Transferência/Fluxo/Teste/Logs; toggles e sandbox de teste com actions |
| `/campanhas` | `(workspace)/campanhas/page.tsx` | aviso de poucos templates aprovados, painel de acompanhamento em tempo real, tabela de campanhas |

### 4.6 Design system
Tokens claro/escuro completos (SKILL.md §2.3), fontes Sora/Inter/JetBrains Mono via `next/font`,
script anti-flash de tema em `src/lib/theme.ts`, alternância persistida em `localStorage`
(chave `solint-theme`), primitivos em `src/components/ui/`.

---

## 5. O QUE FALTA (na ordem recomendada)

Eu estava construindo as features na ordem: Conversas → Dashboard/Relatórios → Kanban → Contatos →
Agentes IA → Campanhas → **[PAREI AQUI]** → Configurações → Auth/Onboarding/Perfil → docs → legado.

### 5.1 `/campanhas/nova` — quase pronto, só falta a página
Os componentes do wizard **já existem**:
- `src/features/campanhas/components/campaign-wizard.tsx` (wizard 4 etapas completo)
- `src/features/campanhas/components/wizard-steps.tsx`
- `src/features/campanhas/components/template-preview.tsx`

Falta criar `src/app/(workspace)/campanhas/nova/page.tsx` (a pasta `nova/` já existe, vazia):
Server Component que carrega `container.campaigns.listSegments()` + `listTemplates()`, renderiza
Topbar (título "Nova campanha", link de voltar) + `<CampaignWizard segments templates />`.
Seguir o padrão de `campanhas/page.tsx`.

### 5.2 `/configuracoes` — não iniciada
Fonte: `Configuracoes.dc.html` (o maior arquivo) + seed pronto em `src/infrastructure/seed/settings.ts`
(TUDO já modelado: automations, macros, cannedResponses, assignmentMethod, connections, webhooks,
apiTokens, members, roles, teams, labels, customAttributes, billing, auditLog, activeSessions).
- Sub-navegação lateral: usar `SETTINGS_SECTIONS` de `src/config/navigation.ts` (9 seções), seção
  ativa via `?secao=` (padrão das outras telas: estado na URL, `parseOneOf` de `src/lib/search-params.ts`).
- Seções: Automações (toggles → `container.settings.setAutomationEnabled` via Server Action + método
  de atribuição via `setAssignmentMethod`), Integrações (galeria de conexões com
  `CONNECTION_STATUS_TONE/LABEL` de `presentation-maps.ts`, webhooks, tokens mascarados), Equipe
  (membros/papéis/equipes), Etiquetas, Respostas rápidas, Atributos, Empresa, Faturamento
  (usar `ProgressBar` para uso do plano), Segurança (2FA toggle, sessões ativas, log de auditoria).

### 5.3 Grupo `(auth)` — não iniciado (a pasta `src/app/(auth)/` existe, vazia)
Fonte: `Login.dc.html` e `Onboarding.dc.html`. Criar:
- `src/app/(auth)/layout.tsx` — split: lado esquerdo com gradiente `bg-brand-gradient` + marca
  (copie o visual do Login.dc.html), lado direito com o formulário.
- `/login`, `/cadastro`, `/recuperar-senha` (páginas separadas, não abas). Demo do protótipo:
  qualquer email + senha vazia ou "solint" entra → redirect `/dashboard`; outra senha → erro de
  credenciais. Implementar como Server Action com zod; estados de loading/erro como no protótipo.
  Cadastro tem indicador de força de senha e leva a `/onboarding`.
- `/onboarding` — wizard 4 etapas (Empresa → Canal com QR Code fake "aguardando pareamento" →
  Equipe com convites por email (pulável) → Conclusão → `/conversas`). Reaproveitar o padrão visual
  de `wizard-steps.tsx`.

### 5.4 `/perfil` — não iniciado
Fonte: `Perfil.dc.html`. Dentro de `(workspace)`. Dados do usuário da sessão
(`container.session.getCurrentSession()`), seletor de disponibilidade (Disponível/Ocupado/Ausente —
refletir no avatar da rail exigiria estado compartilhado; aceitável deixar local por ora), assinatura,
alteração de senha (só UI), preferências de notificação (Toggles), idioma/tema, troca de workspace,
"sair de todas as sessões".

### 5.5 `REGRAS-GLOBAIS.md` — PEDIDO EXPLÍCITO DO USUÁRIO, ainda não criado
O usuário pediu "um arquivo md incluindo regras globais de código e segurança". Vários comentários
no código já referenciam seções dele (buscar por `REGRAS-GLOBAIS.md` em `src/` para alinhar a
numeração!): §3 pureza do domínio, §4 regras de negócio/dinheiro em centavos, §5 segredos/env,
§6 segurança web, §6.1 validação de entrada em Server Actions, §6.2 sessão. Estrutura sugerida:
1. Princípios (SOLID aplicado ao projeto, mapa de camadas e dependências permitidas)
2. Convenções de código (TS strict, nomenclatura, imports type-only, sem cor literal, tokens)
3. Arquitetura (domínio puro; regra ESLint que o garante)
4. Regras de negócio invioláveis (nota interna nunca sai pro canal; janela HSM 24h; dinheiro em
   centavos; multi-tenant por accountId; RBAC via `can()`)
5. Segredos e configuração (.env nunca versionado, SESSION_SECRET ≥ 32 chars, secrets só no servidor)
6. Segurança de aplicação web (CSP/HSTS já no next.config.ts; validação zod em toda fronteira;
   erros sem stack trace pro usuário; tokens de API mascarados; HMAC em webhooks; auditoria)
7. Acessibilidade (WCAG AA, foco visível, aria, reduced-motion)
8. Checklist de PR

### 5.6 `README.md` — criar
Visão geral, stack, como rodar, estrutura de pastas, como plugar backend real (trocar adaptadores
no `container.ts`), link para `REGRAS-GLOBAIS.md`.

### 5.7 Mover protótipo para `legado/` — ÚLTIMO PASSO (pedido do usuário)
Só depois de `npm run build` passar:
```bash
mkdir -p legado
git mv/mv Agentes-IA.dc.html Campanhas.dc.html Configuracoes.dc.html Contatos.dc.html \
  Conversas.dc.html Dashboard.dc.html Kanban.dc.html Login.dc.html Onboarding.dc.html \
  Perfil.dc.html support.js .thumbnail uploads legado/
```
Manter `CONTEXTO-HANDOFF.md` na raiz (referência de produto) ou mover junto — decisão livre.
`tsconfig`/`eslint`/`prettierignore` já excluem `legado/`.

### 5.8 Verificação final
```bash
npm run typecheck && npm run lint && npm run build && npm run dev
```
Testar as 12 rotas nos 2 temas. Não há testes automatizados ainda (sugerir vitest para
`src/core/**` como melhoria futura — casos de uso são puros e fáceis de testar).

---

## 6. Bloqueios conhecidos (estado real do build)

1. **`npm run build` falha por `typedRoutes`**: links para rotas ainda inexistentes
   (`/perfil` na rail, `/campanhas/nova`, possivelmente `/login`). Erro visto:
   `"/dashboard" is not an existing route` em `navigation-rail.tsx` — esse já se resolveu quando
   criei `/dashboard`; os restantes somem quando as rotas de 5.1–5.4 existirem. NÃO contornar com
   `as Route` nos links da rail; criar as rotas.
2. **`npm run typecheck` hoje acusa erros de `Route`/`RouteImpl`** em links e em
   `src/config/navigation.ts`. Causa: os tipos de rota gerados em `.next/types` estão desatualizados
   (foram gerados quando só existiam poucas rotas). Corrige-se rodando `npx next typegen` (ou um
   `npm run dev`/`npm run build` que chegue à fase de geração de tipos) depois de criar as rotas que
   faltam. Os erros de `/configuracoes` e `/perfil` só somem quando essas rotas existirem (5.2/5.4).
3. Heredocs no Git Bash do Windows quebram com apóstrofos/acentos em pt-BR — por isso os seeds
   estão sem acentos. Nos componentes novos, texto de UI pode ter acento se escrito via Write tool.

## 7. Decisões já tomadas (não reabrir)

- Tailwind v4 (`@theme inline` em globals.css), sem tailwind.config.js.
- Estado de navegação na URL (`?periodo=`, `?aba=`, `?funil=`, `?secao=`) — compartilhável e SSR.
- Dados: in-memory com seed; troca por HTTP acontece SÓ em `container.ts`.
- Drag-and-drop nativo (HTML5), sem lib externa.
- Ícones: lucide-react. Sem lib de gráficos (gráficos são divs acessíveis).
- Textos de UI em pt-BR, código/identificadores em inglês... exceto domínios de negócio
  já em pt (status 'aberta', 'pendente' etc.) para casar com o protótipo.
