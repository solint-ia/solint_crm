# Plano: reativar a importação do histórico do WhatsApp

> Documento de execução. Leia inteiro antes de começar. As fases são sequenciais: não avance
> com uma fase sem que a anterior esteja com typecheck, lint e testes passando.

## 0. Objetivo

Ao parear um número, permitir importar as mensagens dos últimos **N dias** (padrão: não importar)
**sem** que mensagens antigas se comportem como novas. A importação:

- preenche lacunas em conversas existentes sem mexer no estado delas;
- cria conversas que ainda não existem, sem disparar nada;
- nunca envia mensagem ao cliente, nunca aciona IA/webhook/automação/notificação;
- é identificável e reversível (`Message.origin = 'historico'`, `Conversation.importedAt`).

Motor alvo: **worker** (`WA_ENGINE=worker`, o de produção). O motor in-process continua descartando
o histórico; só recebe o ajuste de segurança da Fase 0.1.

---

## 1. Fatos verificados (código e referências)

### 1.1 No projeto

| Fato | Onde |
|---|---|
| O histórico já chega, mas as mensagens são descartadas; só contatos são memorizados | `src/infrastructure/whatsapp/worker/session.ts` (listener `messaging-history.set`, ~l.1235) e `whatsapp-service.ts` (~l.405) |
| `syncFullHistory: false`, sem `shouldSyncHistoryMessage` explícito | `session.ts` ~l.804, `whatsapp-service.ts` ~l.385 |
| Gravação ao vivo: `commitMessage` soma não lidas, reabre resolvida (zera CSAT, abre protocolo), arma SLA, grava outbox de webhook, roda compliance (opt-out), respostas automáticas, automações, pausa do agente (`fromMe`) e anuncia | `src/infrastructure/whatsapp/wa-store.ts` `commitMessage` / `attachToConversation` / `createConversationWith` |
| `lastMessagePreview`/`lastActivityAt` são sobrescritos sem comparar datas | `attachToConversation` |
| `createConversationWith` não define `createdAt` (vira "agora") | `wa-store.ts` |
| Dedupe de mensagem: id `msg-wa-${conversationId}-${key.id}` + `createMany({ skipDuplicates })` + `@@unique([conversationId, externalId])` | `session.ts` ~l.2269, `prisma/schema.prisma` |
| `resolveStoredIds` procura conversa **só na caixa da sessão** (conversa movida de caixa não é achada) | `wa-store.ts` ~l.82 |
| Duas caixas da mesma conta com o mesmo cliente **devem** ter conversas separadas | `scripts/test-caixas-mesmo-numero.ts` |
| `ensureContact` zera `deletedAt` (ressuscita contato arquivado) e sobrescreve `name`; `resolveContact` põe `lastContactAt = agora` | `wa-store.ts`, `session.ts` |
| **Mensagem de espera**: varre conversas `aberta/espera` com `lastActivityAt` nas últimas 12 h e envia texto ao cliente se a última mensagem é do contato | `src/infrastructure/scheduling/waiting-message-runner.ts`, `inbox-auto-messages.ts` `runWaitingAutoReply` |
| **Primeira resposta** é medida contra a primeira mensagem do contato **de todas** (`orderBy createdAt asc`) | `src/infrastructure/repositories/prisma/conversation-repository.ts` ~l.255 |
| Dashboard conta volume por `Conversation.createdAt` e "sem resposta" por `firstResponseSecs = null` | `src/infrastructure/repositories/prisma/analytics-repository.ts` `carregar` |
| SLA runner olha `slaDeadlineAt` em conversas não resolvidas | `src/infrastructure/scheduling/sla-runner.ts` |
| A conversa carrega só as **200** mensagens mais recentes; não existe "carregar anteriores" | `mappers.ts` `CONVERSATION_TIMELINE_LIMIT` |
| Logout apaga credenciais e grava `phoneJid = null`; `Inbox.identifier` guarda o último número conectado | `session.ts` `logout` / `updateStatus` |
| Fila de comandos é serial por caixa (um download lento seguraria envios) | `worker/command-consumer.ts` |
| Cifra AES-256-GCM já existe (`seal`/`open`) | `src/infrastructure/whatsapp/auth/crypto.ts` |
| Baileys instalado `7.0.0-rc14` com `^` no `package.json` | `package.json` |

### 1.2 No Baileys instalado (`node_modules/@whiskeysockets/baileys/lib`)

- Padrão `shouldSyncHistoryMessage`: aceita tudo menos `FULL` (`Defaults/index.js`).
- `syncFullHistory` vira `requireFullSync` no **registro do aparelho** (`Utils/validate-connection.js`);
  `historySyncConfig.recentSyncDaysLimit` é fixo `undefined` (não há como pedir dias sem patch).
- Cada bloco traz **conversas com as mensagens dentro** (`Utils/history.js` `processHistoryMessage`).
- Mapeamentos LID↔PN do bloco são gravados **antes** de emitir `messaging-history.set`
  (`Utils/process-message.js`).
- Em reconexão (`creds.accountSyncCounter > 0`) o servidor não reenvia histórico (`Socket/chats.js`).
- Conclusão sinalizada por `messaging-history.status` (`complete` com progress 100, ou `paused`
  após 120 s sem blocos) (`Socket/chats.js`).
- `fetchMessageHistory(count, oldestKey, oldestTs)` pede ao celular; resposta chega como
  `messaging-history.set` com `syncType ON_DEMAND` e `peerDataRequestSessionId`.

### 1.3 Referências externas

- Baileys, eventos (`messaging-history.set` chega após `open` e antes de
  `receivedPendingNotifications`; `progress` 0-100; iterar todas as mensagens):
  https://baileys.wiki/concepts/events
- Em 7.0.0-rc.9, `syncFullHistory:false` sem `shouldSyncHistoryMessage` explícito desligava **todos**
  os tipos, quebrando mapeamentos LID e recebimento; correção foi declarar o callback:
  https://github.com/NousResearch/hermes-agent/issues/11951
- `fetchMessageHistory` enviado com sucesso e nunca respondido para aparelho vinculado (rc.9):
  https://github.com/WhiskeySockets/Baileys/issues/2452
- `isLatest` não confiável: https://github.com/WhiskeySockets/Baileys/issues/2005
- Evolution API (Baileys) usa `importMessages` + `daysLimitImportMessages`, filtra por
  `messageTimestamp` e pula ids já gravados:
  https://doc.evolution-api.com/v2/api-reference/integrations/chatwoot/set-chatwoot ·
  https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
- Falhas de importação em conversas `@lid`: https://github.com/EvolutionAPI/evolution-api/issues/2478
- whatsmeow expõe `FullSyncDaysLimit`/`RecentSyncDaysLimit` no registro do aparelho (dica ao
  celular, não garantia): https://pkg.go.dev/github.com/snaril/whatsmeow/proto/waCompanionReg
- Histórico completo não é reenviado em reconexão: https://github.com/tulir/whatsmeow/discussions/1033
- FAQ oficial sobre histórico em aparelhos conectados: https://faq.whatsapp.com/653480766448040

**Consequências para o produto** (colocar na tela, sem prometer mais que isso):
o celular decide quanto envia; o histórico só vem **no primeiro pareamento**; o celular precisa
ficar online durante a importação; pedir N dias não garante N dias completos.

---

## 2. Decisões de produto (padrões deste plano)

| Tema | Decisão |
|---|---|
| Opções | Não importar (padrão), 7, 15, 30 dias; 90 dias usa sincronização completa e avisa que pode demorar |
| Quando vale | Só em pareamento novo (sem credenciais). Caixa já pareada: opção desabilitada com explicação |
| Conversa nova importada | `status 'resolvida'`, `statusLabel 'Histórico importado'`, `resolvedAt null`, sem protocolo. Exceção: última mensagem do contato há menos de 24 h → `status 'aberta'` (ainda sem não lidas, SLA ou automações) |
| Conversa existente | Só recebe as mensagens que faltam; status, não lidas, SLA, CSAT, atribuição, caixa e `channelThreadId` não mudam |
| Grupos | Não importar |
| Mídia | Nunca baixar na importação; baixar no primeiro clique (Fase 5) |
| Número diferente do anterior | Não importar; avisar |
| Buscar anteriores no celular | Experimental, atrás de flag (Fase 6) |
| Liga/desliga | `WA_HISTORY_IMPORT=1` no web e no worker; ausente = recurso escondido e ignorado |

---

## 3. Riscos e mitigação

| # | Risco | Mitigação (fase) |
|---|---|---|
| 1 | Não lidas infladas | Importação nunca toca `unreadCount` (3) |
| 2 | Reabrir resolvida, zerar CSAT, abrir protocolo | Caminho de gravação próprio, sem `reopening` (3) |
| 3 | SLA/prazo falso | Não chama `calcularSla`; não grava `slaDeadlineAt` (3) |
| 4 | Webhook da caixa (incluindo o fluxo de IA no n8n), automações, respostas automáticas, notificação | Nenhuma das três portas de webhook é usada (3.5); não chama `dispararAutomacoes`/`runInboundAutoReplies`/`announce` (3) |
| 5 | "Sair" antigo marcar opt-out | Não chama `applyInboundComplianceIntent` (3) |
| 6 | Pausa do agente por mensagem `fromMe` antiga | Não chama `aplicarPausaDoAgente` (3) |
| 7 | Prévia/ordem regredindo | Update condicional: só se a mensagem importada for mais nova que `lastActivityAt` (3) |
| 8 | **Mensagem de espera enviada ao cliente** por conversa importada | Guarda `origin === 'historico'` em `runWaitingAutoReply` (4) |
| 9 | Primeira resposta de dias | Consulta ignora `origin = 'historico'` (4) |
| 10 | Dashboard contando importadas como atendimentos novos | `importedAt: null` nas consultas por `createdAt` (4) |
| 11 | Contato arquivado ressuscitado / nome sobrescrito | `ensureContactFromHistory` sem `deletedAt: null`, só preenche nome vazio (3) |
| 12 | Conversa movida de caixa vira duplicata | Busca em outras caixas **só com prova** (mesmo `externalId`) (3) |
| 13 | Mesclar conversas de duas caixas com o mesmo cliente | A mesma prova por `externalId`; sem prova, cria na caixa atual (3) |
| 14 | Histórico de outro número misturado | `historyOwnerPhoneJid` comparado ao número pareado (1, 3) |
| 15 | Duplicar mensagens enviadas pelo CRM | Dedupe por `externalId` na conversa (já existe) + teste (3) |
| 16 | LID sem telefone gerando conversa duplicada | Usar `chats[].pnJid/lidJid` do bloco antes de resolver identidade; registrar contagem de LIDs sem PN (3) |
| 17 | Importação disputar o banco com mensagens ao vivo | Fila própria com concorrência 1, lotes, `setImmediate` entre lotes (3) |
| 18 | Memória do worker com blocos grandes | Filtrar por data **ao receber**, antes de enfileirar; teto da fila (3) |
| 19 | Worker reiniciar no meio | Inserções idempotentes; status `parcial` no boot se ficou `importando` (3) |
| 20 | Timeline mostra só 200 | Paginação "carregar anteriores" do banco (0) |
| 21 | Bucket cheio de mídia antiga | Mídia sob demanda (5) |
| 22 | Download de mídia travar a fila serial da caixa | Download fora da raia, limitador próprio (5) |
| 23 | Baileys mudar comportamento entre rcs | `shouldSyncHistoryMessage` explícito + versão exata (0) |
| 24 | Pedido sob demanda sem resposta | Flag, timeout, mensagem honesta (6) |
| 25 | LGPD: armazenar dado antigo sem decisão | Opção explícita, padrão "não importar", auditoria de quem pediu (2, 3) |
| 26 | Reverter | Script de remoção por `origin`/`importedAt` (8) |

---

## 4. Fase 0: pré-requisitos

### 0.1 Callback explícito e versão fixa

- Em `session.ts` e `whatsapp-service.ts`, passar em `makeWASocket`:
  ```ts
  shouldSyncHistoryMessage: ({ syncType }) =>
    syncType !== proto.HistorySync.HistorySyncType.FULL || this.historyImportWantsFull(),
  ```
  No in-process, `historyImportWantsFull` é sempre `false`. Comentar o motivo (issue hermes-agent #11951).
- `package.json`: trocar `"^7.0.0-rc14"` por `"7.0.0-rc14"` e conferir que o lockfile não muda de versão.

### 0.2 Tipo de origem

- `src/core/domain/message.ts`: `MessageOrigin = 'crm' | 'canal' | 'historico'`.
- Procurar usos de `origin === 'canal'` / `'canal'` na interface e tratar `'historico'` igual a
  `'canal'` nos rótulos (é mensagem que veio do aparelho).

### 0.3 Paginação da timeline

- Porta + repositório: `listMessagesBefore(accountId, conversationId, cursor: { createdAt, id }, limit = 100, inboxAccess)`,
  ordenado por `createdAt desc, id desc`, escopado por conta e acesso à caixa.
- Server Action ou rota em `conversas`, com `can(session, 'conversas:ler')`.
- UI da conversa: botão "Carregar mensagens anteriores" no topo quando a timeline tiver o limite
  cheio; preservar a posição de rolagem; parar quando vier menos que `limit`.

---

## 5. Fase 1: modelo de dados (migração só aditiva)

`prisma/schema.prisma`:

```prisma
model WhatsAppConnection {
  // ...campos existentes
  /// Dias pedidos no último pareamento. Nulo ou 0 = não importar.
  historyImportDays      Int?
  /// Data de corte fixada no pedido, para a janela não andar durante a importação.
  historyImportCutoff    DateTime?
  /// aguardando | importando | concluida | parcial | nao_disponivel | numero_diferente | falha
  historyImportStatus    String?
  historyImportStartedAt DateTime?
  historyImportEndedAt   DateTime?
  /// JSON: { conversasCriadas, conversasAtualizadas, mensagens, duplicadas, foraDoPrazo, grupos, lidSemTelefone, midiasPendentes, progresso }
  historyImportStats     Json?
  /// Número dono do histórico gravado nesta caixa. NÃO é limpo no logout.
  historyOwnerPhoneJid   String?
}

model Conversation {
  // ...
  /// Criada pela importação do histórico. Nunca é limpa: é um fato.
  importedAt DateTime?
  @@index([accountId, importedAt])
}

/// Referência cifrada para baixar a mídia de uma mensagem importada sob demanda.
model PendingMedia {
  messageId String   @id
  accountId String
  inboxId   String
  kind      String   // image | video | audio | document | sticker
  mimeType  String
  sizeBytes Int
  /// proto WebMessageInfo mínimo (key, messageTimestamp, submensagem de mídia) cifrado com seal()
  cipher    Bytes
  iv        Bytes
  tag       Bytes
  keyId     String?
  status    String   @default("pendente") // pendente | baixando | indisponivel
  attempts  Int      @default(0)
  lastError String?
  createdAt DateTime @default(now())

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  @@index([accountId, inboxId, status])
}
```

- Adicionar a relação inversa em `Message` (`pendingMedia PendingMedia?`) e em `Inbox` se o
  padrão do schema pedir.
- Migração com `npm run db:migrate` (nome `historico_whatsapp`). Conferir que o SQL só tem
  `ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX` e FKs novas.
- Preenchimento na migração: `historyOwnerPhoneJid` = `phoneJid` quando não nulo; senão, `Inbox.identifier`
  quando terminar em `@s.whatsapp.net`.
- Rodar `npm run check:tenant` e incluir `pendingMedia` na lista de modelos escopados do script.

---

## 6. Fase 2: pareamento (tela, rota, fila)

### 2.1 Configuração pública

- Web lê `WA_HISTORY_IMPORT === '1'`. A rota de status da caixa passa a devolver
  `historyImportEnabled` e `paired` (existe `credsCipher`) para a tela decidir.
- Adicionar `WA_HISTORY_IMPORT=` comentado em `.env.example` e `deploy/env.production.example`.

### 2.2 Modal (`src/features/whatsapp/components/whatsapp-modal.tsx`)

- Abaixo da escolha QR/telefone, um seletor "Importar histórico": Não importar, Últimos 7 dias,
  15 dias, 30 dias, 90 dias.
- Texto de apoio (sem travessão, `npm run check:travessao`):
  "O celular envia as mensagens recentes só no primeiro pareamento. Ele decide quanto enviar, então
  o período pode vir incompleto. Mídias são baixadas quando alguém abrir."
- `paired = true`: seletor desabilitado com "Esta caixa já está pareada. Para importar, desconecte e
  conecte de novo."
- Engine `inprocess` ou flag desligada: seletor não aparece.
- Durante e depois da conexão: mostrar `historyImport` do status ("Importando histórico: 42%",
  "Histórico importado: 1.234 mensagens em 87 conversas", "Não importado: número diferente do anterior").

### 2.3 Hook e rota

- `use-whatsapp-connection.ts` `connect({ method, phoneNumber, historyDays })`.
- `src/app/api/inboxes/[inboxId]/whatsapp/connect/route.ts`: aceitar `historyDays` apenas em
  `{0, 7, 15, 30, 90}` (zod ou checagem explícita); qualquer outro valor = 400. Com flag desligada,
  ignorar.
- `WhatsAppPairingOptions` (`channel.ts`) ganha `historyDays?: number`.

### 2.4 Fila (`queue-channel.ts` `startSession`)

Dentro da transação existente:
- se `historyDays > 0` e a conexão **não** tem `credsCipher`: gravar `historyImportDays`,
  `historyImportCutoff = now - days`, `historyImportStatus = 'aguardando'`, limpar `Stats/StartedAt/EndedAt`;
- se tem `credsCipher`: não gravar nada de histórico;
- `historyDays = 0`: `historyImportStatus = null`, `historyImportDays = null`;
- incluir `historyDays` no payload e na comparação `mesmoPedido`.

### 2.5 Auditoria

Registrar em `AuditLogEntry` (usar o helper existente de auditoria) quem pediu a importação, a
caixa e os dias.

---

## 7. Fase 3: importador no worker

### 3.1 Arquivos

- `src/infrastructure/whatsapp/worker/history-import.ts`: classe `HistoryImporter` (uma por sessão).
  Recebe dependências injetadas para teste: `{ accountId, inboxId, getOwnJid, resolveIdentity, decode, now }`.
- `src/infrastructure/whatsapp/wa-history-store.ts`: persistência **sem Baileys** (como `wa-store.ts`),
  com `commitHistoryBatch`.
- Não alterar a semântica de `commitMessage`; reaproveitar funções puras de `wa-store.ts`
  exportando o que for preciso (ex.: variantes de telefone de `resolveStoredIds`).

### 3.2 Ciclo de vida na sessão (`session.ts`)

1. Em `start()`, após `initPostgresAuthState`, ler da `WhatsAppConnection`
   `historyImportDays/Cutoff/Status/OwnerPhoneJid`. Guardar em `this.historyImport`.
2. `syncFullHistory: this.historyImport?.status === 'aguardando' && days > 30`.
3. Se `status === 'aguardando'` e `state.creds.accountSyncCounter > 0`: gravar `nao_disponivel`
   (o celular não reenvia) e não importar.
   Atenção: depois do QR o socket reinicia (515) já com credenciais; por isso a condição é
   `accountSyncCounter`, **não** `isPaired`.
4. Listener `messaging-history.set` (substitui o atual):
   - continua chamando `rememberContact` e marcando `hasAddressBookSnapshot`;
   - se não há importação ativa (`aguardando`/`importando`), sai;
   - no primeiro bloco: comparar `jidNormalizedUser(socket.user.id)` com `historyOwnerPhoneJid`.
     Diferente e não nulo: status `numero_diferente`, sair. Nulo: gravar o número atual. Depois
     `status = 'importando'`, `startedAt = now`;
   - filtrar **imediatamente**: `msg.message` presente, `isSupportedChatJid`, não grupo,
     `timestampOf(msg) >= cutoff`, `syncType` em `INITIAL_BOOTSTRAP | RECENT | FULL`
     (`ON_DEMAND` só pela Fase 6); contar descartes nas estatísticas;
   - enfileirar `{ chats, messages filtradas }` na fila do importador e **retornar** (não segurar o emissor).
5. Fila do importador: concorrência 1 por sessão, teto de 20 blocos pendentes (acima disso, aguardar
   com backpressure por `await` no listener), lotes de 200 mensagens por transação, `await new Promise(setImmediate)`
   entre lotes. Usar um `createKeyedLimiter` próprio (não o `limiteDeGravacao` das mensagens ao vivo).
6. Conclusão: listener `messaging-history.status` (`complete` ou `paused` de `RECENT`, e de `FULL`
   quando pedido) **ou** 3 min sem blocos após o último → aguardar a fila esvaziar → `status = 'concluida'`
   (ou `parcial` se houve `falha` em algum lote), `endedAt`, estatísticas finais, evento de tempo real.
   Não usar `isLatest`.
7. Blocos que chegarem depois de `concluida` e dentro de 24 h do `startedAt` ainda são importados
   (atualizam estatísticas); depois disso, ignorados.
8. Boot do worker: conexões com `importando` e sem sessão viva viram `parcial`.
9. `logout`/`stop`/troca de geração: descartar a fila pendente (usar o `socketGeneration` como os
   outros listeners).
10. Progresso: gravar `historyImportStats` no máximo a cada 5 s e publicar no status da caixa
    (`WhatsAppStatusPayload.historyImport?: { status, progresso, mensagens, conversas }`).

### 3.3 Por mensagem (dentro do lote)

- Ordenar por chat e `timestamp` ascendente.
- `revokedMessageId(msg)`: chamar `markMessageRevoked` (idempotente) e seguir.
- Ignorar reações, enquetes e o que `decodeWaMessage` devolver `null`.
- Eco do CRM: não precisa de caminho especial; o dedupe por `externalId` cobre (há teste).
- Identidade: antes de resolver, alimentar o mapeamento com `chats[].pnJid/lidJid` do bloco
  quando o Baileys não tiver; `resolveChatIdentity(socket, msg.key, scope)`; contar `lidSemTelefone`.
- Resolução da conversa (`resolveHistoryConversation`):
  1. `resolveStoredIds` na caixa atual (mesmas regras de hoje);
  2. se não achou: procurar em **outras caixas da conta** uma conversa com o mesmo
     `channelThreadId`/telefone **e** com pelo menos uma `Message.externalId` presente entre os
     `key.id` desse chat no bloco. Achou com prova → usar essa conversa (é a conversa movida).
     Sem prova → criar na caixa atual (preserva `test-caixas-mesmo-numero.ts`);
  3. não achou → conversa nova.
- Menções: `tabelaDeMencoes` pode ser usada; falha não derruba o lote.
- Mídia: **não** chamar `materializeMedia`. Gerar conteúdo `pending_media` (Fase 5) e a linha `PendingMedia`.
- Mensagem:
  `id = msg-wa-${conversationId}-${key.id}`, `externalId = key.id`, `origin = 'historico'`,
  `createdAt = new Date(timestampOf(msg))`, `time = timeLabel(createdAt)`,
  `author = fromMe ? 'agent' : 'contact'`, `authorName` como no ao vivo,
  `deliveryStatus = fromMe ? deliveryStatusFrom(msg.status) ?? 'enviado' : null`, `isPrivate = false`.

### 3.4 `commitHistoryBatch` (`wa-history-store.ts`)

Para cada conversa do lote, numa transação:

- **Contato** (`ensureContactFromHistory`): cria se não existir (nome de `chats[].name/displayName`,
  `pushName` ou telefone). Se existir: **não** mexe em `deletedAt`, só preenche `name` quando vazio
  ou igual ao telefone, `lastContactAt` só avança se a mensagem for mais nova.
- **Conversa nova**: `createdAt` = mensagem mais antiga do lote; `importedAt = now`;
  status pela regra da seção 2; `unreadCount 0`; `priority 'baixa'`; `queue` como no ao vivo;
  `lastMessagePreview/lastMessageAt/lastActivityAt` da mais nova; `lastInboundAt` = mais nova do
  contato (ou null); `protocols []`; sem `slaDeadlineAt`; sem `firstResponseAt`.
  Colisão `P2002` → reler e seguir como existente (mesmo padrão de `createConversationWith`).
- **Mensagens**: `tx.message.createMany({ data, skipDuplicates: true })`; `duplicadas = enviadas - count`.
- **Conversa existente**: atualizar só
  ```ts
  tx.conversation.updateMany({
    where: { id, accountId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: maisNova } }] },
    data: { lastMessagePreview, lastMessageAt, lastActivityAt: maisNova },
  })
  ```
  Nada de `status`, `unreadCount`, `lastInboundAt`, SLA, CSAT, `inboxId`, `channelThreadId`.
- **PendingMedia**: `createMany({ skipDuplicates: true })`.
- **Proibido neste caminho**: `webhookEventOutbox`, `announce/publish` por mensagem, `abrirProtocolo`,
  `applyInboundComplianceIntent`, `runInboundAutoReplies`, `captureCsatAnswer`, `dispararAutomacoes`,
  `aplicarPausaDoAgente`, `hydrateAvatar` em massa. Deixar um comentário citando este plano.
- Todas as consultas com `accountId`.

### 3.5 Webhooks das caixas: nunca disparam

Mensagem importada **não** gera `mensagem.recebida`, `mensagem.enviada` nem `conversa.criada` para
nenhum webhook, inclusive os escopados por caixa (`Webhook` + `WebhookInbox`) e o fluxo do agente
de IA no n8n. Motivo: quem assina esses eventos age sobre eles (responde o cliente, grava memória,
cria card), e uma mensagem de dias atrás faria o fluxo agir sobre algo que já aconteceu.

Hoje só existem três portas de saída, e o importador não pode tocar em nenhuma:

| Porta | Onde | Regra no importador |
|---|---|---|
| Outbox gravada junto com a mensagem, entregue pelo runner | `wa-store.ts` `webhookSourceFor` → `tx.webhookEventOutbox.createMany` → `webhook-event-outbox-runner.ts` → `dispararWebhooks` | Não montar `webhookPayload`, não gravar `WebhookEventOutbox`, não publicar em `CHANNELS.WEBHOOKS` |
| Eco do que o CRM enviou | `session.ts` `dispararEcoDoCrm` → `dispararWebhooks` | Não chamar. O eco só existe no `messages.upsert` ao vivo |
| Chamada direta no motor in-process | `whatsapp-service.ts` → `dispararWebhooks` | Fora de escopo; o in-process continua descartando histórico |

`markMessageRevoked` (usado para revogações no histórico) não dispara webhook; conferir que continua assim.

A mesma regra vale para a mídia baixada sob demanda (Fase 5) e para as mensagens buscadas no
celular (Fase 6): trocar `pending_media` por mídia real ou inserir mensagens `ON_DEMAND` não é
evento de mensagem nova.

`commitHistoryBatch` não recebe nenhum parâmetro de webhook, para que o caminho não possa ser
ligado por engano. Um comentário no topo da função cita esta seção.

### 3.6 Tempo real

- Ao fim de cada lote, acumular ids tocados; ao concluir (e a cada 30 s durante), emitir eventos
  finos em lotes (mesmo padrão de `CONVERSATIONS_READ_BATCH`) com um tipo novo `conversations_imported`
  `{ inboxId, conversationIds }`. O cliente (`use-inbox.ts`) recarrega a lista; `live-notifications.tsx`
  **ignora** esse tipo (confirmar que não vira aviso nem som).

---

## 8. Fase 4: guardas nas funcionalidades existentes

- `inbox-auto-messages.ts` `runWaitingAutoReply`: selecionar `origin`; `if (ultima.origin === 'historico') return false;`
- `conversation-repository.ts` (primeira resposta): na busca da primeira mensagem do contato, usar
  `OR: [{ origin: null }, { origin: { not: 'historico' } }]`.
  **Atenção**: `origin: { not: 'historico' }` sozinho exclui `NULL` no SQL e quebraria todas as conversas atuais.
- `analytics-repository.ts` `carregar` e toda consulta de conversa por `createdAt` (conferir também
  `src/app/api/relatorios/export/route.ts`): `importedAt: null`.
- Conferir que `sla-runner.ts` não pega importadas (não têm `slaDeadlineAt`) e deixar teste.
- `previewOfMessage` e toda `switch` de `content.type` tratam `pending_media` (o TypeScript vai apontar).
- Busca (`/api/busca`): importadas **devem** aparecer; só conferir.
- Lista: selo discreto "Importada" quando `importedAt` e status `resolvida` (opcional, sem travessão).

---

## 9. Fase 5: mídia sob demanda

### 5.1 Domínio

`MessageContent` ganha:
```ts
| {
    readonly type: 'pending_media';
    readonly kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly caption?: string;
    readonly fileName?: string;
    readonly duration?: string;
    /** data:image/jpeg;base64 da miniatura do WhatsApp, só se <= 6 KB. */
    readonly thumb?: string;
    readonly unavailable?: boolean;
  }
```

### 5.2 Gravação na importação

- `PendingMedia.cipher/iv/tag/keyId` = `seal(proto.WebMessageInfo.encode(minimo).finish(), messageId)`,
  onde `minimo = { key, messageTimestamp, message: { <somente a submensagem de mídia> } }`.
- Não gravar miniatura no bucket.

### 5.3 Download

- Rota `POST /api/whatsapp/media/pending/[messageId]`: sessão por cookie, `conversas:ler`, mensagem
  da conta e de caixa acessível; enfileira comando `media_fetch { messageId }`; responde 202.
  Caixa desconectada → 409 "Conecte a caixa para baixar esta mídia".
- `command-consumer.ts` `media_fetch`: **não segurar a raia da caixa**. Validar e disparar a tarefa
  num limitador da sessão (2 por caixa), marcar o comando como concluído quando a tarefa terminar.
  Confirmar no código como a raia serializa comandos antes de implementar.
- Tarefa: `open()` → `proto.WebMessageInfo.decode` → reaproveitar `materializeMedia`
  (já usa `reuploadRequest: socket.updateMediaMessage` e dedupe por hash) → atualizar `Message.content`
  com `mediaContent(...)` **só se ainda for `pending_media`** (`updateMany` condicional) → apagar `PendingMedia`
  → emitir `message_updated`.
- Falha: `attempts += 1`, `lastError`; na 3ª, `status 'indisponivel'` e `content.unavailable = true`
  ("Mídia não disponível no celular").
- UI (`message-bubble.tsx`): miniatura borrada ou ícone + botão "Baixar"; estado carregando; ao
  receber `message_updated`, troca pela bolha normal.

---

## 10. Fase 6: buscar anteriores no celular (experimental)

Só com `WA_HISTORY_ON_DEMAND=1`.

- No topo da timeline, quando o banco não tem mais nada: "Buscar mensagens anteriores no celular".
- Comando `history_fetch { conversationId }`: pega a mensagem mais antiga com `externalId`, chama
  `fetchMessageHistory(50, key, timestampMs)`, guarda o `peerDataRequestSessionId` devolvido.
- `messaging-history.set` com `syncType ON_DEMAND` e sessão correspondente → mesmo `commitHistoryBatch`
  (sem filtro de corte).
- Timeout 30 s → evento com "O celular não respondeu. Mantenha o WhatsApp aberto no celular e tente de novo."
- Limites: 1 pedido por conversa a cada 30 s e 10 por caixa a cada 10 min.
- Validar manualmente antes de ligar (issue Baileys #2452).

---

## 11. Testes

Rodar **somente** contra banco descartável. Todo script novo deve abortar se `DATABASE_URL` não
apontar para `127.0.0.1`/`localhost`, e usar `DOTENV_CONFIG_PATH` para nunca carregar o `.env` real.
Seguir o padrão de `scripts/test-caixas-mesmo-numero.ts` (conta descartável, apagada no fim).

### `scripts/test-historico-importacao.ts`

Chamar `HistoryImporter`/`commitHistoryBatch` direto com `WAMessage` montadas à mão e dependências falsas:

1. Mensagens antes do corte são descartadas e contadas.
2. Conversa nova: `importedAt` preenchido, `createdAt` = mais antiga, `unreadCount 0`, sem protocolo,
   sem `slaDeadlineAt`; regra de 24 h para `aberta`.
3. Conversa existente resolvida com CSAT: continua resolvida, CSAT e `resolvedAt` intactos, `unreadCount` igual.
4. Prévia: importar mensagem mais velha que a última não muda `lastMessagePreview`/`lastActivityAt`;
   mais nova muda.
5. Mensagem já enviada pelo CRM (mesmo `externalId`) não duplica.
6. Rodar o mesmo bloco duas vezes: zero mudanças na segunda.
7. Com um webhook ativo escopado na caixa e inscrito em `mensagem.recebida`, `mensagem.enviada` e
   `conversa.criada`: importar mensagens do contato, mensagens `fromMe` e uma conversa nova, e
   conferir **zero** linhas novas em `WebhookEventOutbox` e em `WebhookDelivery` para a conta. Repetir
   depois de baixar uma mídia pendente (Fase 5). Nenhuma linha em `Notification`; nenhum opt-out
   gravado para texto "sair".
8. Conversa movida para outra caixa com prova por `externalId`: mensagens entram nela.
   Sem prova: cria na caixa atual. Reexecutar `test-caixas-mesmo-numero.ts`.
9. `historyOwnerPhoneJid` diferente → status `numero_diferente`, nada gravado.
10. `accountSyncCounter > 0` com `aguardando` → `nao_disponivel`.
11. Contato arquivado (`deletedAt`) continua arquivado; nome existente não é sobrescrito.
12. Grupo ignorado.
13. Mídia vira `pending_media` + `PendingMedia` cifrado; `open()` devolve o proto original.
14. `runWaitingAutoReply` retorna `false` quando a última é `historico`.
15. Primeira resposta ignora mensagens importadas e continua funcionando para conversas sem `origin`.
16. Dashboard (`carregar`) não conta conversas importadas.
17. Dois lotes concorrentes do mesmo chat novo (P2002) terminam com uma conversa só.

### Outros

- `scripts/test-media-pendente.ts`: rota com permissão/escopo, conteúdo condicional, limite de tentativas
  (download com dependência falsa).
- Regressão: `test-caixas-mesmo-numero.ts`, `test-marcar-lidas.ts`, `test-pausa-do-agente.ts`,
  `test-horario-do-agente.ts`, `test-media-dedup.ts`, `test-media-storage.ts`, `test-webhook-escopo.ts`.
- `npm run typecheck`, ESLint nos arquivos alterados, `npm run check:tenant`, `npm run check:travessao`.
- Manual (número de teste, nunca de cliente): parear com 7 dias; reconectar sem reparear; desconectar e
  parear o mesmo número; parear número diferente na mesma caixa; baixar mídia importada; deploy do worker
  no meio da importação.

---

## 12. Regras de execução

- **Prettier só nos arquivos alterados** (`npx prettier --write <arquivos>`). Nunca com glob de `src`.
- Não commitar arquivos `.md` (incluindo este plano).
- Não rodar nada contra o banco de produção nem o bucket real.
- Comentários no estilo do projeto: explicar o **porquê**.
- Não mudar comportamento do caminho ao vivo além das guardas da Fase 4.
- Ao fim de cada fase: `git status` e diff revisado, sem arquivos fora do escopo.

---

## 13. Deploy, ativação e reversão

1. Deploy com a flag **desligada**: `migrate deploy` → build web + worker → up.
2. Ligar `WA_HISTORY_IMPORT=1` no web e no worker; parear uma caixa de teste com 7 dias.
   Acompanhar logs do worker, `historyImportStats`, tamanho do banco.
3. Liberar para as caixas reais.

Reversão:
- Desligar a flag (o importador para de agir; dados ficam).
- `scripts/remover-historico-importado.ts` (criar nesta entrega): dry-run por padrão, `--account`,
  `--inbox`, `--apply`. Apaga `Message` com `origin = 'historico'` da caixa e `Conversation` com
  `importedAt` que ficaram sem mensagens. Não apaga contatos nem objetos do bucket. Idempotente.

---

## 14. Fora de escopo

- Patch no Baileys para `recentSyncDaysLimit`.
- Importar reações, enquetes, grupos, status e canais.
- Reenviar histórico sem reparear.
- Entregar histórico ao n8n/webhooks.
- Motor in-process.
- Apagar mídia do bucket.
