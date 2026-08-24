# Solint CRM — Auditoria e Plano de Implementação

> Auditoria escrita em 21/08/2026. Fontes cruzadas: `legado/uploads/crm-funcionalidades-base (1).md`
> (funcionalidades), `legado/uploads/SKILL.md` (design system), `REGRAS-GLOBAIS.md` (arquitetura) e o
> código em `src/`. Todos os números deste documento foram medidos no código, não estimados.
>
> **Decisão do produto:** será demonstração **e** produto, começando pelo frontend.
> Por isso a execução saltou da Onda 0 direto para a Onda 4 — design antes dos CRUDs.

---

## 0. Estado da execução

| Onda | Escopo | Estado |
|---|---|---|
| **0** | Nenhum controle mente | ✅ **Concluída** |
| **1** | Fechar o núcleo de atendimento | ✅ **Concluída** |
| **2** | Persistência (SQLite + Prisma) | ✅ **Concluída** |
| **A** | Autenticação com JWT próprio | ✅ **Concluída** |
| **3** | Completar os CRUDs | ⬜ Não iniciada |
| **4** | Redesign de densidade | ✅ **Concluída** |
| **5** | O que ainda falta do documento | ✅ **Concluída** |

`tsc --noEmit`, `next lint` e `next build` passam. As 14 rotas de tela respondem 200, e as três
rotas dinâmicas respondem **404** para id inexistente (verificado em `next start`, não só em dev).

> **Decisão do produto:** frontend primeiro. A execução foi 0 → 4 → 5 → 1 → 2 → autenticação.
> Resta a Onda 3 (CRUDs), agora desbloqueada.
>
> O próximo passo combinado é o backend hospedado: **Supabase + Prisma**. O SQLite de hoje é o degrau
> que torna essa migração mecânica — ver 5.5.
>
> **O plano do backend hospedado está em [`PLANO-BACKEND.md`](PLANO-BACKEND.md)** — sete fases,
> da string de conexão até as N conexões de WhatsApp por conta. A Onda 3 é a última delas.

### O que mudou nos números da auditoria

| Medida | Auditoria | Agora |
|---|---|---|
| Botões clicáveis que não fazem nada | 31 | **0** (34 marcados como `planned`, 1 ligado) |
| Textos de UI sem acento | ~193 | **0** |
| Estados de carregamento | 0 | **17** (11 `loading.tsx` + 6 `<Suspense>` na página) |
| Tamanhos tipográficos distintos | 22 | **8** (7 na aplicação + `hero`) |
| Valores de raio distintos | 9 ad-hoc | **4 semânticos + `full`** |
| Instâncias de `<Card>` | 49 | **36** |
| Busca global | inerte, com `⌘K` falso | **paleta de comandos funcional** |
| Seções de Configurações | 9 | **11** (caixas de entrada, base de conhecimento) |
| Automações | lista fixa, aviso de conflito escrito à mão | **construtor + conflito calculado** |
| Fluxo do agente | `<ol>` de 4 rótulos fixos | **grafo editável com validação** |
| Seletor de período | trocava a URL, não os dados | **muda granularidade e série** |
| Exportação de relatório | inexistente | **CSV por aba, no servidor** |
| Largura mínima utilizável | ~1280px | **360px** |
| Controles de `/conversas` que não faziam nada | 12 | **2** (emoji e agendar envio) |
| Conversas visíveis na demonstração | 0 | **7** (o seed estava desligado do store) |
| O que sobrevive a um reinício | nada | **tudo** |
| Usuários reais | 1 fixo | **3, com papéis distintos** |
| Telas com guarda de permissão no servidor | 0 | **12** |

---

## 1. Veredito original

A arquitetura é boa de verdade. Domínio puro isolado por lint, portas e casos de uso injetados,
Zod em toda Server Action, multi-tenant por `accountId`, regras de negócio (janela HSM, nota interna)
implementadas no lugar certo. Isso não é comum e não deve ser mexido.

O problema era outro: **a interface prometia um produto que ainda não existia atrás dela.**

Um botão que não responde é pior que um botão que não existe: o primeiro quebra a confiança na tela
inteira, o segundo é só um recorte de escopo. A Onda 0 resolveu exatamente isso.

---

## 2. ✅ Onda 0 — Nenhum controle mente (concluída)

### 2.1 Acentuação — 296 correções

Não foi um find-and-replace. Literais de domínio não podem ser tocados, então a varredura teve
salvaguardas (string inteira entre aspas, `snake_case`, identificadores). **Mesmo assim cinco
regressões passaram**, todas capturadas antes de chegar ao build:

| Regressão | Como foi pega |
|---|---|
| `'audio/ogg'` → `'áudio/ogg'` (mimetype) | grep dirigido |
| `/^(image\|video\|audio)\//` → `áudio` (regex de segurança da rota de mídia) | grep dirigido |
| Chave `disponivel` do `AvailabilityStatus` | typecheck |
| Tag HTML `<audio>` → `<áudio>` | typecheck |
| Chaves `concluida` / `transferencia` em `Record` tipado | typecheck |

Literais preservados: `nao_atribuidas`, `'publica'`, `'media'`, `'aberta'`, `'relatorios:ler'`,
`'st-qualificacao'`, `'cp-reativacao'`.

### 2.2 Controles honestos

Criado [`src/components/ui/planned.ts`](src/components/ui/planned.ts): o controle fica desabilitado
e o `title` diz o que ele *vai* fazer — "Cadastrar um contato manualmente — em desenvolvimento".

- 31 `<Button>` + 4 ícones do composer + 3 ações rápidas do painel de contexto + 2 controles falsos
  do modal de etapas = **34 marcadores**.
- **"Reconectar"** do banner de canal offline foi *ligado*: leva a Configurações › Integrações.
- Para listar o que falta implementar: `grep -rn "planned(" src/`

### 2.3 Estados de carregamento — 17 arquivos

[`skeleton.tsx`](src/components/ui/skeleton.tsx) com peças que reproduzem o **formato** do conteúdo
(não um spinner), e [`page-loading.tsx`](src/components/layout/page-loading.tsx) replicando a altura
real da topbar para a tela não saltar. `/conversas` tem o seu próprio, com as três colunas.

### 2.4 Estados vazios

Novo primitivo `EmptyHint` para listas dentro de cards — a moldura tracejada do `EmptyState`
duplicaria a borda do cartão. Aplicado a: pendências, campanhas, base de conhecimento, logs do
agente, comentários de CSAT. O funil vazio já tinha estado, mas era um beco sem saída: ganhou ação.

### 2.5 A promessa do ⌘K virou produto

Optamos por construir em vez de remover, porque a busca global é o §3 do documento de funcionalidades:

- [`/api/busca`](src/app/api/busca/route.ts) — busca no servidor, filtrada por `accountId` **e** por
  `can()`. A busca não podia virar porta lateral para dados de outro tenant.
- [`CommandPalette`](src/features/busca/components/command-palette.tsx) — setas, Enter, debounce com
  `AbortController` (digitar rápido não deixa resposta antiga sobrescrever a nova), resultados
  agrupados em Ir para / Conversas / Contatos.
- [`GlobalSearch`](src/features/busca/components/global-search.tsx) — o atalho anunciado é o do
  sistema de quem lê: `⌘K` no Mac, `Ctrl K` no resto.

Isso exigiu antecipar **`/conversas/[id]`** (item da Onda 1): mandar o resultado para `/conversas`
genérico seria a mesma meia-promessa. A rota destrava também os cards do Kanban e as notificações.
Criado um `not-found` dentro de `(workspace)` para o usuário manter a rail em vez de cair numa
página órfã.

### 2.6 Pendência conhecida — resolvida na Onda 5

`/conversas/id-inexistente` renderizava a tela correta com **HTTP 200**. A suspeita registrada aqui
("o layout já transmitiu") estava **errada**. Ver a seção 8.8: a causa é o próprio `loading.tsx`, e
o diagnóstico só apareceu depois de isolar o caso num par de rotas descartáveis.

---

## 3. ✅ Onda 4 — Redesign de densidade (concluída)

### 3.1 Escala de raio semântica

O diagnóstico era "raio uniforme: nada distingue superfície estrutural de controle". Agora cada
valor significa uma coisa, definido em `globals.css`:

| Token | Valor | Uso |
|---|---|---|
| `rounded-surface` | `0` | Painéis, colunas, tabelas, cards: fixos no plano |
| `rounded-control` | `4px` | Botões, inputs, selects, chips: manipuláveis |
| `rounded-float` | `10px` | Modal, paleta, dropdown: flutuam acima do plano |
| `rounded-bubble` | `14px` | Balão de mensagem: a convenção do WhatsApp significa algo aqui |
| `rounded-full` | — | Só indicadores: pontos de status, avatares, contadores |

Migradas 159 ocorrências genéricas + os primitivos do design system. **Zero raios arbitrários
(`rounded-[Npx]`) restantes.**

> Refinamento sobre o plano original: a auditoria previa 3 valores. `rounded-float` foi acrescentado
> porque camada flutuante com canto reto lê como erro de renderização, não como decisão.

### 3.2 Escala tipográfica fechada

Havia **15 tamanhos arbitrários em px** (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5,
15, 26, 28) mais 7 nomeados. Meio pixel de diferença não é decisão de design, é ruído.

| Passo | px | Trabalho |
|---|---|---|
| `text-micro` | 10 | Rótulos em caixa alta, metadados mínimos |
| `text-meta` | 11 | Metadados, dicas, horários |
| `text-body` | 12 | Corpo denso: listas, tabelas, badges |
| `text-ui` | 13 | Corpo padrão da interface e das mensagens |
| `text-title` | 15 | Títulos de seção e de página |
| `text-metric` | 20 | Números de destaque médio |
| `text-display` | 28 | Números grandes do painel de operação |

**314 ocorrências migradas.** Cada passo tem `line-height` próprio.

### 3.3 Dashboard reestruturado em três faixas

Era cinco KPIs idênticos, depois grade 2/3+1/3 de cards, depois grade de 3 cards. Agora:

1. **Estado da operação** ([`operation-strip.tsx`](src/features/dashboard/components/operation-strip.tsx)) —
   sem card, faixa de severidade no topo de cada sinal, números em Sora tabular. Lê **dados reais**,
   não o seed: conversas abertas, sem responsável, não lidas e status do canal WhatsApp vêm do
   container e do `whatsappService`. Um número inventado nessa faixa seria pior que nenhum.
2. **Precisa de atenção** ([`attention-list.tsx`](src/features/dashboard/components/attention-list.tsx)) —
   cada linha leva direto ao atendimento via `/conversas/[id]`. Uma lista de pendências que não abre
   a conversa obriga o operador a procurá-la de novo, e o tempo que ela reporta continua correndo.
3. **Tendência** — indicadores do período com sparkline, volume, canais, ranking e funil.

Hierarquia agora vem de fio de 1px + peso tipográfico, via o novo
[`SectionTitle`](src/components/ui/section.tsx), não de borda + sombra + raio.

### 3.4 Gráficos que fazem trabalho

- **Sparkline** ([`sparkline.tsx`](src/features/dashboard/components/sparkline.tsx)) embutido no
  próprio indicador, colorido pela direção do delta, com o ponto final enfatizado — é o presente,
  o que o operador está lendo.
- **Volume** reescrito: área preenchida a 10%, grade discreta, e rótulo **só no pico e no último
  ponto**. A versão anterior escrevia o valor sobre cada barra — se todo ponto precisa do número
  escrito, a forma não está fazendo trabalho nenhum. A tabela completa continua no `figcaption`,
  que é o que o leitor de tela lê.

### 3.5 Densidade

- Lista de conversas: `py-3` → `py-2.5`, `gap-3` → `gap-2.5`, linha de badges mais justa, e a fila
  padrão ("Geral") deixou de ser impressa em toda linha — era ruído puro.
- Tabela de contatos: `py-3` → `py-2.5` e `tabular-nums` nos telefones.

### 3.6 Auditoria de cards — correção da estimativa

A auditoria dizia "das 49 instâncias, cerca de 15 se justificam". **Aquela estimativa estava
errada.** Reduzimos para 36 eliminando os cards do dashboard e dos relatórios, onde eram só moldura.
Os 36 restantes vivem em Perfil, Configurações e painéis de agente — e ali cada card **é** uma
unidade acionável (um grupo de formulário com sua própria ação), que era exatamente o critério
proposto. Perseguir o número 15 seria destruir a regra para bater a meta.

---

## 4. ✅ Onda 1 — Fechar o núcleo de atendimento (concluída)

`/conversas` é o produto. O que faltasse aqui pesava mais que qualquer outra tela.

| Item | Estado |
|---|---|
| Rota `/conversas/[id]` para deep-link | ✅ Onda 0 |
| Transferir atendimento | ✅ modal ligado ao `assign` |
| Seletor de prioridade | ✅ menu ligado ao `changePriority` |
| Aba "Em espera" | ✅ |
| Aplicar etiqueta na conversa e no contato | ✅ dois controles distintos |
| Respostas rápidas por `/` | ✅ com navegação por teclado |
| Anexar arquivo e gravar áudio | ✅ com uma limitação documentada (4.6) |
| Seletor de template HSM | ✅ |
| Filtros avançados combináveis | ✅ |

### 4.1 Transferir atendimento

`assign` já existia no repositório — e **estava quebrado**: recebia só o id e gravava
`assigneeName: undefined`, então transferir apagava o nome do responsável na lista. A porta agora
recebe `{ id, name }`, e o nome é resolvido **no servidor** a partir da lista de membros da conta:
aceitar o nome vindo do payload deixaria o cliente escrever "Camila Reis" apontando para o id de
outra pessoa.

A lista do modal não é alfabética — ordena por disponibilidade. Transferir para quem está ausente é
justamente o erro que a ordem precisa evitar.

### 4.2 Prioridade, etiquetas e "Em espera"

Os três casos em que o domínio já sabia fazer e faltava o controle:

- **Prioridade** era um selo de leitura; virou menu. `changePriority` intacto.
- **Etiquetas** ganharam dois editores separados: a da **conversa** descreve o atendimento
  ("Cobrança", "Urgente"), a do **contato** descreve a pessoa ("VIP") e vale para todos os
  atendimentos dela. Editar as do contato propaga para as conversas que carregam a cópia dele —
  sem isso, a caixa mostraria a versão antiga até o próximo carregamento completo.
- **`espera`** existia em `CONVERSATION_STATUSES` e não tinha aba: conversas nesse estado sumiam de
  todas as abas, porque nenhuma as aceitava. Uma linha resolveu, e o botão "Em espera" no cabeçalho
  dá como colocá-las lá.

### 4.3 Respostas rápidas por `/`

O composer prometia "Digite / para respostas rápidas" e não tinha seletor. Agora abre a lista
quando a mensagem **inteira** começa com `/` — disparar no meio do texto transformaria qualquer URL
numa gaveta aberta. Navega com ↑↓, insere com Enter ou Tab, cancela com Esc.

### 4.4 Template HSM — a saída do beco

O banner de janela fechada mandava "envie um template aprovado" e não oferecia nenhum. Era o pior
defeito da tela: um bloqueio que documenta a própria saída e não a fornece.

Agora há uma faixa com botão. O seletor mostra o texto final já com as variáveis substituídas —
um template disparado com `{{1}}` visível chega assim no cliente. Templates não aprovados aparecem
desabilitados em vez de escondidos: sumir faria o agente procurar um template que ele sabe que
existe. A recusa de template não aprovado é do domínio, não da tela.

### 4.5 Filtros combináveis

Canal, prioridade, etiqueta, só não lidas, só com SLA estourado — combinando por E. O contador no
gatilho existe para evitar o erro clássico de fila: achar que a caixa zerou quando um filtro
esquecido está escondendo tudo. Pelo mesmo motivo, o estado vazio distingue "não há nada" de "não
há nada **neste recorte**", e oferece limpar.

### 4.6 Anexos de saída

A entrada de mídia estava pronta desde a integração do WhatsApp; faltava a saída.

- **Arquivo:** imagem, vídeo, áudio ou documento, com lista de permissão por tipo, teto de 16 MB
  (limite prático do WhatsApp) e legenda opcional. O arquivo vai por `FormData`, não em base64
  dentro de JSON — inflaria 33% sem ganho nenhum.
- **Voz:** `MediaRecorder` com cronômetro, descartar e parar.
- Anexo público fora da janela HSM é bloqueado igual a texto livre; nota interna com anexo **nunca**
  sai para o canal.

**Limitação conhecida:** o WhatsApp toca opus em contêiner ogg; o Chrome só grava opus em webm.
Pedimos ogg primeiro e caímos para webm quando não há suporte. O Baileys envia webm, mas a
reprodução pode falhar em alguns aparelhos sem transcodificação no servidor (ffmpeg). Gravar em
webm é melhor que não gravar — e o dia em que houver backend, um passo de transcodificação resolve.

### 4.7 O seed estava desligado do store

Achado no caminho: `CONVERSATIONS` e `CONTACTS` **nunca eram importados** pelo store — o
`createStore` começava com arrays vazios. `/conversas` e `/contatos` abriam permanentemente vazias,
e a Onda 1 inteira seria invisível na demonstração.

O seed voltou. Conversas reais do WhatsApp chegam com id `cv-wa-` e convivem com as de exemplo.
Para voltar a testar o WhatsApp com a caixa 100% limpa, basta trocar as duas linhas de
`createStore` por arrays vazios — está comentado no arquivo.

---

## 5. ✅ Onda 2 — Persistência (concluída)

O store em `globalThis` virou **SQLite + Prisma**. Nenhuma tela, caso de uso ou regra de domínio
mudou: a troca aconteceu no `container.ts`, em oito linhas. Era exatamente para isso que a
composition root existia.

### 5.1 O que mudou, e o que não mudou

| Camada | Mudou? |
|---|---|
| `src/core/domain` | não |
| `src/core/use-cases` | não |
| `src/core/ports` | só o `SessionProvider` ganhou `getSession()` |
| `src/app` e `src/features` | não (fora as telas de login e os guardas de permissão) |
| `src/infrastructure/repositories` | **sim** — adaptadores novos |
| `container.ts` | **sim** — oito linhas |

### 5.2 Desenho do esquema

Duas restrições do SQLite moldaram tudo: **não há `enum`** e **não há `Json`**. Estados de domínio
viram `String` (a validação já era do domínio, não do banco) e agregados viram `String` com JSON
dentro, sempre com sufixo `Json`.

A regra de corte entre coluna relacional e coluna JSON: **é relacional o que se consulta, filtra ou
escreve individualmente.** É JSON o agregado que só é lido e gravado inteiro — o horário comercial
de uma caixa, as regras de transferência de um agente, o histórico de um card. Normalizar esses
últimos criaria dez tabelas que nenhuma consulta jamais tocaria sozinhas.

São 17 modelos. `analytics` e `campaigns` **continuam em memória de propósito**: são somente
leitura, nenhuma escrita passa por eles, e portanto não há nada a perder num reinício. Viram tabela
quando ganharem escrita.

### 5.3 Divisores de dia deixaram de ser dados

A timeline do seed trazia os divisores ("Hoje", "Ontem") prontos como itens. Agora a mensagem tem
`createdAt` — o instante real — e os divisores são **derivados** na leitura. O campo `time` sempre
foi só um rótulo ("14:32") e não sabe de que dia é; guardar o divisor como dado significava que ele
envelhecia errado: "Hoje" continuava dizendo "Hoje" na semana seguinte.

### 5.4 O WhatsApp escrevia num store morto

O `whatsapp-service` mexia direto no array em memória — quinze pontos de mutação. Com o store
desligado das telas (ver 4.7), **toda mensagem real recebida ia para um lugar que ninguém lia**.

A gravação saiu para `wa-store.ts`: o serviço cuida do protocolo (socket, chaves, mídia cifrada) e
o novo módulo cuida do banco. A deduplicação de mensagem repetida — o WhatsApp reentrega eventos —
passou a ser uma consulta por id em vez de uma varredura de array.

### 5.5 Migrar para Supabase depois

Três mudanças, e nenhuma toca a aplicação:

1. `provider = "postgresql"` no `schema.prisma`;
2. `PrismaBetterSqlite3` → `PrismaPg` em `src/infrastructure/db/prisma.ts`;
3. as colunas `*Json` viram `Json` nativo — troca mecânica, campo a campo.

`npm run db:migrate`, `db:seed`, `db:studio` e `db:reset` estão no `package.json`.

---

## 6. ✅ Autenticação com JWT próprio (concluída)

### 6.1 Como funciona

Senha com **`scrypt`** do `node:crypto` — sem dependência externa, deliberadamente cara em CPU e
memória, com sal por usuário. Sessão em **JWT HS256** (`jose`) num cookie `httpOnly`, `SameSite=lax`,
`Secure` em produção, com 7 dias de validade.

**Cada token emitido tem uma linha em `AuthSession`.** Sem esse registro, um JWT é irrevogável até
expirar — quem tivesse copiado o cookie continuaria dentro. Com ele, "sair de todas as sessões" é
uma operação real. Verificado: token válido, sessão revogada no banco, acesso negado no pedido
seguinte.

### 6.2 A divisão entre middleware e servidor

O middleware roda no Edge, **onde não há banco**. Então:

- **middleware:** confere a assinatura e a validade do token. É o portão — impede que uma tela
  protegida chegue a ser renderizada para quem não tem cookie, e guarda o destino em `?proximo=`
  para devolver a pessoa ao lugar de onde foi barrada.
- **servidor (`readSession`):** confere revogação, expiração e existência do usuário. É a
  autorização de verdade.

Um token roubado passa pelo middleware. Só a checagem no banco o derruba. Essa divisão é
intencional e está escrita nos dois arquivos.

### 6.3 Duas defesas contra enumeração de usuários

Ambas em `(auth)/actions.ts`:

- **Mensagem única.** "E-mail ou senha inválidos" para os dois casos. Dizer qual falhou transforma a
  tela de login num verificador de cadastro.
- **Piso de tempo.** Sem ele, e-mail inexistente responde na hora e senha errada demora o tempo do
  `scrypt` — a diferença entrega quais e-mails existem. O piso de 400 ms iguala os caminhos.

A recuperação de senha responde igual para e-mail existente e inexistente, pelo mesmo motivo. O
envio em si depende de um serviço de entrega que o projeto ainda não tem.

### 6.4 O buraco que só ficou visível agora

Com um usuário só, o RBAC era código não verificável. Com três, na primeira verificação:

**A rail escondia os itens que o papel não alcança, mas digitar a URL entrava.** Diego, com papel de
agente, abria `/configuracoes` e via o faturamento da conta.

Não era um erro de raciocínio — era um erro **impossível de observar** enquanto todo mundo era
administrador. Corrigido com um guarda de permissão em cada tela do workspace, e uma tela de acesso
negado que diz a verdade ("seu papel não alcança") em vez de mentir com "página não encontrada".

Verificado por papel:

| Tela | Rafael (admin) | Camila (supervisor) | Diego (agente) |
|---|---|---|---|
| `/conversas`, `/contatos`, `/kanban` | ✅ | ✅ | ✅ |
| `/dashboard`, `/relatorios` | ✅ | ✅ | 🚫 negado |
| `/campanhas`, `/agentes-ia` | ✅ | ✅ | 🚫 negado |
| `/configuracoes` | ✅ | ✅ | 🚫 negado |

As rotas de API responderam ao mesmo problema de outro jeito: **401, não redirecionamento.** Uma
página de login em HTML não serve a um `fetch` que espera JSON.

### 6.5 Entrar

`npm run db:seed` cria três usuários, todos com a mesma senha de propósito — o ponto de ter três é
poder ver o RBAC agir:

| E-mail | Papel |
|---|---|
| `rafael.souza@solint.com.br` | administrador |
| `camila.reis@solint.com.br` | supervisor |
| `diego.martins@solint.com.br` | agente |

Senha: `solint2026` (mude com `SEED_PASSWORD`).

O `AUTH_SECRET` foi gerado e está no `.env`, que é ignorado pelo git. Em produção a aplicação
**recusa subir** sem ele — subir com segredo previsível é o mesmo que não ter autenticação.

### 6.6 Limitações conhecidas

- **Uma conta por usuário.** O e-mail é único globalmente, então `availableAccounts` devolve uma
  conta só e o seletor de workspace mostra uma. Multi-workspace de verdade exige uma tabela de
  vínculo (`Membership`); fingir mais de uma encheria o seletor de opções falsas.
- **Acesso negado responde 200**, não 403. A tela diz a coisa certa, mas o status não. Corrigir
  exige o `forbidden()` do Next, hoje atrás de flag experimental.
- **Redefinir senha por e-mail** continua faltando: depende de um serviço de entrega.
- **Cookie `Secure` em produção** não trafega em `http://localhost`. Para testar login localmente,
  use `npm run dev`.

---

## 7. ⬜ Onda 3 — Completar os CRUDs

**Desbloqueada:** a Onda 2 entregou o banco. Em ordem de valor:

1. **Configurações** — etiquetas, respostas rápidas, atributos, webhooks, tokens, empresa. São seis
   formulários do mesmo formato: vale extrair um componente de seção editável.
2. **Contatos** — criar, editar, exportar, segmentos salvos, ações em massa, mesclar duplicados.
3. **Kanban** — criar oportunidade; tornar o modal de etapas real; tarefas e anexos no card.
4. **Equipe** — convidar membro, editar papel, criar equipe, horário de trabalho.
5. **Campanhas** — concluir o wizard, pausar/retomar, relatório por destinatário.
6. **Agentes de IA** — criar agente, upload de base de conhecimento.

---

## 8. ✅ Onda 5 — O que ainda falta do documento (concluída)

### 7.1 Base de conhecimento (§15) — seção nova

Domínio novo em `src/core/domain/knowledge.ts`: categorias, artigos, situação
(publicado / rascunho / arquivado), votos de "isto resolveu?". As funções que importam são puras e
testáveis — `searchArticles` (busca sem acento e sem caixa: quem digita "reembolso" acha
"Reembôlso"), `publicArticles` (rascunho e arquivado **nunca** vazam para o portal) e
`helpfulRateOf`, que devolve `undefined` em vez de `0%` quando não há voto nenhum. Um artigo novo
não é um artigo ruim.

A tela tem CRUD completo de artigo e de categoria, filtro por situação, busca, e um editor com aba
**"Ver como cliente"** — a mesma tipografia de leitura do portal, para escrever vendo o resultado.

Uma regra de integridade que vale citar: apagar categoria com artigo dentro é **recusado** pelo
domínio (`ConflictError`), e a recusa diz quantos artigos travam a exclusão. Apagar em cascata
silenciosamente levaria conteúdo junto sem ninguém perceber.

### 7.2 Construtor de automação com detecção de conflito (§10)

Antes, o aviso de conflito era **texto fixo no JSX** citando duas regras pelo nome. Ele continuaria
ali depois de você desativar uma das duas, e sumiria justamente quando o conflito fosse real. Um
alerta que não acompanha o estado ensina a ignorar alertas.

O modelo virou estruturado — `trigger`, `conditions[]`, `actions[]` — e o conflito passou a ser
**calculado** por `detectAutomationConflicts`, no domínio. Ele exige três coisas ao mesmo tempo:

1. mesmo gatilho;
2. condições que **podem** valer para a mesma conversa (duas regras com `canal = WhatsApp` e
   `canal = Instagram` se excluem e nunca colidem — avisar seria ruído);
3. ações disputando o mesmo destino.

Distingue dois tipos: **sobrescrita** (duas regras gravam `atribuir_equipe` com valores diferentes —
vale a de maior ordem) e **duplicidade** (duas mandam mensagem no mesmo gatilho — o cliente recebe
duas). No seed real ele acha exatamente 1 conflito, entre "Atribuir WhatsApp ao time Comercial" e
"Leads VIP vão para o Suporte N1".

O construtor é um modal de três passos numerados — **Quando / E se / Então** — com a regra escrita
em português embaixo (`describeAutomation`, derivada dos blocos, nunca digitada) e **verificação de
conflito ao vivo, antes de salvar**. Descobrir o conflito depois de salvar é descobrir em produção,
com uma conversa real já atribuída ao time errado.

A ordem de execução virou editável na lista, porque é ela que decide quem vence a sobrescrita.

### 7.3 Gestão de caixas de entrada (§15)

`ChannelConnection` ganhou horário comercial, mensagem de ausência, saudação e webhook — por canal.
Conexão e operação moram na mesma tela de propósito: é o que permite responder "por que o cliente
recebeu 'estamos fechados' às 15h?" sem cruzar três abas.

`isWithinBusinessHours` recebe o `now` por parâmetro (função que lê o relógio sozinha não é
testável) e trata expediente que atravessa a meia-noite. `summarizeBusinessHours` colapsa dias
contíguos em "Seg a Sex, 08:00–18:00" e reconhece 24/7. A etiqueta *aberto agora / fora do
expediente* é calculada no cliente após a montagem — no servidor, daria divergência de hidratação e
um rótulo congelado no horário do build.

As duas mensagens automáticas **saíram** de Automações, onde eram dois `<textarea readOnly>` com
texto fixo e um toggle que não ia a lugar nenhum. Cada canal tem o próprio expediente; uma mensagem
global era errada por construção.

### 7.4 Builder de fluxo do agente (§9)

Era um `<ol>` de quatro rótulos fixos, igual para os três agentes. Um fluxo de atendimento é um
**grafo** — a pergunta leva a caminhos diferentes — então `AgentFlowBlock` tem tipo, título e
saídas com `targetId`, e `validateAgentFlow` acusa quatro problemas estruturais: sem início, saída
solta, bloco inalcançável e bloco sem saída.

A ligação entre blocos é por **seleção, não por arrastar**. Arrastar linha é bonito e é inacessível
pelo teclado; um `select` faz a mesma ligação, funciona no celular e não deixa saída pendurada sem
o validador perceber. O fluxo persiste (`saveFlow` na porta) e respeita `agentes-ia:escrever` —
quem não pode editar vê o desenho em modo leitura.

### 7.5 Responsivo (§3)

- **Rail → gaveta.** Acima de `md`, a rail vertical de 64px. Abaixo, uma barra de topo com
  hambúrguer e gaveta. Barra inferior de abas foi descartada: são sete destinos mais perfil, tema e
  WhatsApp, e barra de abas só funciona bem com quatro ou cinco.
- **`/conversas` em pilha.** Lista → conversa → detalhes, com botão de voltar. A troca é só de
  visibilidade, então voltar não recarrega nem perde a posição de rolagem.
- **Índice de Configurações** vira faixa horizontal rolável abaixo de `lg` — onze seções empilhadas
  ocupariam a tela inteira antes de mostrar qualquer configuração.
- **Busca global no celular.** O gatilho era `hidden md:flex` e não havia atalho de teclado: a
  paleta estava **inalcançável** em metade dos aparelhos. Agora há um botão de lupa.
- Topbar, `PageShell` e o painel do dashboard com espaçamento reduzido no celular. Largura mínima
  utilizável saiu de ~1280px para 360px.

### 7.6 Exportação e comparação de períodos (§13)

**O seletor de período estava morto.** Duas causas somadas: o repositório ignorava o parâmetro e
devolvia sempre a mesma série; e a chave da URL era `período` (com acento) enquanto a página lia
`periodo`. O acento foi introduzido pela varredura da Onda 0, que acertou um literal de código —
exatamente a classe de erro que aquela seção documentou. Agora `hoje` traz 12 pontos por hora, `7d`
sete diários e `30d` trinta, com o período anterior calculado para servir de referência.

A exportação é **CSV gerado no servidor**: a autorização é checada onde não dá para burlar
(`relatorios:ler`), os números são os mesmos que a tela leu, e o `Content-Disposition` faz o
download sem uma linha de JavaScript. Duas armadilhas resolvidas em `lib/csv.ts`:

- **Injeção de fórmula.** Excel e Sheets executam célula que começa com `=`, `+`, `-`, `@`. Um
  contato chamado `=HYPERLINK("http://ataque","clique")` viraria código na máquina de quem abrisse o
  relatório. O apóstrofo à frente neutraliza sem mudar o texto lido.
- **BOM.** Sem ele o Excel no Windows lê UTF-8 como Latin-1 e todo acento quebra.

A comparação tem aba própria e também entra no gráfico como linha tracejada no mesmo eixo — comparar
exige as duas séries juntas, não dois gráficos lado a lado. `compareRow` respeita `lowerIsBetter`:
metade dos indicadores melhora ao cair, e pintar toda queda de vermelho ensinaria a ler tempo de
resposta ao contrário. Sem base anterior não há percentual — "novo no período", não "+100%".

### 7.7 Toast em tempo real (§17)

Uma conexão SSE para todo o workspace (`ConversationEventsProvider`), em vez de uma por consumidor:
o navegador limita conexões por origem e stream aberto custa no servidor. A caixa de entrada e o
toast agora se **inscrevem** no mesmo barramento.

Regra de silêncio: **dentro de `/conversas` não aparece toast**. Quem está na caixa já vê a lista se
reorganizar; repetir num cartão flutuante só atrapalharia. O aviso serve a quem está em outra tela.
Dedupe por conversa (dez mensagens não viram dez cartões), teto de quatro visíveis, cronômetro que
para sob o cursor.

De brinde, o menu de notificações ganhou marcação individual e ícone por tipo.

### 7.8 A pendência do 404 — causa encontrada

A seção 2.6 registrava `/conversas/id-inexistente` respondendo 200 e chutava que "o layout já
transmitiu". **Estava errado.** O diagnóstico veio de isolar o caso em rotas descartáveis:

| Rota de teste | `loading.tsx` num ancestral? | Status |
|---|---|---|
| estática com `notFound()` | não | **404** |
| dinâmica sob o mesmo layout | não | **404** |
| dinâmica que aguarda `params`, sessão e busca no repositório | não | **404** |
| a mesma, com um `loading.tsx` no segmento pai | **sim** | **200** |

A causa é o `loading.tsx`: ele cria uma fronteira de Suspense, o Next despacha o cabeçalho HTTP
antes de a página rodar, e `notFound()` já não pode trocar o status. Ou seja: **os estados de
carregamento da Onda 0 quebraram o 404 das três rotas dinâmicas.** Duas melhorias legítimas que se
anulam — e nenhuma das duas parecia suspeita sozinha.

A correção guarda as duas: o `loading.tsx` dos seis segmentos afetados virou um componente de
esqueleto usado como `fallback` de um `<Suspense>` **dentro da página**, depois da verificação de
existência. A consulta barata (`findById`) roda antes de qualquer byte sair e responde 404; a parte
cara (listar tudo) suspende com o mesmo esqueleto de antes. `/conversas/[id]`, `/contatos/[id]` e
`/agentes-ia/[id]` agora respondem 404 em `next start`.

### 7.9 Fechamento da escala tipográfica

A Onda 4 dizia escala fechada de 7 passos, mas **66 usos** dos tamanhos nomeados do Tailwind
(`text-xs` a `text-3xl`) tinham sobrevivido — a varredura anterior mirou tamanhos em px arbitrários
e deixou os nomeados. Migrados todos. O único passo novo é `hero` (32px), exclusivo da chamada das
telas de entrada.

Também corrigido: a grade de indicadores do dashboard usava `border-l` no filho, o que pendurava um
fio solto no primeiro item de cada linha quebrada em telas estreitas. Virou `gap-px` sobre fundo de
linha, que funciona com qualquer número de colunas.

### 7.10 Acentos que a Onda 0 não pegou

A varredura anterior não cobriu mensagens de erro do domínio nem dados de seed. Corrigidos:
"Sem permissao para responder conversas", "Etapa invalida para este funil", "Conversa invalida",
"Mensagem invalida", "Pagina não encontrada", `Media` → `Média` no rótulo de prioridade, e vários
literais de seed (`R$ 597/mes`, `Preco acima do orcamento`, `Ha 3 h`, `Sab`, `Joao`).

---

## 9. Cobertura contra o documento de funcionalidades

| § | Seção | Estado | Principal lacuna |
|---|---|---|---|
| 3 | Shell global | **Bom** | Busca global, gaveta no celular, toast em tempo real |
| 4 | Auth e onboarding | **Bom** | Login, cadastro, sessão e RBAC reais. Falta `/redefinir-senha` |
| 5 | Dashboard | **Bom** | Três faixas; período agora muda os dados; falta estado de conta nova |
| 6 | **Conversas** | **Bom** | Prioridade, atribuição, etiquetas, filtros, template HSM e anexos feitos. Faltam reply e reações |
| 7 | Kanban | Parcial | Criar oportunidade, etapas reais, tarefas, anexos, filtros |
| 8 | Contatos | Parcial | **Etiquetar feito.** Faltam CRUD, segmentos, exportar, mesclar |
| 9 | Agentes de IA | Parcial | **Builder de fluxo feito.** Falta criar agente e upload de base |
| 10 | Automações | **Bom** | Construtor e conflito calculado feitos. Falta editar macro |
| 11 | Integrações | Parcial | Só WhatsApp é real; webhooks e tokens estáticos |
| 12 | Campanhas | Parcial | O wizard não conclui; sem pausar; sem relatório por destinatário |
| 13 | Relatórios | **Bom** | Exportação CSV e comparação feitas. Faltam filtros |
| 14 | Equipe e permissões | Parcial | **Permissões agora valem de verdade.** Falta convidar e editar papel |
| 15 | Configurações | **Bom** | Base de conhecimento e caixas de entrada feitas. Falta CRUD das demais |
| 16 | Perfil | Parcial | **Sair funciona.** Faltam tema, idioma, trocar senha, foto |
| 17 | Notificações | **Bom** | Toast e marcação individual feitos. Falta paginação |

---

## 10. Decisões ainda em aberto

**1. ~~Demo ou produto?~~** Respondido: **os dois**, frontend primeiro. Foi o que motivou a ordem
0 → 4.

**2. ~~Persistência.~~** Respondida: SQLite + Prisma, sem credencial nenhuma. Ver a seção 5.
O próximo passo é Supabase — e ele mudou de "decisão em aberto" para "migração mecânica de três
passos", descrita em 5.5.

**3. ~~Autenticação.~~** Respondida: JWT próprio, com `scrypt`, cookie `httpOnly` e revogação em
banco. Ver a seção 6. O que resta é redefinição de senha por e-mail (depende de serviço de entrega)
e multi-workspace (depende de uma tabela de vínculo).

**4. ~~Anexos de saída no WhatsApp.~~** Respondido pela Onda 1: arquivo e voz enviam. Resta uma
decisão pequena — **transcodificar áudio no servidor** (ffmpeg) para garantir a reprodução do
push-to-talk em qualquer aparelho. Ver 4.6.

**5. Backend completo.** Todo o §3 do `CONTEXTO-HANDOFF.md` continua fora deste plano: WhatsApp
Cloud API, Anthropic para os agentes, engine de automações, SLA, fila de campanhas, CSAT, webhooks
com HMAC. Esse é o item mais caro do projeto e precisa de plano próprio.

---

## 11. O que não mexer

- A separação de camadas e a regra de ESLint que isola `src/core`.
- As regras de negócio no domínio: janela HSM, nota interna, dinheiro em centavos, `accountId`.
- Validação Zod nas Server Actions.
- Estado de navegação na URL — compartilhável e renderizável no servidor.
- A decisão de não usar biblioteca de gráficos: sparkline e área são SVG de ~40 linhas.
- Drag-and-drop nativo no Kanban.
- Os tokens de tema claro/escuro em `globals.css`.

### Convenções novas, a partir da Onda 4

- **Raio:** use `rounded-surface | control | float | bubble | full`. Nunca `rounded-lg`,
  `rounded-xl` ou `rounded-[Npx]`.
- **Tipografia:** use `text-micro | meta | body | ui | title | metric | display`
  (mais `hero`, exclusivo das telas de entrada). Nunca `text-xs` nem `text-[12.5px]`.
- **Recipiente:** `SectionTitle` é o padrão. `<Card>` só quando o bloco for uma unidade acionável.
- **Controle não implementado:** `{...planned('o que ele vai fazer')}`, nunca um `onClick` vazio.

### Convenções novas, a partir da Onda 2 e da autenticação

- **Adaptador novo entra pelo `container.ts`.** Repositório concreto não é importado por tela,
  caso de uso nem domínio — nunca.
- **Coluna relacional ou JSON?** Relacional se algo consulta, filtra ou escreve aquilo
  individualmente. JSON se o agregado só é lido e gravado inteiro.
- **Coluna nula não vira propriedade `undefined`.** O projeto usa `exactOptionalPropertyTypes`:
  `{ email: undefined }` não é `{}`, e o domínio espera o segundo. Os mapeadores fazem isso com
  espalhamento condicional.
- **Página do workspace começa com o guarda de permissão.** Esconder o item na rail não protege
  nada: a URL direta entra.
- **Rota de API responde 401**, nunca redireciona. Página redireciona.
- **Erro de autenticação não diferencia causa.** Nem na mensagem, nem no tempo de resposta.

### Convenções novas, a partir da Onda 1

- **Identidade vem do servidor.** O cliente manda o id; nome, etiqueta e template são resolvidos no
  servidor a partir dos dados da conta. Aceitar o rótulo junto com o id é deixar o cliente mentir.
- **Escrita otimista sempre com reversão.** Aplique o efeito localmente, guarde o instantâneo e
  restaure se a ação falhar. Uma tela mostrando transferência que não aconteceu é pior que meio
  segundo de espera.
- **Painel flutuante é `Menu`**, não um `useState` novo — fechar no Esc, fechar ao clicar fora e
  devolver o foco já estão lá.
- **Arquivo vai por `FormData`.** Nunca base64 dentro de JSON.

### Convenções novas, a partir da Onda 5

- **`loading.tsx` só em segmento sem rota dinâmica filha.** Em `/algo/[id]`, o esqueleto vai num
  `<Suspense>` dentro da página, depois da verificação de existência — senão o `notFound()` perde o
  status. Ver 7.8.
- **Aviso derivado, nunca escrito.** Conflito de automação, problema de fluxo, expediente aberto: o
  texto sai de uma função pura do domínio. Um alerta em JSX fixo mente assim que o estado muda.
- **Divisória de grade:** `gap-px` sobre fundo `bg-line`, não `border-l` no filho — funciona com
  qualquer número de colunas e não deixa fio solto ao quebrar linha.
- **Tempo real:** inscreva-se em `useConversationEvents`. Não abra `EventSource` novo.
- **Aviso efêmero:** `useToast()`. Sempre com `dedupeKey` quando a origem pode repetir.
- **Relógio no cliente.** Qualquer coisa que dependa de "agora" (aberto/fechado, contagem) só é
  decidida depois da montagem — no servidor dá divergência de hidratação e valor congelado no build.
- **Exportação no servidor.** CSV sempre por route handler, com `can()` e `toCsv` (que já protege
  contra injeção de fórmula). Nunca montar arquivo no cliente.
