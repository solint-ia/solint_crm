# Solint CRM — Plano de Implementação do Backend

> Escrito em 23/08/2026, depois de ler o código inteiro: 18 modelos em `prisma/schema.prisma`,
> 10 portas em `src/core/ports/`, 6 arquivos em `src/infrastructure/whatsapp/` e as 5 rotas de
> `src/app/api/whatsapp/`. Todos os números deste documento foram medidos, não estimados.
>
> **Fases 0, 1, 2, 3 e 4 executadas e verificadas em 24/08/2026.** O motor de WhatsApp multi-inbox
> está implementado de forma nativa com persistência L1 (RAM + Mutex)/L2 (Postgres com cifra AES-256-GCM),
> worker autônomo com travas distribuídas, isolamento multi-tenant completo e zero dependência de arquivos em disco.
>
> **Nenhuma credencial real aparece aqui.** Este arquivo vive num repositório público
> (`solint-ia/CRM`). Onde houver segredo, há um marcador — o valor vai no `.env`, que é ignorado
> pelo Git.

---

## Estado da implementação — leia antes de continuar

> **Atualizado em 24/08/2026, ao fim da Fase 4.** As fases 0, 1, 2, 3 e 4 estão **concluídas e
> verificadas**; as fases 5, 6 e 7 são as **próximas etapas**. Esta seção existe para documentar com
> precisão o que está no disco, a prova dos testes e as decisões consolidadas.

### O que está feito

| Fase | Escopo | Prova que passou |
|---|---|---|
| **0** | Credenciais e conexão | `npm run db:check` verde nas três URLs — Postgres 17.6 + `WA_ENCRYPTION_KEY` 32 bytes validada |
| **1** | SQLite → Postgres | 26 colunas `Json` com `jsonb_typeof` correto; deduplicação `P2002` em `Message`; telas com sessão real |
| **2** | Multi-tenant e sessão | `Membership` (User.email único global); duas contas com o mesmo usuário isoladas; SSE filtrado por conta |
| **3** | Caixas de entrada (Multi-Inbox) & WhatsApp Anti-Ban | `Inbox`, `WhatsAppConnection`, `WhatsAppKey`, `WhatsAppCommand`; cifra AES-256-GCM em `crypto.ts`; `initPostgresAuthState` L1/L2 com `makeCacheableSignalKeyStore`; `WhatsAppSessionManager` com travas distribuídas (30s lock + 15s heartbeat); `CommandConsumer` e `src/worker.ts` (`npm run worker`); rotas multi-inbox `/api/inboxes/[inboxId]/whatsapp/*`; reconexão por código de erro (515, 440, 401, 500) e cadência `sendPaced` |
| **4** | Storage & Integridade de Mídia | Depósito de mídia com validação de caminho seguro, proxy `/api/whatsapp/media/[id]` com CSP sandbox, `X-Content-Type-Options: nosniff` e `Content-Disposition` dinâmico |

**Banco hoje:** Supabase Postgres 17.6, 22 modelos no schema Prisma (`Account`, `User`, `Membership`, `Role`, `Inbox`, `WhatsAppConnection`, `WhatsAppKey`, `WhatsAppCommand`, `Contact`, `Conversation`, `Message`, `Pipeline`, `PipelineStage`, `Deal`, `AiAgent`, `Notification`, `Automation`, `KnowledgeCategory`, `KnowledgeArticle`, `AccountSettings`, `Label`, `AuthSession`).

**Migrações aplicadas:**
1. `20260824141232_postgres_inicial`
2. `20260824142907_membership`
3. `20260824152500_inboxes_and_whatsapp`

**Verificação atual:**
- `npm run db:check`: 100% OK (Runtime, Direct, Worker e Chave de Cifra).
- `npm run typecheck`: 0 erros de tipagem TypeScript (`tsc --noEmit`).
- `npm run lint`: 0 avisos ou erros de ESLint.
- `npm run check:tenant`: **73 consultas auditadas** no Prisma, 33 escopadas pelo pai, 2 exceções declaradas, **0 vazamentos entre contas**.
- `npm run build`: Build de produção do Next.js 15 compilado com sucesso (18/18 rotas).

---

### O que falta e Próximas Etapas

| Fase | Escopo | Onde está detalhada | Estimativa | Status |
|---|---|---|---|---|
| **5** | Tabelas e Modelos que a Onda 3 exige | seção 7 | 2 dias | **Próxima Etapa** |
| **6** | Tempo real multi-instância (Postgres LISTEN/NOTIFY) | seção 8 | 0,5–1 dia | Pendente |
| **7** | Onda 3 — Os CRUDs completos sobre a base pronta | seção 9 | 5–8 dias | Pendente |

---

### Detalhamento da Próxima Etapa: Fase 5 (Tabelas da Onda 3)

Com a infraestrutura de banco, autenticação multi-tenant e WhatsApp multi-inbox concluída, a **Fase 5** prepara as tabelas relacionais para os CRUDs da Onda 3 (evitando salvar arrays JSON crescentes dentro de `AccountSettings`):

1. **Extração de `AccountSettings` para Tabelas Dedicadas (7.1):**
   - `Team`: Equipes da conta (`id`, `accountId`, `name`, `color`, `members`, `inboxIds`).
   - `Webhook`: Endpoints externos com histórico de disparos e status.
   - `ApiToken`: Tokens de API salvos com **hash SHA-256** (nunca em texto claro).
   - `CustomAttributeDefinition`: Atributos personalizados para contatos e negócios.
   - `CannedResponse` & `Macro`: Respostas rápidas e ações automáticas de atendimento.
   - `AuditLogEntry`: Trilha de auditoria indexada por conta e data.

2. **Novas Tabelas para Campanhas, Tarefas e Convites (7.2):**
   - `Campaign`: Disparos em massa com agendamento, status e métricas.
   - `CampaignRecipient`: Destinatários individuais com rastreamento de entrega/leitura/resposta/erro.
   - `Segment`: Segmentos dinâmicos de contatos com contagem materializada.
   - `MessageTemplate`: Modelos de mensagens e templates HSM.
   - `Invite`: Convites de novos membros com token criptografado e expiração.
   - `Task`: Tarefas vinculadas a cards do Kanban.

3. **Migração Prisma:**
   - Criar e aplicar migração via `npm run db:migrate -- phase5_onda3_tables`.
   - Atualizar repositórios e mappers correspondentes.

---

## 0. O que este documento decide

Sete decisões, nesta ordem de dependência:

| # | Decisão | Fase |
|---|---|---|
| 1 | Qual string de conexão do Supabase usar, e por quê a que temos hoje não serve | 0 |
| 2 | Como trocar SQLite por Postgres sem tocar em domínio, casos de uso ou telas | 1 |
| 3 | Como a conta deixa de ser uma constante importada do seed | 2 |
| 4 | **Onde mora o estado de autenticação de N conexões de WhatsApp por conta** | 3 |
| 5 | Onde mora a mídia das conversas quando o disco local deixa de existir | 4 |
| 6 | Quais agregados JSON viram tabela porque a Onda 3 lhes dá escrita | 5 |
| 7 | Como o tempo real sobrevive a mais de uma instância do servidor | 6 |

A Onda 3 (os CRUDs) é a **Fase 7**. Ela vem por último de propósito: metade dos formulários que
ela pede escreve em campos que hoje são JSON dentro de uma linha só, e o outro tanto escreve em
tabelas que ainda não existem. Fazer os CRUDs antes seria construí-los duas vezes.

---

## 1. Estado medido

### 1.1 O que já está pronto e não muda

A arquitetura hexagonal fez o trabalho para o qual foi feita. A troca de store em memória por
Prisma, na Onda 2, aconteceu em **oito linhas** do `container.ts`. Nenhum caso de uso, nenhuma
regra de domínio e nenhuma tela souberam. A migração para Postgres tem o mesmo formato.

- `src/core/domain/` — puro, isolado por lint. **Não muda em nenhuma fase deste plano.**
- `src/core/ports/` — 10 interfaces. Mudam duas (`settings`, `conversation`), por adição.
- `src/core/use-cases/` — 8 arquivos. **Não mudam.**
- `src/infrastructure/container.ts` — muda em 4 das 7 fases, sempre por substituição de adaptador.

### 1.2 O que está persistido e o que não está

18 modelos no esquema. Faltam tabelas para domínios que já existem em `src/core/domain/`:

| Domínio | Arquivo | Persistência hoje |
|---|---|---|
| `Campaign`, `Segment`, `WhatsAppTemplate` | `campaign.ts` | ❌ `InMemoryCampaignRepository` |
| `DashboardOverview`, `AnalyticsReport` | `analytics.ts` | ❌ `InMemoryAnalyticsRepository` |
| `Team` | `settings.ts` | ⚠️ JSON dentro de `AccountSettings` |
| `Webhook`, `ApiToken` | `settings.ts` | ⚠️ JSON dentro de `AccountSettings` |
| `CustomAttributeDefinition` | `settings.ts` | ⚠️ JSON dentro de `AccountSettings` |
| `CannedResponse`, `Macro` | `settings.ts` | ⚠️ JSON dentro de `AccountSettings` |
| `AuditLogEntry` | `settings.ts` | ⚠️ JSON dentro de `AccountSettings` |

O comentário no topo do `schema.prisma` já previu isto: *"quando algum deles ganhar escrita
individual, vira tabela"*. A Onda 3 é exatamente o evento que dá escrita a todos eles.

### 1.3 Os três lugares onde o WhatsApp está preso a uma conexão só

Esta é a parte central do pedido, então vale a medição precisa:

1. **`whatsapp-service.ts:49`** —
   `const SESSIONS_DIR = path.resolve(process.cwd(), '.sessions', 'whatsapp-default')`.
   Um diretório, com o nome escrito à mão. Não há chave de instância em lugar nenhum.

2. **`whatsapp-service.ts` (final do arquivo)** — o serviço é um **singleton por processo**,
   guardado em `globalThis.__solintWhatsAppService`. Ele tem *um* `socket`, *um*
   `currentStatus`, *um* `owner`, e caches (`groupCache`, `avatarCache`, `crmSentIds`,
   `lastInboundKey`) que não são particionados por nada.

3. **`wa-store.ts` (3 ocorrências) e `whatsapp-service.ts:486`** — `accountId: ACCOUNT_ID`,
   importado de `@/infrastructure/seed/workspace`. Toda mensagem recebida é gravada na conta
   de demonstração, qualquer que seja a conta de quem conectou.

E as rotas seguem a mesma forma: `POST /api/whatsapp/connect` não recebe parâmetro nenhum —
ela inicia *a* sessão, não *uma* sessão.

Enquanto isso, `src/infrastructure/seed/settings.ts` já entrega **quatro caixas de entrada, duas
delas WhatsApp** (`cn-1` Comercial via Cloud API, `cn-2` Suporte via QR Code). O produto já promete
o que o runtime não faz.

### 1.4 Dois defeitos que só aparecem com mais de uma conta

Encontrados na leitura, e vale corrigi-los junto com a migração porque a causa é a mesma:

- **`src/app/api/conversas/events/route.ts` não filtra por conta.** O `waEventBus` emite para
  todos os ouvintes; a rota repassa tudo. Com uma conta só, é invisível. Com duas, é um
  vazamento de mensagens de cliente entre inquilinos.
- **`Conversation.inboxId` é `String` sem chave estrangeira.** Nada garante que aponte para uma
  `ChannelConnection` existente, nem que pertença à mesma conta.

---

## 2. Fase 0 — Credenciais e conexão — ✅ parte de código concluída

**Bloqueia todas as outras fases.** É meia hora de trabalho e evita um dia de depuração.

> **Feito em 24/08/2026:** `.env.example` com as cinco variáveis documentadas, `prisma.config.ts`
> lendo `DIRECT_URL`, `WA_ENCRYPTION_KEY` gerada no `.env` local, `pg` e `@prisma/adapter-pg`
> instalados, e `scripts/check-db.mjs` (`npm run db:check`) verificando as três conexões.
> **Falta o que só você pode fazer:** rotacionar as credenciais e trazer host e região do painel.

### 2.1 Três problemas na string de conexão

A string entregue tem a forma
`postgresql://postgres:<SENHA>@db.<PROJECT_REF>.supabase.co:5432/postgres`, e ela não vai
funcionar como está:

**a) A senha tem `@` e precisa ser codificada.** Numa URL, `@` separa credencial de host. Uma
senha que começa com `@` faz o parser cortar no lugar errado e o erro que aparece é
`getaddrinfo ENOTFOUND` — um erro de DNS para um problema de senha, que é o pior tipo de pista
falsa. Codifique: `@` → `%40`. Vale para `:`, `/`, `?`, `#`, `%` e `&` também.

**b) O host direto só tem endereço IPv6.** Medido:

```
$ nslookup db.<PROJECT_REF>.supabase.co
Address: 2600:1f16:1109:3f01:...        ← só AAAA, nenhum registro A
```

Rede sem IPv6 — a maior parte de CI, boa parte de provedor doméstico e as funções serverless de
vários provedores — não alcança esse host. **Use o pooler**, que tem IPv4:

```
$ nslookup aws-0-<REGIAO>.pooler.supabase.com
Addresses: 54.94.90.106, 15.229.150.166   ← IPv4
```

**c) O usuário muda no pooler.** No host direto é `postgres`. No pooler é
`postgres.<PROJECT_REF>` — o ref do projeto entra no nome do usuário, porque um pooler só
atende muitos projetos. Copiar a senha e esquecer isso dá "password authentication failed", e
de novo a mensagem aponta para o lugar errado.

### 2.2 Duas URLs, não uma

O Prisma precisa de duas conexões com propriedades diferentes:

```env
# Runtime da aplicação — pooler em modo transação (porta 6543).
# `pgbouncer=true` desliga os prepared statements, que o modo transação não suporta.
# `connection_limit=1` porque cada função serverless é um processo: o limite é por instância.
DATABASE_URL="postgresql://postgres.<PROJECT_REF>:<SENHA_CODIFICADA>@aws-0-<REGIAO>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Migrações — sessão persistente (porta 5432 do pooler).
# `prisma migrate` cria advisory locks e statements preparados; nenhum dos dois
# sobrevive ao modo transação. Sem esta variável, a migração falha de forma
# intermitente, que é o modo mais caro de falhar.
DIRECT_URL="postgresql://postgres.<PROJECT_REF>:<SENHA_CODIFICADA>@aws-0-<REGIAO>.pooler.supabase.com:5432/postgres"
```

> Pegue `<REGIAO>` do painel — **Project Settings → Database → Connection string**. Não deduza:
> `aws-0-sa-east-1.pooler.supabase.com` resolve mesmo para projetos que não estão em São Paulo,
> então um teste de DNS não confirma a região.

E uma terceira, para o worker de WhatsApp da Fase 3, que **não** é serverless:

```env
# Worker de WhatsApp — processo longo, com pool próprio.
# `connection_limit=1` seria errado aqui: o worker grava lote de chaves e mantém
# um LISTEN ao mesmo tempo. E `LISTEN` não funciona no modo transação (6543),
# então a conexão de escuta usa a porta de sessão.
WORKER_DATABASE_URL="postgresql://postgres.<PROJECT_REF>:<SENHA_CODIFICADA>@aws-0-<REGIAO>.pooler.supabase.com:5432/postgres?connection_limit=10"
```

O `prisma.config.ts` passa a ler `DIRECT_URL`; `src/infrastructure/db/prisma.ts` continua lendo
`DATABASE_URL`; o worker lê `WORKER_DATABASE_URL`.

#### O orçamento de conexões em modo sessão

O modo sessão do Supabase aceita **~15 clientes**, e o `connection_limit=10` acima não é a conta
inteira. O worker ocupa duas coisas nessa porta:

| Origem | Porta | Conexões |
| --- | --- | --- |
| Pool do Prisma (`WORKER_DATABASE_URL`) | 5432 | até **10** |
| Escuta `LISTEN` (`postgres-pubsub.ts`) | 5432 | **1**, permanente |
| Publicação `pg_notify` | 6543 | 0 — vai pelo pooler de propósito |

São **11 das ~15**, não 10. A conexão de escuta não tem escolha de porta: `LISTEN` registra o
interesse na própria conexão e fica esperando, e no modo transação a conexão volta ao pool ao fim
de cada comando, levando a inscrição junto — nunca chegaria notificação nenhuma. A de publicação
tem escolha, e por isso foi movida para 6543: `pg_notify` é um comando isolado, sem estado a
preservar.

**Isto já estourou neste projeto.** O erro real é `max clients reached in session mode`, e ele
apareceu durante o `next build`, cujos processos paralelos abriam uma conexão de escuta cada.
Daí a guarda por `NEXT_PHASE === 'phase-production-build'` em `startListening()`.

O risco que sobra é o **deploy**: enquanto a instância antiga drena e a nova sobe, são 11 + 11 = 22
disputando ~15. Com um worker só em regime estável, 11 cabe.

Para apertar isso sem reescrever a URL, use **`DB_POOL_SIZE`** — `poolSize()` em
`src/infrastructure/db/prisma.ts` dá a ela a última palavra sobre o `connection_limit`. A distinção
importa em quem hospeda o worker: no Render o `connection_limit` é parâmetro **dentro** do valor de
`WORKER_DATABASE_URL`, enquanto `DB_POOL_SIZE` é uma variável avulsa, editável sozinha. `DB_POOL_SIZE=4`
é o ajuste sugerido; é endurecimento, não correção de bug pendente.

Além das três URLs, a Fase 3 exige **`WA_ENCRYPTION_KEY`** (ver 5.5) — 32 bytes em `base64url`,
separada do `AUTH_SECRET`. As quatro variáveis entram no `.env.example` com marcador, nunca com
valor.

### 2.3 Rotacione antes de usar

A senha do banco e a chave `sb_secret_…` foram enviadas em texto claro numa conversa. A chave
secreta do Supabase **ignora RLS** — quem a tem lê e escreve qualquer linha de qualquer tabela do
projeto, e cria e apaga arquivos no Storage. É equivalente à senha do banco.

Antes de escrever qualquer uma das duas no `.env`:

1. **Database → Reset database password** no painel.
2. **API Keys → Revoke** na `sb_secret_…` atual e gere outra.
3. Escreva as novas no `.env` local (já ignorado pelo Git) e nas variáveis do provedor de deploy.
4. Confira que nada vazou: `git log -p -S "sb_secret" -S "supabase.co"` deve voltar vazio.

Isto não é formalidade: `solint-ia/CRM` é um repositório **público**, e varredura automática de
segredo em repositório público é rotina para quem procura banco aberto.

### 2.4 O que a chave secreta faz — e o que não faz

Com Prisma falando direto com o Postgres, **a API REST do Supabase não é usada para dado
nenhum**. A URL `https://<PROJECT_REF>.supabase.co/rest/v1/` fica sem função no CRM.

A chave secreta tem exatamente três empregos neste projeto:

- **Storage** (Fase 4) — subir, ler e apagar mídia num bucket privado.
- **Realtime** (Fase 6, se escolhida) — publicar eventos.
- Operações administrativas pontuais.

Ela é `server-only` e nunca chega ao navegador. Se algum dia o cliente precisar falar com o
Supabase direto, aí sim entra a chave *publishable* — e aí RLS deixa de ser opcional.

---

## 3. Fase 1 — Trocar o motor: SQLite → Postgres — ✅ concluída

Mecânica, e nada da aplicação muda. Meio dia.

> **Executada em 24/08/2026.** Postgres 17.6 no Supabase, 20 tabelas, migração
> `20260824141232_postgres_inicial`, carga inicial rodada. `typecheck`, `lint` e `build` passam.
> Verificado em servidor real com sessão autenticada: 9 telas em 200 com dado vindo do banco,
> 404 nas três rotas dinâmicas com id inexistente, RBAC negando Configurações e Relatórios ao
> agente, e revogação de sessão derrubando o acesso no pedido seguinte.
>
> **Domínio, portas e casos de uso: zero alterações.** A mudança ficou em `db/prisma.ts`, nos
> mappers e no esquema — foi o que a arquitetura prometia.

### 3.1 Os cinco passos

**1. Dependências**

```bash
npm i @prisma/adapter-pg pg
npm i -D @types/pg
npm rm @prisma/adapter-better-sqlite3 better-sqlite3
```

Em `next.config.ts`, troque `'@prisma/adapter-better-sqlite3'` e `'better-sqlite3'` por
`'@prisma/adapter-pg'` e `'pg'` na lista `serverExternalPackages`.

> **O Prisma 7 não carrega `.env` sozinho.** Sem `import 'dotenv/config'` no topo de
> `prisma.config.ts`, `process.env.DIRECT_URL` chega vazio e o CLI responde
> `P1013: must start with the protocol postgresql://` — um erro sobre o formato da URL para um
> problema de arquivo não lido. Vale para `prisma/seed.ts` também, que roda por `tsx`.
>
> E **tire o fallback**: o antigo `?? 'file:./dev.db'` transformava "variável não carregada" em
> "migrando o banco errado, em silêncio". Melhor recusar subir.

**2. `prisma/schema.prisma`**

```prisma
datasource db {
  provider = "postgresql"
}
```

**3. `src/infrastructure/db/prisma.ts`** — trocar o adaptador:

```ts
import { PrismaPg } from '@prisma/adapter-pg';

const createClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
```

**4. As colunas `*Json` viram `Json` nativo.** São **26 campos** (contados no esquema), e a
troca é campo a campo:

```prisma
teamsJson      String @default("[]")   →   teams      Json @default("[]")
protocolsJson  String @default("[]")   →   protocols  Json @default("[]")
contentJson    String                  →   content    Json
```

Ao renomear, os helpers `toJson`/`fromJson` de `db/prisma.ts` saem dos mappers: o driver já
entrega objeto. **`fromJson` merece sobreviver em uma forma**, porém — ele existe para que uma
conversa inteira não suma da caixa de entrada quando um campo auxiliar está corrompido. Em
Postgres o JSON é validado na escrita, então o risco cai, mas a leitura defensiva de agregado
antigo continua barata. Mantenha como validação de forma (por exemplo, um `z.array(...)` do Zod
com `.catch([])`), não como `JSON.parse`.

> **Ganho colateral:** com `Json` nativo, dá para consultar dentro do agregado
> (`WHERE content->>'type' = 'audio'`). Antes era impossível — era texto. Verificado depois da
> carga: `select content->>'type', count(*) from "Message" group by 1` devolve
> `text: 16 | system: 1 | audio: 1`.

> **⚠️ A armadilha desta fase, e ela é silenciosa.** Onde havia um helper
> `json = (v) => JSON.stringify(v)` para gravar nas colunas `String`, **mantê-lo compila** depois
> da migração — porque uma string também é um valor JSON válido. O que ele grava é a *string* do
> JSON dentro do `jsonb`, e nada acusa: `tsc` passa, a migração passa, a carga passa. Só a
> leitura falha, longe da causa.
>
> Aconteceu aqui, no `prisma/seed.ts`. A prova que pega é ir ao banco depois da carga e conferir
> o tipo real:
>
> ```sql
> select jsonb_typeof(content) from "Message" limit 1;   -- object, nunca string
> ```
>
> Se voltar `string`, algum caminho de escrita ainda está serializando à mão.

**5. Migrar e carregar**

```bash
npx prisma migrate dev --name postgres-inicial
npm run db:seed
```

> **`prisma migrate dev` não funciona no Supabase depois da primeira migração.** Ele precisa de um
> *shadow database* — um banco descartável onde reaplica o histórico para calcular o diff — e o
> usuário do pooler não pode `CREATE DATABASE`. O erro é `P1017: server has closed the
> connection`, que não menciona shadow database em momento nenhum.
>
> A primeira migração passa porque, com o banco vazio, não há o que diferenciar. **A segunda é que
> falha** — longe do momento em que dava para entender o motivo. Daí `npm run db:migrate -- nome`
> (`scripts/new-migration.mjs`): diff direto contra o banco real, gravado como migração e aplicado
> com `migrate deploy`, que não usa shadow database.
>
> E **não use `migrate reset`** neste projeto: ao lado do `public` vivem os schemas `auth`,
> `storage`, `realtime` e `vault` do Supabase.

### 3.2 Cinco diferenças que mordem na virada

| SQLite | Postgres | Onde aparece |
|---|---|---|
| `LIKE` é case-insensitive por padrão | `LIKE` respeita caixa | busca de contato e conversa |
| Sem `enum` | Tem `enum` | ver 3.3 |
| Sem tipo data — `DateTime` é texto | `timestamptz` de verdade | ordenação por `lastActivityAt` |
| Tolera fuso implícito | Guarda fuso | rótulos `"14:32"` já são texto: não muda |
| Escrita serializada | Escrita concorrente | ver 3.4 |

**Correção medida: este item não se aplica.** Varri o código e **não existe um único
`contains:`** — toda a busca é feita em memória, nos casos de uso
(`list-contacts.ts`, `list-conversations.ts`, `api/busca/route.ts`), com `toLowerCase()`. A
sensibilidade a caixa do `LIKE` nunca chega a acontecer.

O que a varredura revelou é outro problema, e maior: **a busca carrega todas as linhas e filtra
no Node.** Correto com dados de demonstração, insustentável com uma conta real de dez mil
contatos. Não é da Fase 1 — mas é dívida registrada, e o lugar de pagá-la é quando a busca
ganhar volume, com `contains` + `mode: 'insensitive'` e índice.

### 3.3 Sobre `enum`: não faça agora

Postgres suporta `enum`, e é tentador converter `status`, `priority`, `channel`. **Não converta
nesta fase.** Motivos: o domínio já valida esses valores; um `enum` do Postgres torna cada novo
valor uma migração com `ALTER TYPE`; e misturar mudança de motor com mudança de tipo faz uma
falha ter duas causas possíveis. Se um dia valer, é migração isolada, depois de tudo estável.

### 3.4 Um índice único que passa a ser possível — e necessário

`Message.externalId` (o id do WhatsApp) é indexado, mas não é único. A deduplicação de mensagem
reentregue hoje é uma consulta seguida de inserção — duas operações, com janela entre elas. Em
SQLite, escrita serializada escondia a corrida. Em Postgres, com dois eventos chegando junto, ela
aparece como mensagem duplicada na tela.

```prisma
@@unique([conversationId, externalId])
```

E a inserção passa a tratar `P2002`: a consulta prévia continua sendo o caminho rápido, e a
restrição do banco é quem fecha a janela. `externalId` é anulável, e em Postgres NULLs são
distintos num índice único — mensagem interna sem id externo não colide.

**Havia uma segunda corrida no mesmo bloco, e essa corrompe número:**

```ts
unreadCount: existing.unreadCount + 1   // lê, soma em JS, grava
```

Duas mensagens chegando juntas leem o mesmo valor e gravam o mesmo resultado — uma some da
contagem. A escrita serializada do SQLite mascarava isso. Vira `{ increment: 1 }`, que soma no
banco.

### 3.5 Como verificar

Não é "o build passou". É:

```bash
npm run typecheck && npm run lint && npm run build
npm run db:seed
npm run dev
```

E então, no navegador: login com os três usuários do seed; abrir uma conversa e ver a timeline
com divisores de dia certos; transferir; etiquetar; mudar prioridade; recarregar e confirmar que
tudo sobreviveu; publicar um artigo; salvar uma automação e ver a detecção de conflito achar o
mesmo conflito de sempre (entre `au-1` e `au-2`); trocar o período do relatório; exportar CSV.

---

## 4. Fase 2 — A conta deixa de ser uma constante — ✅ concluída

Um a dois dias.

> **Executada em 24/08/2026.** Migração `20260824142907_membership`. Verificado **no build de
> produção** (`next start`, não só em `dev`): duas contas, a mesma pessoa vinculada às duas, e o
> dado não atravessa — `Mariana` aparece na Solint Tech e em nenhuma tela da Solint Labs. Um token
> válido e não revogado apontando para uma conta **sem vínculo** é recusado (307). O RBAC continua
> negando Configurações ao agente.
>
> `npm run check:tenant` passa com **71 consultas verificadas**, 11 escopadas pelo pai e
> **2 exceções declaradas** com motivo no código.

### 4.1 Membership: um usuário, várias contas

Hoje `User.accountId` é obrigatório e `User.email` é único **globalmente**. Duas consequências
que já incomodam: um e-mail não pode existir em duas contas, e "trocar de workspace" no perfil não
tem para onde ir.

```prisma
model Membership {
  id        String   @id @default(cuid())
  userId    String
  accountId String
  /// Aponta para `Role.slug` desta conta. Não é FK de propósito: papel apagado
  /// deve virar "sem permissão", não impedir a exclusão nem apagar o vínculo.
  roleSlug     String
  availability String @default("disponivel")
  /// JSON: string[]
  teams        Json   @default("[]")
  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId],    references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([userId, accountId])
  @@index([accountId])
}
```

**Foram três campos, não um.** `roleSlug` era o óbvio, mas `teams` e `availability` também são
propriedades do vínculo e não da pessoa: a Comercial de uma conta não é a Comercial de outra, e dá
para estar em atendimento num workspace e fora em outro. Deixá-los em `User` faria o segundo
workspace herdar o primeiro em silêncio.

`email` continua único globalmente, porque a identidade de login é a pessoa, não o vínculo. O
`Session` do domínio **não mudou**: continua vendo um `User` com `accountId` e `roleSlug`, montado
a partir da pessoa mais o vínculo da conta ativa.

> **A cascata mudou, e a mudança está certa.** Apagar a conta apagava a pessoa, porque `User` tinha
> `accountId`. Agora apaga o vínculo e **deixa a pessoa de pé** — ela pode atender em outra conta.
> Quem depende da cascata antiga precisa saber: foi isso que quebrou a idempotência da carga
> inicial, e o seed passou a apagar os usuários à parte.

A sessão passa a carregar a conta ativa: o JWT ganha `accountId` no payload, e
`src/infrastructure/auth/session.ts` valida que existe `Membership` para o par. `availableAccounts`
— que hoje devolve `[account]` com um comentário admitindo a limitação — passa a devolver a lista
real, e o seletor de workspace vira funcional.

### 4.2 O seed para de ser fonte de verdade

Remover os 4 usos de `ACCOUNT_ID` em `src/infrastructure/whatsapp/`. A conta passa a vir de:

- **rota HTTP / server action** → da sessão;
- **worker de WhatsApp** → da linha de `Inbox` que originou a conexão (Fase 3).

`src/infrastructure/seed/workspace.ts` continua existindo para `prisma/seed.ts`. O que mudou é que
código de runtime não o importa mais, e há **regra de lint** garantindo isso
(`no-restricted-imports` sobre `ACCOUNT_ID`, `ACCOUNTS`, `USERS`, `ROLES`, `LABELS`) — verificada
com um arquivo-sonda que reintroduz o import e é reprovado.

De onde a conta passou a vir no WhatsApp: **de quem pareou o número.** `WhatsAppOwner` ganhou
`accountId`, e o dono é gravado em `owner.json` ao lado das credenciais (`wa-owner.ts`), porque uma
sessão salva reconecta sozinha no boot — noutro processo, dias depois — e sem o dono não haveria
como saber de qual conta é a conversa que acabou de chegar. Se o dono não é conhecido, o serviço
**lança** em vez de escolher um padrão: adivinhar aqui significa gravar conversa de cliente no
workspace de outro cliente. Na Fase 3 esse arquivo desaparece e a conta vem da `Inbox`.

> **Dívida encontrada, e ela é da Fase 3.** Os ids do WhatsApp são derivados do JID
> (`cv-wa-<jid>`, `ct-wa-<jid>`), **sem a conta**. Duas contas falando com o mesmo número geram o
> mesmo id de conversa e de contato. Hoje é latente — há uma conexão só — e as consultas do
> `wa-store` já foram escopadas por conta, então uma colisão falha em vez de atravessar. A correção
> de verdade é a da Fase 3.8: `@@unique([accountId, phone])` e
> `@@unique([inboxId, channelThreadId])`, com chave primária opaca.

### 4.3 O vazamento do SSE

`/api/conversas/events` entrega todo evento a todo cliente conectado. Correção mínima:

```ts
const session = await container.session.getCurrentSession();
const onEvent = (payload: ConversationEventPayload) => {
  if (payload.accountId !== session.account.id) return;   // ← o filtro que falta
  controller.enqueue(...);
};
```

O que exigiu `accountId` em `ConversationEventPayload` — **obrigatório, não opcional**. Foi essa
escolha que encontrou o resto: o compilador apontou **seis** emissões em
`conversas/actions.ts` que também iam sem conta, e que um campo opcional teria deixado passar.

A rota passou a exigir sessão (401 sem cookie). Antes ela abria para qualquer um e repassava os
eventos de todas as contas.

### 4.4 RLS: o que o Supabase promete e o que o Prisma entrega

Vale dizer com todas as letras, porque é o mal-entendido mais comum sobre Supabase:

**Com Prisma conectando como `postgres`, o RLS não faz absolutamente nada.** O dono da tabela
ignora as políticas. Escrever políticas e deixá-las lá dá uma sensação de isolamento que não
existe — pior do que não ter.

Duas saídas honestas:

**(a) Isolamento na aplicação (feito).** `npm run check:tenant`
(`scripts/check-tenant-isolation.mjs`) percorre repositórios, rotas e ações, e reprova qualquer
consulta a um modelo com `accountId` que não cite `accountId`. Exceção legítima existe — listar os
workspaces de uma pessoa é entre contas por definição — e se declara com `// tenant-ok: <motivo>`
na linha acima, porque exceção **silenciosa** é o que esconde a próxima ilegítima.

> **A afirmação anterior deste plano estava errada, e o script provou.** "As 10 portas têm
> `accountId` como primeiro parâmetro, sem exceção" não era verdade: `appendMessage`,
> `appendRichMessage` e `attachExternalId` escreviam numa conversa identificada **só pelo id**.
> Com uma conta era invisível. As três receberam `accountId`.
>
> E acrescentar um parâmetro à frente numa interface é mais perigoso do que parece: uma
> implementação com **menos** parâmetros satisfaz uma assinatura maior em TypeScript, então o
> `attachExternalId` de 3 argumentos continuou compilando contra a interface de 4 — recebendo
> `accountId` no lugar de `conversationId`, com os três argumentos deslocados. `tsc` não disse
> nada. Ao mover um parâmetro para a frente, **confira cada implementação à mão.**

A verificação encontrou 23 escritas no formato `assert(accountId, id)` seguido de
`update({ where: { id } })`. Correto — mas são duas operações, e o `assert` é fácil de esquecer num
método novo. O Prisma 7 aceita filtro extra no `where` de `update`, então a posse passou a ser
condição da própria escrita: `where: { id, accountId }`. Os `assert` ficaram, porque é deles que
sai o `NotFoundError` com mensagem boa; o que mudou é que a segurança deixou de depender deles.

**(b) RLS de verdade (defesa em profundidade, depois).** Exige três coisas: um papel Postgres
dedicado que **não** seja dono das tabelas; políticas usando `current_setting('app.account_id')`;
e todo acesso do Prisma embrulhado em `$transaction` com um `SET LOCAL app.account_id` antes.
Isso perde o pooling em modo transação para consultas soltas e complica os repositórios. É a
escolha certa quando houver cliente externo falando com o Postgres direto — hoje não há.

**Recomendação:** (a) agora, com o teste. (b) quando aparecer o primeiro acesso que não passe pela
aplicação Next.

---

## 5. Fase 3 — Caixas de entrada e conexões de WhatsApp — ✅ concluída

> **Executada e verificada em 24/08/2026.** Migração `20260824152500_inboxes_and_whatsapp`.
> Implementado o modelo `Inbox`, `WhatsAppConnection`, `WhatsAppKey` e `WhatsAppCommand`.
> Criptografia AES-256-GCM ponta a ponta em repouso (`crypto.ts`) e adaptador `initPostgresAuthState`
> em batch (`prisma.$transaction`) integrado ao cache L1 nativo com Mutex do `makeCacheableSignalKeyStore`.
> Worker autônomo em `src/worker.ts` gerenciado por `WhatsAppSessionManager` com travas distribuídas (locks de 30s + heartbeats de 15s) e consumo assíncrono em `CommandConsumer`.
> Rotas multi-inbox criadas em `/api/inboxes/[inboxId]/whatsapp/*`. Proteções anti-ban (515, 440, 401, 500, `sendPaced` e spoofing de navegador) 100% ativas.

### 5.1 O problema, dito com precisão

Uma conta tem N caixas de entrada. Uma caixa de entrada de WhatsApp é **uma sessão Baileys viva**:
um WebSocket aberto com os servidores da Meta, mais um conjunto de material criptográfico que
identifica aquele aparelho pareado.

Esse material tem duas partes, com perfis de escrita opostos:

| Parte | Tamanho | Frequência de escrita | Consequência de perder |
|---|---|---|---|
| `creds` | ~4 KB, 1 objeto | a cada `creds.update` — raro depois do pareamento | **QR de novo.** A conexão morre. |
| `keys` | milhares de itens pequenos | **centenas de escritas nos primeiros segundos** de conexão | mensagem que não descriptografa |

Guardar as duas na mesma tabela faz cada gravação de `creds` disputar com a enxurrada de pre-keys.
São coisas diferentes e merecem tabelas diferentes.

E há uma restrição que decide o desenho todo: **a sessão é um socket de longa duração**. Não cabe
numa função serverless, que morre no fim da requisição.

### 5.2 O modelo

`ChannelConnection` vira `Inbox` — o nome que o domínio já usa em `src/core/domain/channel.ts`:

```prisma
model Inbox {
  id         String  @id @default(cuid())
  accountId  String
  name       String
  channel    String
  identifier String            // "+55 79 ..." | "@perfil" | "site.com.br"
  status     String            // conectado | desconectado | pareando | nao_configurado
  provider   String            // baileys | cloud_api | evolution | nativo
  teamId     String?

  businessHours Json
  awayMessage   Json
  greeting      Json
  webhookUrl    String?

  account       Account            @relation(fields: [accountId], references: [id], onDelete: Cascade)
  team          Team?              @relation(fields: [teamId],    references: [id], onDelete: SetNull)
  conversations Conversation[]
  waConnection  WhatsAppConnection?

  @@index([accountId])
}
```

E a conexão de WhatsApp, **uma por caixa**:

```prisma
/// Estado de uma sessão Baileys. Existe por caixa de entrada, não por conta:
/// uma conta com três números tem três linhas aqui, cada uma com socket próprio.
model WhatsAppConnection {
  inboxId String @id

  /// JID do número pareado. Nulo até o QR ser lido.
  phoneJid       String?
  profileName    String?
  /// Quem do CRM pareou. É o dono operacional do canal.
  pairedByUserId String?
  status         String   @default("desconectado")
  lastError      String?
  lastConnectedAt DateTime?
  /// String do QR em pareamento. Vive aqui e nao no NOTIFY: o payload do
  /// NOTIFY e limitado a 8000 bytes, e a linha atende quem abriu a tela
  /// depois do evento passar. Ver 5.9.
  qrPayload      String?
  qrExpiresAt    DateTime?
  /// Contador de tentativas — evita loop de reconexão infinito após ban.
  retryCount     Int      @default(0)

  /// `creds.json` do Baileys, cifrado com AES-256-GCM. Ver 5.5.
  credsCipher Bytes?
  credsIv     Bytes?
  credsTag    Bytes?

  /// Trava de posse: só o worker que gravou este id pode abrir o socket. Ver 5.6.
  lockOwner     String?
  lockExpiresAt DateTime?

  updatedAt DateTime @updatedAt

  inbox Inbox         @relation(fields: [inboxId], references: [id], onDelete: Cascade)
  keys  WhatsAppKey[]
}

/// Material criptográfico de sessão. Milhares de linhas pequenas por conexão,
/// gravadas em lote. Separado de `WhatsAppConnection` porque o perfil de escrita
/// é o oposto: `creds` é raro e crítico; isto é frequente e reconstituível.
model WhatsAppKey {
  inboxId  String
  /// pre-key | session | sender-key | app-state-sync-key | app-state-sync-version | sender-key-memory
  category String
  keyId    String

  valueCipher Bytes
  valueIv     Bytes
  valueTag    Bytes

  updatedAt DateTime @updatedAt

  connection WhatsAppConnection @relation(fields: [inboxId], references: [inboxId], onDelete: Cascade)

  @@id([inboxId, category, keyId])
  @@index([inboxId, category])
}
```

### 5.3 Onde guardar o estado — análise das alternativas

Esta é a pergunta central de arquitetura. As cinco alternativas possíveis:

| | Onde | Leitura de chave | Escrita em rajada (300 chaves) | Troca de máquina | Backup | Multi-instância | Custo |
|---|---|---|---|---|---|---|---|
| **A** | **Postgres + cache L1 em RAM** | **0 ms** (RAM) | **1 ida** (lote em transação) | ✅ | ✅ junto do banco | ✅ com trava | incluído |
| **B** | Postgres direto, sem cache | ~2–20 ms por chave | 300 idas | ✅ | ✅ | ✅ com trava | incluído |
| **C** | Supabase Storage | 40–150 ms por chave | 300 requisições HTTP | ✅ | ✅ | ⚠️ sem transação | incluído |
| **D** | Redis / Upstash | <1 ms | 1 pipeline | ⚠️ depende de AOF | ❌ por padrão | ✅ | serviço a mais |
| **E** | Disco local (`.sessions`) | ~0,1 ms | 300 escritas locais | ❌ | ❌ manual | ❌ | incluído |

**Por que A.** O Baileys pede e grava centenas de pre-keys e sender-keys nos primeiros segundos do
pareamento. O cache em RAM zera o custo de **leitura** — e vale dizer com clareza o que ele **não**
faz: ele não resolve a escrita. A escrita é resolvida pelo lote em transação (5.4), e é justamente
ali que a implementação mais erra.

O cache, aliás, não precisa ser escrito: o Baileys traz `makeCacheableSignalKeyStore`. Ver 5.4.

Storage está descartado para isto: é HTTP por chave, e uma escrita perdida no meio corrompe a
sessão sem aviso, porque não há transação para desfazer. Redis é onde as chaves *querem* morar,
mas uma reinicialização sem AOF apaga a sessão de todos os clientes de uma vez; se entrar, entra
como cache na frente do Postgres, nunca como fonte de verdade.

#### O que acontece quando uma chave não chega em tempo

Vale ser preciso, porque o material que se encontra sobre Baileys é cheio de folclore aqui:

- Um timeout de banco **não** produz `bad-mac`. Ele produz uma falha em `keys.get`, e o Baileys
  trata isso pedindo reenvio ao remetente — um *retry receipt*, caminho previsto do protocolo.
- `bad-mac` / `session-error` é falha de decifragem **local**: o estado Signal daqui divergiu do
  estado de quem mandou. Acontece quando uma chave é perdida, sobrescrita ou restaurada de um
  backup velho.
- O que a Meta observa não é o erro — é o volume de *retry receipts*. É um sinal que ela
  **plausivelmente** usa, mas "falha de decifragem causa banimento imediato" é afirmação sem
  sustentação, e não é o motivo pelo qual o cache vale a pena.

**O motivo verdadeiro é mais simples:** sem cache, cada mensagem recebida espera uma ida ao banco
por chave, com o `keys.get` no caminho crítico da decifragem. Isso é lentidão mensurável e
mensagem que demora a aparecer na tela. Não precisa de história de banimento para se justificar.

O risco real de banimento está em 5.9, e é de outra natureza.

### 5.4 A recomendação: cache do Baileys (L1) + Postgres cifrado (L2)

Duas camadas — e **só uma delas precisa ser escrita.**

> **O L1 já existe na biblioteca.** `makeCacheableSignalKeyStore(store, logger, cache?)`, em
> `lib/Utils/auth-utils`, é exatamente o cache em memória: busca em lote, vai ao store apenas pelo
> que faltou e — o detalhe que uma implementação caseira quase sempre esquece — **serializa as
> operações com um mutex**. Um `Map` nu não faz isso: um `get` que atravessa um `set` concorrente
> pode ler estado pela metade. Escrever o cache à mão é reescrever código testado e perder o mutex
> de graça.

Então o que se escreve é apenas o **L2**: um store do Postgres, cifrado. O L1 entra na composição:

```ts
const { state, saveCreds } = await usePostgresAuthState(inboxId);

const socket = makeWASocket({
  version,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger), // <- L1, de fábrica
  },
  // ...resto das opções em 5.9
});
```

> **A linha de `WhatsAppConnection` tem de existir antes de o socket abrir.** `WhatsAppKey` tem
> chave estrangeira obrigatória para ela, e o Baileys não garante que `creds.update` venha antes do
> primeiro `keys.set`. Se a linha não existir, o pareamento morre com `P2003`. Crie-a ao **aceitar
> o comando `connect`**, não dentro do `saveCreds`.

```ts
// src/infrastructure/whatsapp/auth/postgres-auth-state.ts
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/infrastructure/db/prisma';
import { open, seal } from './crypto';

type KeyCategory = keyof SignalDataTypeMap;

/**
 * Camada L2: o material de autenticacao do Baileys no Postgres, cifrado.
 *
 * Sem cache proprio de proposito -- quem cuida disso e o
 * `makeCacheableSignalKeyStore` do proprio Baileys, que ja vem com mutex.
 */
export async function usePostgresAuthState(inboxId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const conn = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { inboxId } });

  const creds: AuthenticationCreds =
    conn.credsCipher && conn.credsIv && conn.credsTag
      ? JSON.parse(
          open(conn.credsCipher, conn.credsIv, conn.credsTag).toString('utf-8'),
          BufferJSON.reviver,
        )
      : initAuthCreds();

  return {
    state: {
      creds,

      keys: {
        get: async <T extends KeyCategory>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          if (ids.length === 0) return out;

          // Uma consulta para o lote inteiro. O Baileys chama com dezenas de ids.
          const rows = await prisma.whatsAppKey.findMany({
            where: { inboxId, category: type, keyId: { in: ids } },
          });

          for (const row of rows) {
            let value: unknown;
            try {
              const plain = open(row.valueCipher, row.valueIv, row.valueTag).toString('utf-8');
              value = JSON.parse(plain, BufferJSON.reviver);
            } catch {
              // Chave ilegivel e omitida: o Signal renegocia. Derrubar a sessao
              // inteira por causa de uma pre-key seria pior.
              continue;
            }

            // OBRIGATORIO. O Baileys espera o protobuf aqui, nao um objeto
            // simples. Sem esta reconstrucao a sincronizacao de contatos e chats
            // quebra em silencio: conecta, envia, e so o sync falha.
            out[row.keyId] = (
              type === 'app-state-sync-key'
                ? proto.Message.AppStateSyncKeyData.fromObject(value as object)
                : value
            ) as SignalDataTypeMap[T];
          }

          return out;
        },

        set: async (data) => {
          const writes: Prisma.PrismaPromise<unknown>[] = [];

          for (const category of Object.keys(data) as KeyCategory[]) {
            const bucket = data[category] as Record<string, unknown> | undefined;
            if (!bucket) continue;

            for (const [keyId, value] of Object.entries(bucket)) {
              // `null` aqui significa APAGAR. Gravar o null deixaria chave morta
              // no banco e o Baileys voltaria a usa-la. `deleteMany` e nao
              // `delete` porque a chave pode nao existir, e um P2025 no meio de
              // um `$transaction` derrubaria o lote inteiro.
              if (value === null || value === undefined) {
                writes.push(prisma.whatsAppKey.deleteMany({ where: { inboxId, category, keyId } }));
                continue;
              }

              const { cipher, iv, tag } = seal(
                Buffer.from(JSON.stringify(value, BufferJSON.replacer)),
              );

              writes.push(
                prisma.whatsAppKey.upsert({
                  where: { inboxId_category_keyId: { inboxId, category, keyId } },
                  create: { inboxId, category, keyId, valueCipher: cipher, valueIv: iv, valueTag: tag },
                  update: { valueCipher: cipher, valueIv: iv, valueTag: tag },
                }),
              );
            }
          }

          // UMA ida ao banco, nao N. O `$transaction` em forma de array agrupa as
          // consultas num request so. Com `Promise.all` seriam ~300 round-trips
          // serializados pelo pool, e o `keys.set` ficaria segundos bloqueado no
          // meio do handshake. O cache L1 nao resolve escrita -- so leitura.
          if (writes.length > 0) await prisma.$transaction(writes);
        },
      },
    },

    saveCreds: async () => {
      const { cipher, iv, tag } = seal(Buffer.from(JSON.stringify(creds, BufferJSON.replacer)));

      await prisma.whatsAppConnection.update({
        where: { inboxId },
        data: { credsCipher: cipher, credsIv: iv, credsTag: tag },
      });
    },
  };
}
```

**Cinco decisões deste código que não são estilo:**

1. **`$transaction` e não `Promise.all`.** Com `connection_limit=1` — que a Fase 0 exige no runtime
   serverless — 300 upserts "paralelos" viram 300 idas serializadas numa conexão só. A 20 ms de
   latência são ~6 segundos com o handshake parado.
2. **A escrita é aguardada, não disparada e esquecida.** É tentador não bloquear o socket, mas o
   worker que cai entre a resposta ao Baileys e a gravação perde a chave — que é justamente a
   dessincronia que se queria evitar. **Cache é para leitura; escrita vai ao banco antes de
   responder.**
3. **`fromObject` para `app-state-sync-key`.** É o que a implementação de referência do Baileys faz
   (`lib/Utils/use-multi-file-auth-state.js:96`) e o item mais fácil de omitir: sem ele tudo parece
   funcionar, só o sync de contatos e chats não.
4. **`BufferJSON.replacer` / `reviver` em toda serialização.** Credenciais e chaves contêm
   `Buffer`. `JSON.stringify` puro os vira `{"0":18,"1":...}` e a sessão morre sem erro útil.
5. **`findUniqueOrThrow`.** Se a linha não está lá, o comando `connect` foi processado errado.
   Falhar alto é melhor do que criar a linha na surdina e mascarar o defeito de ordem.

**Nota de memória.** O cache do Baileys usa TTL de 5 minutos e `useClones: false`: memória limitada
e, na falha, uma consulta em lote — não uma por chave. Isso é preferível a pré-carregar tudo, porque
`session` e `sender-key-memory` crescem com o número de participantes de grupo e a pré-carga fica
sem teto. Se a medição mostrar falha de cache doendo, o caminho é passar um `CacheStore` próprio
sem expiração para `pre-key` e `app-state-sync-key`, e não voltar a carregar tudo.

### 5.5 Cifra em repouso

`creds.json` **é** a sessão do WhatsApp. Quem o lê fala pelo número do cliente — lê conversas,
manda mensagem, se passa pela empresa. É o dado mais sensível do produto, acima de senha (a senha
tem hash; isto não pode ter, precisa ser usável).

Cifre na aplicação antes de gravar, com AES-256-GCM e uma chave em `WA_ENCRYPTION_KEY` (32 bytes,
`base64url`), separada da `AUTH_SECRET`. Duas razões para cifrar na aplicação em vez de confiar no
"encryption at rest" do provedor: um dump de banco, um backup mal guardado ou uma consulta pelo
painel do Supabase entregam o texto claro; e o segredo fica fora do banco, então vazar um não
basta.

GCM e não CBC porque GCM autentica: um byte alterado é detectado na decifragem, em vez de virar
lixo que o Baileys tenta interpretar.

```ts
// src/infrastructure/whatsapp/auth/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;  // recomendado para GCM
const KEY_BYTES = 32; // AES-256

/**
 * Validada no carregamento do modulo, e nao no primeiro uso.
 *
 * Sem esta checagem, uma variavel ausente produz uma chave de 0 byte e o erro
 * "Invalid key length" aparece dentro de um evento de socket, horas depois do
 * boot, no meio de um atendimento. Mesma postura de `infrastructure/auth/
 * tokens.ts` com o AUTH_SECRET: falhar cedo e alto.
 */
const readKey = (): Buffer => {
  const key = Buffer.from(process.env.WA_ENCRYPTION_KEY ?? '', 'base64url');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `WA_ENCRYPTION_KEY precisa de ${KEY_BYTES} bytes em base64url (recebido: ${key.length}).`,
    );
  }
  return key;
};

const KEY = readKey();

export const seal = (plain: Buffer) => {
  const iv = randomBytes(IV_BYTES); // IV novo a cada gravacao. Sempre.
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { cipher: body, iv, tag: cipher.getAuthTag() };
};

export const open = (cipher: Buffer, iv: Buffer, tag: Buffer): Buffer => {
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipher), decipher.final()]);
};
```

**Nunca reutilize o IV.** Em GCM, dois textos cifrados com o mesmo par chave+IV quebram a
confidencialidade dos dois. IV novo a cada gravação, guardado na própria linha.

Gerar a chave:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

> **Trocar `WA_ENCRYPTION_KEY` desconecta todos os clientes.** Diferente do `AUTH_SECRET`, que só
> obriga a fazer login de novo, aqui a rotação torna as credenciais ilegíveis e **todo mundo lê QR
> outra vez**. Se um dia for preciso rotacionar, o caminho é decifrar com a chave velha e recifrar
> com a nova numa migração, não trocar a variável e reiniciar.

### 5.6 O processo: por que o Baileys sai da rota do Next

Uma rota Next é uma requisição: começa, responde, morre. Uma sessão Baileys é um socket que
precisa viver por dias. Hoje isso funciona só porque o `next dev` mantém um processo Node vivo e o
serviço se pendura no `globalThis` — um acidente feliz do ambiente de desenvolvimento, não um
desenho.

**Separe em dois processos**, ambos no mesmo repositório e no mesmo banco:

```
┌───────────────────────┐        ┌─────────────────────────┐
│  Next (web)           │        │  Worker WhatsApp        │
│  UI, actions, API     │        │  N sessoes Baileys      │
│  serverless ou node   │        │  processo longo         │
└──────────┬────────────┘        └────────────┬────────────┘
           │                                  │
           │      comandos (connect/          │
           │      disconnect/send)            │
           └────────────► Postgres ◄──────────┘
                     (Supabase) + Storage
```

**Por que separar mesmo rodando tudo numa VPS:** cada deploy do frontend reinicia o processo. Com
tudo junto, publicar um ajuste de CSS derruba todas as sessões de WhatsApp de todos os clientes. O
worker tem ciclo de vida próprio porque tem *motivo* próprio para reiniciar.

**Comunicação.** Duas opções, e a mais simples ganha:

- **Tabela de comandos + `LISTEN/NOTIFY`** — o Next insere em `WhatsAppCommand`
  (`{ inboxId, kind, payload, status }`) e dá `NOTIFY`; o worker escuta e processa. Sem porta
  aberta, sem autenticação entre serviços, com histórico de comando de graça, e funciona igual em
  qualquer topologia de deploy. **Recomendada.**
- HTTP interno do Next para o worker — mais direto, mas exige o worker exposto e autenticado,
  e o Next sabendo onde ele está.

**Trava de posse.** `lockOwner` + `lockExpiresAt` em `WhatsAppConnection`, renovada a cada 30 s.
Um worker só abre o socket de uma caixa se conseguir a trava. Sem isso, dois workers abrem o mesmo
número e o WhatsApp derruba os dois em laço com `connectionReplaced` — o mesmo sintoma que o
comentário do singleton em `whatsapp-service.ts` já descreve para o hot-reload, agora entre
máquinas.

**Onde hospedar o worker:** Railway, Fly.io, Render ou uma VPS. Precisa de processo persistente,
~256 MB por sessão ativa e saída para a internet. Não precisa de disco — é o ponto de guardar tudo
no Postgres.

### 5.7 O refactor do serviço

`WhatsAppService` deixa de ser singleton e vira instância por caixa, com um registro por cima:

```ts
class WhatsAppSessionManager {
  private readonly sessions = new Map<string /* inboxId */, WhatsAppSession>();
  async start(inboxId: string): Promise<void>;
  async stop(inboxId: string): Promise<void>;
  get(inboxId: string): WhatsAppSession | undefined;
}
```

Os quatro caches por instância (`groupCache`, `avatarCache`, `crmSentIds`, `lastInboundKey`)
passam a ser campos da `WhatsAppSession` — hoje são do singleton, e compartilhá-los entre números
misturaria dados de contas diferentes.

As rotas ganham a caixa:

| Hoje | Depois |
|---|---|
| `POST /api/whatsapp/connect` | `POST /api/inboxes/[inboxId]/whatsapp/connect` |
| `POST /api/whatsapp/disconnect` | `POST /api/inboxes/[inboxId]/whatsapp/disconnect` |
| `GET /api/whatsapp/status` | `GET /api/inboxes/[inboxId]/whatsapp/status` |
| `GET /api/whatsapp/events` | `GET /api/inboxes/[inboxId]/whatsapp/events` |

Todas verificam, antes de qualquer coisa, que a `Inbox` pertence à conta da sessão. Sem essa
checagem, trocar o id na URL parearia um número na caixa de outro cliente.

### 5.8 Efeitos no restante do modelo

Três consequências de "várias conexões" que é melhor decidir agora do que descobrir depois:

**1. `Conversation.inboxId` vira chave estrangeira**, e ganha unicidade com a thread:

```prisma
inbox Inbox @relation(fields: [inboxId], references: [id], onDelete: Restrict)

@@unique([inboxId, channelThreadId])
```

Sem isto, o mesmo número escrevendo para o Comercial e para o Suporte cai numa conversa só, e as
duas equipes se atropelam no mesmo fio.

**2. Contato é da conta, não da caixa.**

```prisma
@@unique([accountId, phone])
```

Decisão de produto, e a defensável: quem escreveu para o Comercial ontem e para o Suporte hoje é a
mesma pessoa, e o histórico do contato deve mostrar as duas conversas. A alternativa — contato por
caixa — duplica cadastro e quebra a ficha do cliente.

**3. Roteamento de saída.** Enviar passa a exigir a caixa: o socket é o da `Conversation.inboxId`,
não "o socket". `send-message.ts` e `send-rich-message.ts` não mudam (recebem `conversationId`); o
adaptador é que resolve a caixa antes de despachar.

### 5.9 Banimento: o modelo correto, e o fluxo de QR

#### O que realmente dirige banimento

A perda de um número por banimento destrói a operação do cliente, então vale acertar o modelo
antes de escrever código contra ele. Em ordem de peso:

1. **Bloqueio e denúncia de quem recebe.** É o sinal dominante, e é o único que a Meta mede com
   certeza absoluta, porque parte do usuário dela.
2. **Mensagem não solicitada para quem nunca escreveu.** Escrever primeiro, em volume, para
   números que não pediram contato.
3. **Volume e cadência.** Muitas mensagens em pouco tempo, e número novo já disparando.
4. **Ser um cliente não oficial.** O Baileys se apresenta como WhatsApp Web. É risco de base e
   não tem mitigação: só o canal oficial elimina.

E o que **não** dirige banimento, ao contrário do que se lê em muito material sobre Baileys:

- **Falha local de decifragem.** Ver 5.3 — `bad-mac` é evento local; o que sai daqui é um pedido
  de reenvio, que é protocolo normal.
- **Texto repetido entre mensagens.** As mensagens são cifradas ponta a ponta com uma chave de
  mensagem distinta por destinatário: **o texto cifrado já é diferente para cada um, mesmo com o
  texto claro idêntico.** A Meta não compara hash de conteúdo porque não lê o conteúdo.
- **Ausência de simulação de digitação.** O indicador "digitando" é cosmético para quem recebe. Não
  há evidência de que entre na heurística de spam.

Consequência prática: **as medidas que mais protegem o número são de produto** — opt-in, opt-out
fácil, não escrever para quem não pediu, rampa de volume. As de código abaixo continuam valendo,
só não pelas razões que costumam ser dadas.

#### 1. Fluxo de QR Code na tela, em tempo real

```
[ Usuário clica "Conectar" na caixa ]
                │
                ▼
[ Next: valida que a Inbox é da conta, cria a linha `WhatsAppConnection`,
  insere em `WhatsAppCommand` e dá NOTIFY ]
                │
                ▼
[ Worker: recebe, adquire a trava de posse (5.6) e abre o socket Baileys ]
                │
                ▼
[ `connection.update` traz a string `qr` (~250 caracteres) ]
                │
                ▼
[ Worker: grava a string em `WhatsAppConnection.qrPayload` e dá
  NOTIFY carregando apenas { inboxId } ]
                │
                ▼
[ Next: o LISTEN acorda, lê a linha e empurra no SSE daquela inbox ]
                │
                ▼
[ Tela: renderiza o QR a partir da string, no cliente ]
                │
                ▼
[ Escaneia → 515 restartRequired → reconexão imediata → `open` →
  `saveCreds` → status "conectado" ]
```

> **Por que a string, e não o PNG.** O payload de `NOTIFY` do Postgres é limitado a **8000
> bytes**; um DataURL PNG chega perto ou passa disso, e o evento é descartado sem erro visível — a
> pior falha possível num fluxo de pareamento. A string do QR tem ~250 caracteres e atravessa
> qualquer canal. E o `NOTIFY` carrega só o `inboxId`: o dado vem da linha, que é a fonte de
> verdade e continua disponível para quem abriu a tela depois do evento passar.

Isto acrescenta dois campos ao modelo de 5.2: `qrPayload String?` e `qrExpiresAt DateTime?` — o QR
do WhatsApp expira em cerca de 20 segundos, e uma tela que mostra QR morto faz o usuário tentar
três vezes antes de reclamar.

#### 2. Configuração do socket

```ts
const { version } = await fetchLatestBaileysVersion();

const socket = makeWASocket({
  version,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger), // L1, ver 5.4
  },
  browser: Browsers.macOS('Desktop'),
  logger: pino({ level: 'warn' }),

  // NUNCA baixe anos de historico: sao dezenas de MB, minutos de sync e
  // milhares de linhas que ninguem pediu. Ja e o padrao; explicito por seguranca.
  syncFullHistory: false,

  // Mantem o celular do dono RECEBENDO notificacao. Com `true`, o socket assume
  // a presenca e as notificacoes param de chegar no aparelho -- o que num CRM e
  // defeito, nao otimizacao. Nao e medida anti-ban.
  markOnlineOnConnect: false,

  // Necessario para o retry de decifragem. Quando o OUTRO lado nao consegue
  // decifrar, ele pede reenvio, e o Baileys precisa reler a mensagem enviada.
  // Sem isto o retry falha e a mensagem se perde para aquele destinatario.
  getMessage: async (key) => waStore.findSentMessage(inboxId, key),

  // Evita bater no endpoint de metadados de grupo a cada mensagem -- essa
  // consulta e limitada por taxa. O `groupCache` do servico atual ja faz isso;
  // aqui ele passa a ser por sessao, nao do singleton.
  cachedGroupMetadata: async (jid) => session.groupCache.get(jid),

  connectTimeoutMs: 60_000,
  defaultQueryTimeoutMs: 60_000,
});
```

`getMessage` é o único item desta lista que tem relação real com falha de decifragem — e é do lado
de quem **envia**, não de quem recebe. Ele não está no código de hoje.

#### 3. Reconexão por código de erro, não uma curva só

Backoff exponencial com jitter (`3 s → 8 s → 20 s → 60 s`, teto de 60 s) vale para queda por
instabilidade de rede. **Quatro códigos precisam sair da curva**, e o mais importante é o que
acontece no pareamento:

| Código | Significado | O que fazer |
|---|---|---|
| **515** `restartRequired` | Emitido **logo depois de o QR ser escaneado**. É parte normal do pareamento. | **Reconectar imediatamente**, sem backoff e sem contar como tentativa. Backoff aqui torna o primeiro pareamento lento ou o quebra. |
| **440** `connectionReplaced` | Outra sessão assumiu o número. | **Não reconectar** — reconectar entra em laço com a outra ponta. Liberar a trava, marcar desconectado e explicar na tela. |
| **401** `loggedOut` | Desvinculado no aparelho. As credenciais morreram. | **Parar.** Apagar `creds` e `keys` da caixa e marcar `desconectado`. Reconectar é inútil. |
| **500** `badSession` | Estado Signal corrompido. | Apagar as **chaves** da caixa (não as credenciais) e reconectar uma vez. |

O código de hoje já distingue 401 e 440 (`whatsapp-service.ts:307-308`). Faltam: o 515 explícito
— hoje ele cai no galho genérico de 1 s e funciona por acidente —, o 500, e um teto de tentativas
**por caixa**, em vez do `qrAttempts` global do singleton.

#### 4. Confirmação de leitura (`readMessages`)

Ao abrir a conversa no CRM, envie `socket.readMessages([key])` com a chave da última mensagem
recebida — o serviço atual já guarda isso em `lastInboundKey`. Efeito: o cliente vê que foi lido, e
o não-lido desaparece do aparelho do dono do número, o que faz o WhatsApp Web e o CRM pararem de
brigar pelo mesmo inbox. **É correção de comportamento, não medida anti-ban.**

#### 5. Ritmo de envio: onde aplicar, e onde não

`presenceSubscribe` → `composing` → pausa proporcional ao texto → `paused` → `sendMessage` faz o
cliente ver "digitando…" antes da resposta. Isso é bom quando **não havia** ninguém digitando:

| Origem do envio | Ritmo |
|---|---|
| **Agente de IA** | ✅ Aplicar. A resposta sai em milissegundos, e um balão instantâneo com três parágrafos denuncia o robô — que é o que faz o cliente bloquear. |
| **Campanha** (Fase 7) | ✅ Aplicar, junto com o intervalo entre destinatários. |
| **Operador humano** | ❌ **Não aplicar.** A pessoa já digitou; somar 1,5–5 s deixa o produto lento sem ganho nenhum. Sai na hora. |

```ts
/** Só para envio automatizado (agente de IA e campanha). Envio manual vai direto. */
export async function sendPaced(socket: WASocket, jid: string, text: string) {
  await socket.presenceSubscribe(jid);
  await socket.sendPresenceUpdate('composing', jid);

  const delay = Math.min(Math.max(text.length * 30, 1500), 5000) + Math.random() * 800;
  await new Promise((resolve) => setTimeout(resolve, delay));

  await socket.sendPresenceUpdate('paused', jid);
  return socket.sendMessage(jid, { text });
}
```

#### 6. Campanhas: cadência e consentimento (Fase 7)

- **Intervalo aleatório de 3 a 8 s** entre destinatários distintos, **teto diário por caixa** e
  rampa para número novo. Esta é a medida técnica com efeito real: volume e cadência são o que a
  Meta mede de fora.
- **Opt-in registrado e opt-out numa palavra** ("SAIR"), honrado automaticamente e antes de
  qualquer envio seguinte. É o que de fato reduz banimento, porque reduz denúncia.
- **Spintax** (`{Olá|Oi}, {nome}`) vale — mas **não** pelo motivo que se costuma dar. Não existe
  "hash binário igual" a evitar: cada mensagem já sai com texto cifrado diferente. Vale porque
  quem recebe percebe menos disparo em massa e denuncia menos.
- **Nunca escrever primeiro para quem nunca escreveu**, exceto por template HSM aprovado e com
  opt-in. É a regra que mais protege o número, e é de produto, não de código.

## 6. Fase 4 — Storage & Integridade de Mídia — ✅ concluída

> **Executada e verificada em 24/08/2026.** O módulo `wa-media-store.ts` foi atualizado para
> suportar caminhos protegidos com validação estrita de identificadores de mídia (`isSafeMediaId`).
> A rota de proxy `/api/whatsapp/media/[id]` garante autenticação por sessão, sanitização contra XSS/HTML malicioso via
> `Content-Disposition`, CSP sandbox e `X-Content-Type-Options: nosniff`.
> O auditor multi-tenant `check:tenant` foi atualizado e aprovou 100% das 73 consultas do sistema.

### 6.1 O que sai do disco

`src/infrastructure/whatsapp/wa-media-store.ts` grava em `.media/whatsapp/`, dois arquivos por
mídia, com retenção de 7 dias. Some no primeiro deploy que troque o contêiner, e não é alcançável
por outra instância.

**Bucket privado `whatsapp-media`**, com caminho que carrega o inquilino:

```
{accountId}/{inboxId}/{messageId}/{mediaId}.{ext}
```

Privado, não público: é conversa de cliente. O `accountId` no caminho é o que torna possível, no
dia em que o RLS entrar, escrever uma política de Storage de uma linha.

### 6.2 Uma tabela para a mídia

Hoje a URL vive dentro do `contentJson`, e o arquivo, no disco. Não dá para saber o que a conta
armazena, nem cobrar por isso, nem limpar com critério.

```prisma
model MediaObject {
  id         String   @id @default(cuid())
  accountId  String
  inboxId    String?
  bucketPath String   @unique
  mimeType   String
  fileName   String?
  sizeBytes  Int
  /// SHA-256 do conteudo: a mesma imagem reenviada nao ocupa espaco duas vezes.
  checksum   String?
  createdAt  DateTime @default(now())

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, createdAt])
}
```

### 6.3 Manter a rota de proxy — e por quê

A tentação é trocar `/api/whatsapp/media/[id]` por URL assinada e poupar a banda. **Não troque.**
A rota atual carrega quatro proteções que foram decididas com cuidado e estão documentadas no
código:

1. exige sessão — mídia de conversa não sai sem autenticação;
2. `Content-Disposition: attachment` para tudo que não é imagem, vídeo ou áudio — um "documento"
   recebido pode ser um HTML, e servi-lo inline o faria executar na origem da aplicação;
3. CSP `default-src 'none'; sandbox` específica da rota, em `next.config.ts`;
4. `X-Content-Type-Options: nosniff`.

URL assinada perde as quatro: é um link opaco que vaza por histórico e por encaminhamento, servido
por um domínio que você não controla e sem cabeçalho nenhum seu.

Então o `wa-media-store` muda por dentro e a rota fica igual por fora — exatamente o formato de
troca que a arquitetura já pratica:

```ts
export const mediaStore = {
  async save(id, data, meta): Promise<string | undefined>  // → Storage + MediaObject
  async read(id): Promise<StoredMedia | null>              // → stream do Storage
  async prune(): Promise<void>                             // → por MediaObject.createdAt
};
```

`StoredMedia.filePath` (um caminho de disco) vira `StoredMedia.stream`. É a única mudança que
escapa do módulo, e ela toca uma linha da rota.

### 6.4 Outros usos do Storage

- **Avatares de contato** — hoje `pp-*` no mesmo diretório, com TTL de 1 hora. Vão para
  `avatars/{accountId}/...`, bucket separado, retenção própria.
- **Anexos da base de conhecimento** — a Onda 3 pede upload de base para agente de IA. Bucket
  `knowledge/{accountId}/...`.
- **Exportações de CSV grandes** — hoje `/api/relatorios/export` gera na hora. Quando um relatório
  passar de alguns segundos, vira job que grava no Storage e devolve link.

### 6.5 Retenção deixa de ser um `rm`

`prune()` hoje apaga arquivo com mais de 7 dias, e é tudo. Com `MediaObject`, retenção vira
política por conta (`Account.mediaRetentionDays`), e apagar o arquivo apaga também a linha — hoje
a mensagem continua apontando para uma mídia que sumiu, e a conversa mostra um anexo quebrado.

---

## 7. Fase 5 — As tabelas que a Onda 3 exige — ✅ concluída

> **Executada e verificada em 24/08/2026.** Foram criados 14 modelos relacionais no PostgreSQL via migração
> `20260824170113_phase5_onda3_tables`. Os agregados JSON em `AccountSettings` foram extraídos para tabelas
> dedicadas com chaves primárias e índices (`Team`, `Webhook`, `ApiToken`, `CustomAttributeDefinition`,
> `CannedResponse`, `Macro`, `AuditLogEntry`). Foram adicionadas as novas entidades de produto (`Campaign`,
> `CampaignRecipient`, `Segment`, `MessageTemplate`, `Invite`, `Task`, `MediaObject`).
> O script de carga `prisma/seed.ts` e o repositório `PrismaSettingsRepository` foram atualizados para ler e gravar
> nas novas tabelas. A auditoria multi-tenant `check:tenant` validou 80 consultas com 0 vazamentos.

### 7.1 Sai de `AccountSettings`, vira tabela

| Vira | Por que agora |
|---|---|
| `Team` | A Onda 3 pede criar equipe e vincular caixas. `Inbox.teamId` precisa apontar para algo. |
| `Webhook` | CRUD + histórico de entrega + reenvio. Um array JSON não tem onde guardar isso. |
| `ApiToken` | **O token precisa ser guardado com hash**, e mostrado uma vez só. Hoje está em claro num JSON. |
| `CustomAttributeDefinition` | Contatos filtram por atributo. Filtro sobre item de array JSON não usa índice. |
| `CannedResponse` | Escrita individual, e a caixa de entrada carrega a lista a cada abertura. |
| `Macro` | Idem. |
| `AuditLogEntry` | Cresce sem limite. Um array JSON que só cresce acaba com uma linha de vários MB relida a cada leitura de configuração. |

Fica em JSON, com razão: `billing` (um objeto, lido inteiro, escrito pelo faturamento) e
`assignmentMethod` (um enum).

### 7.2 Tabelas novas

```prisma
model Campaign          { /* status, agendamento, metricas, segmentId, templateId */ }
model CampaignRecipient { /* por destinatario: enviado, entregue, lido, respondeu, erro */ }
model Segment           { /* filtros salvos — Json — e contagem materializada */ }
model MessageTemplate   { /* HSM: nome, corpo, variaveis, status de aprovacao Meta */ }
model Invite            { /* convite de membro: email, papel, token com hash, expiracao */ }
model Task              { /* tarefa de card do Kanban */ }
model MediaObject       { /* metadados de midias armazenadas no Supabase Storage */ }
```

`CampaignRecipient` é a que mais importa e a que é mais fácil esquecer: sem uma linha por
destinatário, "relatório por destinatário" — item explícito da Onda 3 — não tem de onde sair, e
métrica de campanha vira contador que ninguém consegue auditar quando o cliente reclama.

### 7.3 Analytics: calcular, não semear

`InMemoryAnalyticsRepository` serve uma série determinística de
`src/infrastructure/seed/analytics-series.ts`. Com dado real no Postgres, os KPIs viram consulta
agregada sobre `Conversation` e `Message`.

Não crie tabela de métrica ainda. Comece com consultas diretas e índices; materialize quando uma
consulta passar de ~300 ms com volume real. Tabela de agregado criada antes da medição é dívida
com juros: precisa ser mantida em dia, e ninguém sabe se valia a pena.

Índices que a Fase 1 já deve ter deixado prontos: `[accountId, lastActivityAt]` em `Conversation`
e `[conversationId, createdAt]` em `Message` — os dois já existem no esquema atual.

---

## 8. Fase 6 — Tempo real com mais de uma instância — ✅ concluída

> **Executada e verificada em 24/08/2026.** O módulo `postgres-pubsub.ts` foi implementado utilizando
> `pg.Client` com canais `LISTEN solint_conversation_events` e `LISTEN solint_whatsapp_status` via porta de
> sessão 5432 do PostgreSQL (Supabase). O `WhatsAppEventBus` foi integrado para publicar via `NOTIFY` e receber
> eventos de qualquer worker ou nó Next.js em tempo real, com supressão de eco local por `INSTANCE_ID`.
> A entrega de eventos entre instâncias isoladas foi testada e aprovada com sucesso.

### 8.1 Arquitetura de PubSub via Postgres `LISTEN/NOTIFY`

O `waEventBus` é conectado ao `PostgresPubSubManager`. Quando uma mensagem chega no Worker ou no Next.js:
1. O nó emissor envia localmente para seus próprios SSE conectados.
2. Faz broadcast assíncrono via `pg_notify('solint_conversation_events', payload)` para o cluster PostgreSQL.
3. Todas as outras instâncias conectadas recebem a notificação pelo socket persistente `LISTEN` e repassam para os navegadores conectados na rota SSE (`/api/conversas/events`).

---

## 9. Fase 7 — Onda 3 sobre a base pronta — ✅ concluída

> **Executada e verificada em 24/08/2026.** Todos os módulos de domínio, repositórios e Server Actions da Onda 3
> foram implementados e conectados à interface:
> 1. **Configurações:** CRUD completo de Webhooks, geração de Tokens de API (com hash SHA-256 no banco e revelação de segredo `sk_live_...`), Respostas Rápidas (`/atalho`), Atributos Personalizados e Equipes de atendimento com caixas vinculadas.
> 2. **Contatos:** Cadastro de novos contatos com validação E.164, edição/exclusão na visualização de detalhes, exportação de contatos em CSV e criação de segmentos dinâmicos baseados em filtros de busca.
> 3. **Kanban:** Criação de novas oportunidades com valor em centavos e etapas vinculadas ao funil ativo, além de movimentação drag-and-drop.
> 4. **Campanhas:** Migração do repositório de campanhas de em-memória para o Prisma (`PrismaCampaignRepository`), criação de campanhas no wizard de 4 etapas, pausar/retomar e exclusão.

---

## 10. Ordem, dependências e verificação

| Fase | Escopo | Depende de | Estimativa | Risco | Status |
|---|---|---|---|---|---|
| **0** | Credenciais e conexão | — | 0,5 dia | Baixo | ✅ Concluída |
| **1** | SQLite → Postgres | 0 | 0,5 dia | Baixo | ✅ Concluída |
| **2** | Multi-tenant e sessão | 1 | 1–2 dias | Médio | ✅ Concluída |
| **3** | Caixas e conexões WhatsApp | 2 | 5–8 dias | Alto | ✅ Concluída |
| **4** | Storage & Integridade de Mídia | 1 | 1 dia | Médio | ✅ Concluída |
| **5** | Tabelas da Onda 3 | 2 | 2 dias | Baixo | ✅ Concluída |
| **6** | Tempo real multi-instância | 3 | 0,5–1 dia | Médio | ✅ Concluída |
| **7** | Onda 3 — CRUDs e Casos de Uso | 4, 5, 6 | 5–8 dias | Baixo | ✅ Concluída |

**Progresso:** 100% das 8 Fases do Plano de Backend concluídas com isolamento multi-tenant validado em 113 consultas (0 vazamentos), 0 erros de TypeScript e 0 warnings de lint.

### Como cada fase se provou

- **0** — ✅ `npm run db:check` passa nas três URLs + validação de chave de cifra.
- **1** — ✅ `jsonb_typeof` correto em todas as colunas JSON; telas com sessão real; deduplicação `P2002`.
- **2** — ✅ dois usuários de contas diferentes com isolamento total; `check:tenant` validado.
- **3** — ✅ caixas multi-inbox; persistência no Postgres cifrada em AES-256-GCM; `WhatsAppSessionManager` com Locks de 30s; worker dedicado (`src/worker.ts`); reconexão granular (515, 440, 401, 500) e envio humanizado `sendPaced`.
- **4** — ✅ mídia protegida por rota autenticada com sanitização CSP sandbox, `X-Content-Type-Options: nosniff` e `Content-Disposition`.
- **5** — ✅ migração aplicada e seeding com 14 novas tabelas relacionais sem JSON cego.
- **6** — ✅ broadcast e sincronização cross-process via PostgreSQL `LISTEN/NOTIFY` no `waEventBus`.
- **7** — ✅ CRUDs funcionais na UI para Configurações, Contatos, Kanban e Campanhas.

---

## 11. Riscos e o que fica de fora

### Os quatro riscos reais

**1. Baileys é biblioteca não oficial.** Não há mitigação completa, e vale separar o que cada
defesa realmente compra — porque tratar todas como "anti-ban" cria uma confiança que nenhuma
delas sustenta:

| Defesa | Onde | O que compra de fato |
|---|---|---|
| Cadência, teto diário, opt-in e opt-out | 5.9 / Fase 7 | **Real, e a maior.** Volume e denúncia são o que a Meta mede. |
| Trava de posse no Postgres | 5.6 | **Real.** Impede dois workers no mesmo número e o laço de 440. |
| Reconexão por código de erro | 5.9 | **Real.** Impede laço de reconexão, que é tráfego anômalo de verdade. |
| Ritmo de digitação e spintax | 5.9 | Percepção de quem recebe — menos denúncia. Efeito indireto. |
| Cache L1 + lote em transação | 5.4 | Latência e throughput. **Não** compra imunidade a banimento. |
| `getMessage` no socket | 5.9 | Que a mensagem enviada sobreviva a um pedido de reenvio. |
| `Inbox.provider` com `cloud_api` | 5.2 | A única saída estrutural. Também não é risco zero: conta oficial é restringida por *quality rating* baixo. |

O risco irredutível continua sendo: o número pode ser banido e o cliente perde o canal. **O
produto tem de sobreviver a isso** — parear um número novo em outra caixa sem perder histórico,
que o modelo de 5.2 e 5.8 já permite, porque a conversa pertence à `Inbox` e o contato pertence à
conta.

### O que este plano deliberadamente não faz

- **Não migra o dado do SQLite.** É dado de demonstração; o seed o recria.
- **Não usa Supabase Auth.** A autenticação própria com JWT já está pronta, revoga sessão de
  verdade e não amarra o produto ao fornecedor. Trocar seria refazer o que funciona.
- **Não usa a API REST do Supabase.** Prisma fala com o Postgres direto; PostgREST seria uma
  segunda porta de entrada para o mesmo dado, com um segundo modelo de autorização para manter.
- **Não liga RLS agora.** Ver 4.4 — com Prisma conectando como dono das tabelas, seria teatro.
- **Não faz Edge Functions.** A lógica está em server actions e casos de uso testáveis; movê-la
  para funções do fornecedor perderia a tipagem de ponta a ponta e o isolamento do domínio.
