# Solint CRM — Regras Globais de Código, Arquitetura e Segurança

> **Fonte de verdade técnica e operacional do Solint CRM.**
> Todas as alterações na base de código devem seguir estritamente as diretrizes deste documento.

---

## 1. Princípios e Arquitetura Limpa

O Solint CRM adota uma arquitetura em camadas orientada a domínio (Clean Architecture / Hexagonal Ports & Adapters), garantindo desacoplamento total entre as regras de negócio e os frameworks web/bancos de dados.

### 1.1 Diagrama de Dependência de Camadas

```
┌─────────────────────────────────────────────────────────┐
│                      UI & Framework                     │
│  src/app/  ·  src/features/  ·  src/components/         │
└──────────────────────────┬──────────────────────────────┘
                           │ consome (Server/Client Comp.)
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Inversão de Controle                   │
│             src/infrastructure/container.ts             │
└──────────────┬───────────────────────────┬──────────────┘
               │ instancia adaptadores     │ injeta portas
               ▼                           ▼
┌─────────────────────────────┐   ┌───────────────────────┐
│       Infraestrutura        │   │     Casos de Uso      │
│  src/infrastructure/        │   │  src/core/use-cases/  │
│  (Repositories/Adapters)    │   └───────────┬───────────┘
└──────────────┬──────────────┘               │ executa regras
               │ implementa                   ▼
               │                  ┌───────────────────────┐
               └─────────────────►│     Domínio Puro      │
                                  │   src/core/domain/    │
                                  │   src/core/ports/     │
                                  └───────────────────────┘
```

### 1.2 Regras Fundamentais de Dependência
1. **Direção única**: dependências sempre apontam para dentro (`core` não conhece nada fora de si).
2. **SRP (Single Responsibility Principle)**: cada arquivo possui uma única responsabilidade clara. Páginas e Server Components nunca executam lógica de negócio diretamente.
3. **DIP (Dependency Inversion Principle)**: Casos de uso dependem exclusivamente de interfaces (`ports`), nunca de implementações concretas (`infrastructure`).
4. **Composition Root**: Somente `src/infrastructure/container.ts` conhece e instancia classes concretas.

---

## 2. Convenções de Código e TypeScript Strict

1. **TypeScript Strict Total**: Ativar `strict: true` e `noUncheckedIndexedAccess: true`. Proibido o uso de `any` ou `as unknown as Type`.
2. **Type-Only Imports**: Sempre utilizar `import type { ... }` para tipos e interfaces, evitando acoplamento de runtime e melhorando a eficiência do bundler.
3. **Imutabilidade por Padrão**: Tipos de domínio e props de componentes devem usar `readonly` e `ReadonlyArray`/`readonly T[]`.
4. **Nomenclatura**:
   - Arquivos e diretórios: `kebab-case.ts(x)`
   - Componentes React e Tipos/Interfaces: `PascalCase`
   - Funções, variáveis e Server Actions: `camelCase` (sufixo `Action` para Server Actions)
   - Constantes globais e registros: `UPPER_SNAKE_CASE`

---

## 3. Pureza do Domínio (`src/core/`)

A pasta `src/core/` representa o coração das regras de negócio do Solint CRM.

1. **Isolamento Absoluto**: É estritamente proibido importar qualquer módulo de `@/app`, `@/features`, `@/components`, `@/infrastructure`, `react`, `next` ou bibliotecas de terceiros (exceto utilitários puros de domínio) dentro de `src/core/`.
2. **Garantia por Lint**: Esta regra é assegurada via configuração do ESLint (`eslint.config.mjs`). Nenhuma exceção deve ser adicionada.
3. **Modelagem Expressiva**: Use Value Objects e entidades com validação e métodos puros para expressar o comportamento do negócio.

---

## 4. Regras de Negócio Invioláveis

As regras a seguir são fundamentais e nunca devem ser contornadas na interface ou no backend:

### 4.1 Notas Internas Nunca Saem para o Canal Externo
- Mensagens marcadas com `isPrivate: true` são notas internas destinadas exclusivamente aos colaboradores da equipe.
- O caso de uso `sendMessage` e o adaptador de canal rejeitam qualquer tentativa de despachar uma nota interna para provedores de WhatsApp, Instagram, Telegram ou Email.

### 4.2 Janela de 24 Horas do WhatsApp (HSM Window)
- Conforme a política da Meta (WhatsApp Cloud API), mensagens livres só podem ser enviadas se o cliente tiver interagido nas últimas 24 horas (`isHsmWindowOpen`).
- Fora da janela de 24h, o envio de texto livre é bloqueado no domínio, exigindo o uso de um modelo aprovado (`template_hsm`).

### 4.3 Dinheiro Sempre em Centavos Inteiros
- Valores monetários em transações, oportunidades de negócio e faturamento são representados exclusivamente como inteiros em centavos (`amountInCents`).
- Proibido o uso de números de ponto flutuante (`float`) para dinheiro no domínio e armazenamento. Formatações como `R$ 1.250,00` são responsabilidade exclusiva da camada de apresentação (`formatMoneyFromCents`).

### 4.4 Isolamento Multi-Tenant Estrito
- Toda consulta, mutação, agregação e listagem em repositórios deve obrigatoriamente exigir e filtrar por `accountId`.
- Nenhum registro pode ser compartilhado ou acessado entre tenants distintos.

### 4.5 Autorização e RBAC Centralizados
- A verificação de permissões deve sempre utilizar a função pura `can(session, permission)` definida em `src/core/domain/user.ts`.
- Proibido espalhar checagens manuais de `role === 'admin'` pela interface ou controladores.

---

## 5. Gestão de Segredos e Variáveis de Ambiente

1. **Segredos no Servidor**: Segredos como chaves de API, credenciais de banco de dados e segredos de assinatura (`SESSION_SECRET`, `WEBHOOK_SIGNING_SECRET`) nunca devem ser expostos com o prefixo `NEXT_PUBLIC_`.
2. **Diretiva `server-only`**: Arquivos de infraestrutura e provedores de sessão devem incluir `import 'server-only'` no topo para impedir empacotamento acidental no bundle do cliente.
3. **Entropia de Sessão**: `SESSION_SECRET` deve conter no mínimo 32 caracteres criptograficamente seguros em ambientes de produção.
4. **Mascaramento de Tokens**: Tokens de API de saída para integrações são gerados com hash no backend e exibidos na UI sempre mascarados (ex: `sk_live_****9c2f`). O segredo em texto puro nunca retorna do servidor após a criação.

---

## 6. Segurança em Aplicações Web

### 6.1 Validação Rigorosa em Toda Fronteira de Entrada (Server Actions & Webhooks)
- Todo dado vindo do cliente é tratado como **não confiável**.
- Toda Server Action deve receber parâmetro tipado como `unknown` e validá-lo via schema **Zod** (`safeParse`) antes de chamar qualquer caso de uso ou porta de domínio:
```typescript
const inputSchema = z.object({
  conversationId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(4096),
  isPrivate: z.boolean(),
});
```
- Mensagens de erro de validação devem ser sanitizadas, sem expor stack traces ou detalhes internos de infraestrutura ao usuário.

### 6.2 Gerenciamento Seguro de Sessões e Cookies
- Cookies de autenticação devem ser configurados com as flags `HttpOnly`, `SameSite=Lax` (ou `Strict`) e `Secure` (em produção).
- A verificação de identidade e permissões é revalidada a cada requisição de Server Component/Action no servidor.

### 6.3 Cabeçalhos de Segurança (Security Headers)
O `next.config.ts` aplica cabeçalhos de segurança obrigatórios em todas as respostas:
- **Content-Security-Policy (CSP)**
- **Strict-Transport-Security (HSTS)**
- **X-Frame-Options: DENY**
- **X-Content-Type-Options: nosniff**
- **Referrer-Policy: strict-origin-when-cross-origin**
- **Permissions-Policy**: restrição de microfone, câmera e geolocalização.

---

## 7. Acessibilidade e Design System

1. **Conformidade WCAG 2.1 AA**:
   - Todas as tabelas devem possuir `<caption>` acessível para leitores de tela.
   - Botões com ícones devem incluir atributo `aria-label` ou texto de suporte.
   - Controles de alternância (`Toggle`) devem utilizar `role="switch"` e `aria-checked`.
   - Foco visual global sempre visível (`:focus-visible`).
2. **Tokens de Design (Tailwind CSS v4)**:
   - Proibido o uso de cores hexadecimais literais inline nos componentes (ex: `#168CFF`, `#EF4444`).
   - Sempre utilize tokens do design system (`bg-surface`, `text-ink`, `text-muted`, `border-line`, `tone="blue"`, `bg-brand-gradient`).
3. **Modo Escuro Corporativo**:
   - Todas as telas e componentes devem ter suporte impecável aos modos claro (`:root`) e escuro (`:root[data-theme="dark"]`).
   - A alternância de tema é gerenciada via `localStorage` (chave `solint-theme`) e aplicada sem layout shift ou flash de tela.
4. **Respeito a Movimento Reduzido**:
   - Estilos respeitam a media query `prefers-reduced-motion: reduce`.

---

## 8. Checklist de Pull Request e Qualidade

Antes de submeter ou aprovar qualquer alteração:

- [ ] `npm run typecheck` passa sem nenhum erro de tipagem.
- [ ] `npm run lint` executa sem warnings ou violações de regras arquiteturais.
- [ ] `npm run build` compila com sucesso em modo de produção (rotas tipadas e Server Components válidos).
- [ ] Nenhuma cor hexadecimal literal foi introduzida diretamente na camada de componentes.
- [ ] Toda Server Action valida a entrada utilizando Zod.
- [ ] Nenhuma regra de negócio (notas internas, HSM, centavos) foi violada.
- [ ] Suporte a tema claro e escuro validado visualmente.
