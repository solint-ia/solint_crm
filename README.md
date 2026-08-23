# Solint CRM — Sistema de Atendimento Omnichannel

O **Solint CRM** é uma plataforma moderna de atendimento omnichannel focada em WhatsApp, combinando caixa de entrada multiatendente, funil de vendas (Kanban), agentes de IA autônomos, disparos de campanhas em massa e relatórios avançados de desempenho e CSAT.

Desenvolvido com **Next.js 15 + React 19 + TypeScript Strict + Tailwind CSS v4**, o sistema segue os princípios de **Clean Architecture / Hexagonal Architecture (Ports & Adapters)**, permitindo fácil substituição da camada de dados in-memory por um backend HTTP/SQL de produção sem alterar a interface.

---

## 1. Stack Tecnológica

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, Server Components, Server Actions, `typedRoutes`)
- **Biblioteca de UI**: [React 19](https://react.dev/)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/) (Modo estrito total + `noUncheckedIndexedAccess`)
- **Estilização e Design System**: [Tailwind CSS v4](https://tailwindcss.com/) com tokens em CSS variables (`globals.css`) e suporte a modo claro e escuro corporativo
- **Validação de Esquemas**: [Zod](https://zod.dev/) em todas as Server Actions e fronteiras de entrada
- **Ícones**: [Lucide React](https://lucide.dev/)
- **Tipografia**: Sora (display/títulos), Inter (corpo/UI), JetBrains Mono (código, telefones, protocolos)

---

## 2. Estrutura do Projeto

```
src/
├── core/                         # DOMÍNIO PURO (Isolado de React, Next e Infra)
│   ├── domain/                   # Entidades, Value Objects e regras de negócio
│   │   ├── ai-agent.ts           # Configuração, sandbox e logs de IA
│   │   ├── analytics.ts          # Métricas, KPIs e relatórios
│   │   ├── campaign.ts           # Campanhas, templates WhatsApp e variáveis
│   │   ├── channel.ts            # Canais (WhatsApp, Instagram, Webchat, etc.)
│   │   ├── contact.ts            # Contatos e Value Object PhoneNumber (E.164)
│   │   ├── conversation.ts       # Conversas, status, prioridade, janela HSM 24h
│   │   ├── message.ts            # Mensagens polimórficas e notas internas
│   │   ├── pipeline.ts           # Funis, etapas e cards de oportunidade
│   │   ├── settings.ts           # Automações, macros, faturamento e auditoria
│   │   └── user.ts               # Usuários, papéis, permissões e função can()
│   ├── ports/                    # Interfaces de repositório (DIP / ISP)
│   └── use-cases/                # Casos de uso injetados com portas
│
├── infrastructure/               # ADAPTADORES E IMPLEMENTAÇÕES CONCRETAS
│   ├── container.ts              # Composition Root: injeta implementações nas portas
│   ├── repositories/in-memory/   # Repositórios in-memory com store em globalThis
│   └── seed/                     # Dados de demonstração ricos e realistas
│
├── app/                          # ROTAS FINAS E SERVER COMPONENTS
│   ├── (auth)/                   # Grupo de autenticação: login, cadastro, recuperação, onboarding
│   ├── (workspace)/              # Shell autenticado: navigation rail de 64px + conteúdo
│   │   ├── conversas/            # Caixa de entrada 4 colunas (chat em tempo real)
│   │   ├── dashboard/            # KPIs gerais, gráficos e pendências
│   │   ├── relatorios/           # Série temporal, desempenho de agentes, funil, CSAT
│   │   ├── kanban/               # Pipeline de vendas com drag-and-drop nativo
│   │   ├── contatos/             # CRM de contatos com importação CSV e perfil
│   │   ├── agentes-ia/           # Gestão de agentes de IA, sandbox e logs
│   │   ├── campanhas/            # Disparos em massa e wizard de nova campanha
│   │   ├── configuracoes/        # Central de configurações com 9 seções
│   │   └── perfil/               # Preferências do usuário, status e workspaces
│   ├── globals.css               # Design tokens (claro/escuro) e Tailwind v4
│   └── layout.tsx                # Root layout com fonts e script anti-flash de tema
│
├── features/                     # COMPONENTES E HOOKS POR FUNCIONALIDADE
│   ├── auth/                     # Layout split, login, cadastro, onboarding
│   ├── conversas/                # Chat, composer público/privado, painel lateral
│   ├── dashboard/                # Gráficos, rankings, seletores de período
│   ├── kanban/                   # Board, cards, modal de etapas
│   ├── contatos/                 # Tabela, importação CSV, histórico
│   ├── agentes-ia/               # Formulários de persona, sandbox, fluxo
│   ├── campanhas/                # Wizard 4 etapas com pré-visualização WhatsApp
│   ├── configuracoes/            # Navegação lateral e seções do hub
│   └── perfil/                   # Cartão de perfil e controle de sessão
│
├── components/                   # COMPONENTES REUTILIZÁVEIS
│   ├── ui/                       # Design system (Button, Badge, Card, Modal, Toggle...)
│   ├── domain/                   # Tradutores visuais de domínio (Badges de canal/status)
│   └── layout/                   # NavigationRail, Topbar, PageShell, ThemeToggle
│
├── config/                       # CONFIGURAÇÃO DE APLICAÇÃO
│   └── navigation.ts             # Fonte única de navegação global e seções
│
└── lib/                          # UTILITÁRIOS
    ├── cn.ts                     # Mesclagem de classes CSS (clsx + tailwind-merge)
    ├── format.ts                 # Formatação de moeda, números e datas
    ├── search-params.ts          # Parsers seguros para estado na URL
    └── theme.ts                  # Persistência e sincronização de tema (claro/escuro)
```

---

## 3. Como Rodar o Projeto

### Pré-requisitos
- **Node.js**: `>= 20.11.0`
- **Gerenciador de pacotes**: `npm`

### Comandos Disponíveis

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento (http://localhost:3000)
npm run dev

# 3. Verificação de tipos TypeScript
npm run typecheck

# 4. Verificação de linting e regras de pureza do domínio
npm run lint

# 5. Formatação de código
npm run format

# 6. Compilar bundle de produção
npm run build

# 7. Iniciar servidor em produção
npm run start
```

---

## 4. Como Plugar um Backend Real

Toda a injeção de dependências do sistema ocorre exclusivamente no arquivo `src/infrastructure/container.ts`.

Para conectar uma API REST, GraphQL, Supabase ou banco de dados relacional:
1. Crie uma classe adaptadora em `src/infrastructure/repositories/http/` (ou `database/`) que implemente a interface da porta correspondente em `src/core/ports/` (ex: `ConversationRepository`, `ContactRepository`).
2. Substitua a instanciação no arquivo `src/infrastructure/container.ts`.
3. Nenhuma tela (`src/app/**`) ou componente de UI (`src/features/**`) precisa ser modificado.

---

## 5. Regras de Negócio e Diretrizes Globais

O desenvolvimento no Solint CRM é regido pelo documento **[REGRAS-GLOBAIS.md](file:///c:/Users/andre/Downloads/Solint%20CRM/REGRAS-GLOBAIS.md)**, que detalha:
- **Janela de 24h do WhatsApp (HSM)** e bloqueio de envio de texto livre fora da janela
- **Notas internas privadas** (`isPrivate: true`) que nunca são despachadas aos provedores externos
- **Valores monetários sempre em centavos inteiros** (`amountInCents`)
- **Isolamento multi-tenant obrigatório por `accountId`**
- **Autorização centralizada via `can(session, permission)`**
- **Validação obrigatória de entrada com Zod em todas as Server Actions**
- **Conformidade com acessibilidade (WCAG AA) e ausência de cores hex literais na UI**

Para o histórico completo de requisitos e protótipo original, consulte **[CONTEXTO-HANDOFF.md](file:///c:/Users/andre/Downloads/Solint%20CRM/CONTEXTO-HANDOFF.md)** e **[CONTEXTO-MIGRACAO-NEXTJS.md](file:///c:/Users/andre/Downloads/Solint%20CRM/CONTEXTO-MIGRACAO-NEXTJS.md)**.
