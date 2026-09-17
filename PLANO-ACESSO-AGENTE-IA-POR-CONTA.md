# Plano: habilitar o agente de IA por conta

> Documento de implementacao. O objetivo e controlar a disponibilidade da IA por conta sem
> confundir essa liberacao comercial com permissoes de usuario ou com o estado ativo de um agente.

## 0. Objetivo

Adicionar, na ficha de cada conta do painel da plataforma, um controle exclusivo do
superadministrador para **conectar** ou **desconectar o agente de IA** daquela conta.

Quando o acesso estiver desligado:

- a conta nao vera os botoes **Pausar IA** e **Iniciar IA** no cabecalho das conversas;
- a area **Agentes de IA** nao aparecera na navegacao nem na busca global;
- abrir `/agentes-ia` diretamente nao concedera acesso;
- Server Actions chamadas diretamente recusarao operacoes de IA;
- webhooks comuns continuarao funcionando, mas nunca deverao autorizar o agente externo a
  responder;
- configuracoes e agentes ja cadastrados serao preservados para uma futura reativacao.

Quando estiver ligado, as permissoes existentes continuam valendo. Liberar a conta nao concede a
todo usuario o direito de ver, editar ou controlar a IA.

---

## 1. Decisoes de produto

| Tema | Decisao |
|---|---|
| Nome do campo | `Account.aiAgentAccessEnabled` |
| Valor padrao | `false` para novas contas e para contas sem liberacao explicita |
| Onde administrar | Ficha da conta em `/plataforma/[accountId]`, aba **Visao geral** |
| Quem pode alterar | Somente superadministrador autenticado na plataforma |
| Acao positiva | Botao **Conectar agente de IA** |
| Acao negativa | Botao **Desconectar agente de IA**, com confirmacao |
| Ao desconectar | Bloquear uso, esconder interfaces e preservar todos os dados/configuracoes |
| Agentes existentes | Nao apagar e nao mudar `AiAgent.active`; a habilitacao da conta prevalece sobre esse estado |
| Pausas existentes | Preservar `Conversation.aiPaused*`; elas voltam a ter efeito se o acesso for reativado |
| Feature flag global | `FEATURES.agentesIA` continua como chave geral de emergencia/rollout |
| Regra efetiva | IA disponivel somente quando `FEATURES.agentesIA && account.aiAgentAccessEnabled` |
| Permissoes | Continuam separadas: `agentes-ia:*` para configuracao e `conversas:responder` para pausar/iniciar |

O termo **conectar** representa a liberacao da funcionalidade para a conta. Ele nao cria um agente,
nao ativa automaticamente um agente cadastrado e nao cadastra webhook.

---

## 2. Fatos verificados no codigo atual

| Fato | Onde |
|---|---|
| `Account` ainda nao possui habilitacao de IA por conta | `prisma/schema.prisma` |
| A sessao expoe a conta pelo tipo de dominio `Account` | `src/core/domain/user.ts` e `src/infrastructure/auth/session.ts` |
| O painel da plataforma ja tem ficha por conta e acoes protegidas por `readSuperAdmin()` | `src/app/(platform)/plataforma/[accountId]/page.tsx` e `account-actions.ts` |
| A navegacao de IA hoje depende apenas da flag global e da permissao | `src/config/navigation.ts` e `src/app/(workspace)/layout.tsx` |
| A busca global monta sua propria lista de navegacao | `src/components/layout/topbar.tsx` |
| As paginas e actions de agentes conferem a flag global, mas nao a conta | `src/app/(workspace)/agentes-ia/**` |
| O botao de pausa/inicio sempre e renderizado no chat | `src/features/conversas/components/chat-panel.tsx` |
| A action de pausa exige `conversas:responder`, mas nao exige acesso da conta a IA | `src/core/use-cases/triage-conversation.ts` e `src/app/(workspace)/conversas/actions.ts` |
| O agente externo recebe `agentePausado` pelo webhook | `src/infrastructure/webhooks/webhook-dispatch.ts` |
| Webhooks tambem servem a integracoes que nao sao IA | `src/infrastructure/webhooks/webhook-dispatch.ts` |
| Resposta pelo celular pode gravar pausa automatica do agente | `src/infrastructure/whatsapp/wa-store.ts` e caminhos equivalentes da Cloud API |

Consequencia: a protecao precisa existir na interface **e** no servidor. Esconder o botao isoladamente
deixaria as actions acessiveis e poderia manter o agente externo respondendo.

---

## 3. Modelo de dados e migracao

### 3.1 Campo aditivo

Em `prisma/schema.prisma`:

```prisma
model Account {
  // ...
  aiAgentAccessEnabled Boolean @default(false)
}
```

Criar uma migracao somente aditiva, por exemplo:

```sql
ALTER TABLE "Account"
ADD COLUMN "aiAgentAccessEnabled" BOOLEAN NOT NULL DEFAULT false;
```

Um booleano na conta e suficiente para esta necessidade. Nao criar agora uma tabela generica de
entitlements: ela so passa a compensar quando houver varias funcionalidades comercializadas por
conta, validade, cotas ou historico proprio.

### 3.2 Contas que ja usam IA em producao

O `DEFAULT false` desligara o acesso efetivo quando o codigo passar a aplicar a nova regra. Antes de
ativar a verificacao:

1. levantar uma lista explicita dos `accountId` que ja devem continuar com IA;
2. aplicar `aiAgentAccessEnabled = true` somente nessa lista;
3. conferir a lista com o responsavel comercial/operacional;
4. so entao publicar o codigo que faz o bloqueio valer.

Nao inferir automaticamente a liberacao apenas pela existencia de `AiAgent`: dados de demonstracao
ou configuracoes incompletas poderiam conceder acesso indevido.

---

## 4. Capacidade central e sessao

### 4.1 Projetar o campo no dominio

- Adicionar `readonly aiAgentAccessEnabled: boolean` a `Account` em
  `src/core/domain/user.ts`.
- Atualizar `toDomainAccount` em `src/infrastructure/auth/session.ts` para mapear o campo.
- Garantir que tanto a sessao comum quanto `platformSession` recebam o valor atual do banco.
- Atualizar os demais mapeadores manuais de `Account`, em especial autenticacao por token de API,
  seeds/fakes e scripts tipados encontrados pelo typecheck.

Nao colocar o valor dentro do JWT. A leitura atual da conta no banco faz uma revogacao valer na
requisicao seguinte, sem esperar o cookie expirar.

### 4.2 Uma unica regra de disponibilidade

Criar um helper puro, com nome semelhante a:

```ts
export const hasAiAgentAccess = (account: Pick<Account, 'aiAgentAccessEnabled'>): boolean =>
  FEATURES.agentesIA && account.aiAgentAccessEnabled;
```

Se importar `FEATURES` no dominio criar dependencia invertida, manter dois helpers pequenos:

- um helper de dominio que le somente `account.aiAgentAccessEnabled`;
- um helper de aplicacao/configuracao que combina a habilitacao com `FEATURES.agentesIA`.

Nao repetir expressoes soltas pelas telas. A regra precisa ser identica para sessao normal,
atuacao do superadministrador, paginas, actions e chat.

---

## 5. Painel da plataforma

### 5.1 Card de acesso

Criar `src/features/plataforma/components/account-ai-access-card.tsx` e renderiza-lo na aba
**Visao geral** de `src/app/(platform)/plataforma/[accountId]/page.tsx`.

O card deve exibir:

- titulo **Agente de IA**;
- badge **Conectado** ou **Sem acesso**;
- explicacao curta de que a liberacao controla a conta inteira;
- **Conectar agente de IA** quando desligado;
- **Desconectar agente de IA** quando ligado;
- estado de carregamento que impeça clique duplo;
- feedback de sucesso ou erro sem assumir sucesso antes da resposta do servidor.

Incluir `aiAgentAccessEnabled` no `select` da conta e passar o estado ao componente. O botao deve
ficar na ficha da conta, e nao dentro do workspace em modo de atuacao: assim a acao administrativa
continua no contexto em que a conta-alvo esta claramente identificada.

### 5.2 Server Action administrativa

Adicionar a `src/app/(platform)/plataforma/account-actions.ts` uma action idempotente, por exemplo:

```ts
setAccountAiAgentAccessAction({ accountId, enabled })
```

Requisitos:

- validar entrada com Zod;
- chamar `readSuperAdmin()`/`exigirSuperAdmin()` antes da consulta e da escrita;
- buscar a conta pelo `accountId` e recusar conta inexistente ou excluida;
- atualizar somente `aiAgentAccessEnabled`;
- aceitar repeticao do mesmo estado sem corromper dados;
- auditar em `AuditLogEntry` com ator da plataforma, estado anterior, estado novo e
  `plataforma: true`;
- revalidar `/plataforma/[accountId]` e o layout do workspace;
- nao apagar agentes, webhooks, agendas ou pausas.

A desconexao deve pedir confirmacao na interface. Nao e necessario exigir que o nome da conta seja
digitado: a acao e reversivel e nao remove dados.

---

## 6. Interface do workspace

### 6.1 Navegacao, busca e URL direta

Filtrar o item `agentes-ia` por capacidade da conta, alem do RBAC atual, em todos os consumidores de
`NAV_ITEMS`:

- `src/app/(workspace)/layout.tsx` (rail e menu mobile);
- `src/components/layout/topbar.tsx` (busca global);
- consumidores adicionais encontrados por `rg "NAV_ITEMS|reachesNavItem"`, como o Kanban.

Preferir uma funcao central `navItemsForSession(session)` ou fazer `reachesNavItem` aceitar as
capacidades da conta. Nao adicionar filtros diferentes em cada componente.

Nas paginas `src/app/(workspace)/agentes-ia/page.tsx` e `[id]/page.tsx`, depois de resolver a sessao:

1. conferir a flag global;
2. conferir `hasAiAgentAccess(session.account)`;
3. conferir a permissao `agentes-ia:ler`;
4. somente depois consultar agentes.

Para conta sem liberacao, redirecionar para `/conversas` ou responder `notFound()`, adotando a mesma
convencao nas duas rotas. Nao mostrar `AccessDenied` de permissao para um produto que a conta nao
possui.

### 6.2 Botoes no header da conversa

Em `InboxData`, calcular:

```ts
const canControlAi =
  hasAiAgentAccess(session.account) && can(session, 'conversas:responder');
```

Propagar essa capacidade por `InboxWorkspace` ate `ChatPanel`. Renderizar `AiPauseButton` somente
quando `canControlAi` for verdadeiro. Com isso, contas sem acesso nao recebem **Pausar IA** nem
**Iniciar IA**, e usuarios que nao podem responder tambem nao recebem um controle que o servidor
recusaria.

O contrato recomendado e explicito (`canControlAi: boolean`), em vez de deduzir disponibilidade
pela presenca de uma callback. A callback pode continuar opcional como segunda protecao no cliente.

Ao desligar o acesso enquanto uma tela estiver aberta, a mudanca deve valer no proximo refresh ou
navegacao. Atualizacao instantanea por realtime nao faz parte desta primeira entrega.

---

## 7. Protecoes no servidor

### 7.1 Actions e casos de uso

Todas as actions em `src/app/(workspace)/agentes-ia/actions.ts` devem, depois de obter a sessao e
antes de acessar repositorios, recusar contas sem acesso. Centralizar esse guard para nao esquecer
`create`, ativacao, regras, fluxo e sandbox.

Em `createSetAiPause`, conferir as duas condicoes:

- `hasAiAgentAccess(session.account)`;
- `can(session, 'conversas:responder')`.

Retornar `FORBIDDEN` com mensagem neutra como **Agente de IA nao esta disponivel para esta conta**.
Essa checagem impede que uma chamada manual da Server Action contorne a interface.

Os repositorios continuam escopados por `accountId`; a nova habilitacao nao substitui isolamento de
tenant nem permissao.

### 7.2 Webhooks e agente externo

Nao desligar todos os webhooks quando a IA estiver indisponivel. Eles tambem podem alimentar
integracoes legitimas da conta.

Em `dispararWebhooks`, carregar a habilitacao da conta e calcular:

```ts
const pausado = !acessoIa || !noHorario || pausadoPorConversa;
```

Manter a entrega do evento, mas enviar:

- `agentePausado: true` quando a conta nao possui acesso;
- `agenteNoHorario` com o significado atual de agenda, sem falsificar horario;
- opcionalmente um novo campo de payload versionado, como `agenteHabilitado: false`, se o consumidor
  externo precisar distinguir falta de acesso de uma pausa.

Antes de adicionar `agenteHabilitado`, validar compatibilidade do contrato com o n8n/consumidor. A
regra de seguranca nao pode depender de ele adotar o campo novo: `agentePausado: true` continua sendo
a trava efetiva.

### 7.3 Pausas automaticas

Os caminhos que aplicam `resposta_no_celular` nao devem gravar pausa de IA quando a conta nao tem
acesso. Aplicar o guard no ponto comum que decide a pausa ou em todos os ingressos:

- Baileys/worker;
- motor in-process, enquanto existir;
- WhatsApp Cloud API.

Isso evita estado de IA aparecendo em contas que nao contrataram o recurso. Mesmo assim, o webhook
continua protegido conforme a secao anterior.

---

## 8. Ordem de implementacao

### Fase 1 - Persistencia e dominio

1. adicionar o campo Prisma e a migracao;
2. atualizar `Account`, sessao, mapeadores e fakes;
3. criar o helper central de capacidade;
4. executar Prisma generate e typecheck.

### Fase 2 - Administracao da conta

1. criar a Server Action exclusiva do superadministrador;
2. registrar auditoria de antes/depois;
3. criar o card e o fluxo de confirmacao;
4. validar estados de carregamento, sucesso e erro.

### Fase 3 - Bloqueio do workspace

1. filtrar navegacao e busca;
2. proteger paginas e actions de agentes;
3. esconder o botao no chat;
4. proteger `createSetAiPause` contra chamada direta.

### Fase 4 - Execucao externa

1. fazer conta sem acesso produzir `agentePausado: true` nos webhooks;
2. impedir novas pausas automaticas desnecessarias;
3. validar os tres motores/caminhos de WhatsApp;
4. testar que webhooks nao relacionados a IA continuam sendo entregues.

### Fase 5 - Rollout

1. migrar banco sem ainda depender do novo campo;
2. preencher a allowlist das contas ja autorizadas;
3. publicar o codigo de enforcement;
4. conferir auditoria e comportamento em uma conta habilitada e outra desabilitada.

---

## 9. Testes obrigatorios

### 9.1 Persistencia e sessao

- conta nova nasce com `aiAgentAccessEnabled = false`;
- sessao comum recebe o valor correto;
- atuacao do superadministrador recebe o valor correto;
- alternar o campo passa a valer na requisicao seguinte;
- uma conta nao consegue ler nem alterar a habilitacao de outra.

### 9.2 Painel da plataforma

- somente superadministrador consegue chamar a action;
- habilitar e desabilitar sao idempotentes;
- conta inexistente/excluida e recusada;
- o card troca badge e acao depois do sucesso;
- a auditoria registra ator, conta, valor anterior e novo;
- falha no servidor nao deixa a interface exibindo o estado incorreto.

### 9.3 Workspace e RBAC

- conta sem acesso nao ve Agentes de IA na rail, menu mobile ou busca;
- URL direta de lista e detalhe nao exibe dados;
- actions diretas de agente sao recusadas;
- conta habilitada sem `agentes-ia:ler` continua sem ver a area;
- conta habilitada com permissao ve a area normalmente;
- conta sem acesso nao ve **Pausar IA** nem **Iniciar IA**;
- conta habilitada com `conversas:responder` ve e usa o botao;
- usuario sem `conversas:responder` nao ve o botao e a action tambem o recusa.

### 9.4 Webhook e canais

Estender `scripts/test-pausa-do-agente.ts`, `scripts/test-horario-do-agente.ts` e
`scripts/test-webhook.ts` ou criar um teste dedicado para provar:

- conta sem acesso envia `agentePausado: true` mesmo dentro do horario e sem pausa na conversa;
- conta habilitada preserva as regras atuais de horario e pausa;
- desconectar nao interrompe webhooks genericos;
- resposta pelo celular nao cria pausa automatica numa conta sem acesso;
- reabilitar restaura o comportamento usando as configuracoes preservadas.

### 9.5 Regressao e qualidade

Executar, no minimo:

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm run check:tenant
npm run worker:build
npm run build
```

Executar tambem os scripts de pausa, horario e webhook contra um banco de teste. Nao usar o banco de
producao para testes destrutivos.

---

## 10. Criterios de aceite

- [ ] O superadministrador consegue conectar e desconectar IA na ficha de uma conta.
- [ ] A alteracao fica auditada e nao pode ser executada por usuario da conta.
- [ ] Contas novas e nao liberadas ficam sem acesso por padrao.
- [ ] Conta sem acesso nao ve item de navegacao, busca, paginas ou controles de IA.
- [ ] Conta sem acesso nao consegue contornar o bloqueio chamando actions diretamente.
- [ ] Os botoes **Pausar IA** e **Iniciar IA** so aparecem quando conta e usuario podem usa-los.
- [ ] Webhooks comuns continuam sendo entregues ao desconectar a IA.
- [ ] O payload impede o agente externo de responder enquanto a conta esta sem acesso.
- [ ] Agentes, fluxos, agendas e pausas existentes nao sao apagados ao desconectar.
- [ ] Reativar a liberacao restaura o funcionamento anterior sem reconfiguracao.
- [ ] A allowlist de producao e aplicada antes do enforcement.
- [ ] Typecheck, lint, build, isolamento de tenant e testes de webhook passam.

---

## 11. Fora do escopo desta entrega

- cobranca automatica, plano, trial ou data de expiracao da IA;
- cotas de mensagens/tokens;
- conectar provedor de modelo ou credenciais por conta;
- criar um agente automaticamente ao liberar acesso;
- apagar configuracoes ao revogar acesso;
- atualizar em tempo real todas as abas ja abertas quando o superadministrador alternar o acesso.

Se essas necessidades surgirem, o booleano pode evoluir para um agregado de entitlement sem mudar a
regra desta entrega: a conta precisa ter uma capacidade explicita antes de qualquer usuario ou agente
poder usa-la.
