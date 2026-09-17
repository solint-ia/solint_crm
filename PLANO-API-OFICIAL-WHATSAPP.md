# Plano de implementação: API oficial do WhatsApp (Cloud API) ao lado do Baileys

> Documento de trabalho para agente de código. Leia inteiro antes de começar.
> Não faça commit deste arquivo. Pesquisa feita em 17/09/2026.

## 1. Decisão e escopo

**Uma caixa de entrada, um provedor.** Cada `Inbox` de WhatsApp passa a declarar como fala com
o WhatsApp:

- `baileys`: o que existe hoje. Conexão por QR Code, como aparelho conectado (WhatsApp Web).
- `cloud_api`: número oficial cadastrado na Meta, falando pela WhatsApp Cloud API
  (`graph.facebook.com`), sem worker, sem socket e sem QR.

Quem não tem número oficial continua no Baileys. Quem tem conecta pela API oficial. As duas
convivem na mesma conta, em caixas diferentes.

**O pareamento por código de telefone sai.** No modal de conexão ficam duas opções: "QR Code"
(Baileys) e "API oficial da Meta" (novo). A Fase 1 remove o código e a Fase 3 põe o formulário
oficial no lugar. **As duas saem no mesmo deploy**, ou a Fase 1 sai com o cartão da API oficial
escondido por flag: o modal não pode ficar um período com uma opção a menos e nada no lugar.

**Nunca Baileys e Cloud API no mesmo número ao mesmo tempo.** O onboarding na Cloud API em
modo coexistência desvincula todos os aparelhos conectados, e o Baileys é um aparelho
conectado. Trocar de provedor é um fluxo explícito (Fase 9), nunca um efeito colateral.

**Fora do escopo:** grupos pela Cloud API, chamadas (Calling API), WhatsApp Flows, pagamentos,
Marketing Messages API, Instagram e Messenger.

## 2. O que a pesquisa encontrou

Fatos que mudam decisões de código. Fontes no fim do documento (seção 13).

### 2.1 Conexão (onboarding)

| Tema | Fato | Consequência no plano |
|---|---|---|
| Versão da Graph API | A doc do Embedded Signup usa `v25.0` nos exemplos | Versão em `META_GRAPH_VERSION`, nunca fixa no código |
| Embedded Signup | v4 é a recomendada; v2 é descontinuada em outubro de 2026 (a Meta cita 15/10, um parceiro cita 08/10) | Implementar direto a v4 |
| Código do Embedded Signup | "The exchangeable token code has a time-to-live of 30 seconds" | Troca server-side imediata, sem fila |
| Quem pode usar | Tech Provider (cliente paga a Meta com o próprio cartão, tokens de negócio) ou Solution Partner (linha de crédito) | Solint como **Tech Provider** |
| Pré-requisitos | Verificação do negócio na Meta, App Review com acesso avançado a `whatsapp_business_management` e `whatsapp_business_messaging`, Facebook Login for Business | Fase 0, com prazo que não controlamos |
| Limite de onboarding | 10 clientes por 7 dias corridos; 200 por semana depois da verificação e do App Review | Modo manual (seção 6) primeiro |
| Pós-cadastro (Tech Provider) | 1) `GET /oauth/access_token` com `client_id`, `client_secret`, `code`; 2) `POST /<WABA_ID>/subscribed_apps`; 3) `POST /<PHONE_NUMBER_ID>/register` com `messaging_product` e `pin`; 4) cliente adiciona forma de pagamento no WhatsApp Manager | Sequência da Fase 7 |
| Tokens | Tech Provider usa só "business tokens" (Business Integration System User), escopados por cliente e sem renovação periódica documentada | Guardar cifrado, com coluna de tamanho livre |

### 2.2 Coexistência (WhatsApp Business app + API no mesmo número)

- App WhatsApp Business **2.24.17 ou superior**, número já ativo no app.
- Depois do onboarding, é preciso pedir em até **24 horas** a sincronização de contatos
  (`sync_type: smb_app_state_sync`) e de histórico (`sync_type: history`, até **180 dias**, em
  três fases). Cada uma só pode ser pedida **uma vez** por onboarding.
- Mensagens enviadas pelo app chegam pelo webhook **`smb_message_echoes`**.
- Vazão fixa de **20 mensagens por segundo**.
- Desligados nos chats 1:1: mensagens temporárias, visualização única, localização em tempo
  real. Listas de transmissão ficam só leitura. **Grupos não são suportados.**
- **Todos os aparelhos conectados são desvinculados** no onboarding. Windows e WearOS saem de
  vez; mensagens de aparelho não suportado não geram webhook.
- Verificação clássica do negócio não vale para coexistência; vale a verificação feita pelo
  parceiro ou o Meta Verified.

### 2.3 Webhooks

- Verificação: `GET` com `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Responder
  `200` com o `hub.challenge` no corpo.
- Autenticidade: header `X-Hub-Signature-256`, HMAC-SHA256 do **corpo cru** com o app secret.
- A Meta retenta com frequência decrescente **por até 7 dias**. Payload de **até 3 MB**.
- Exige certificado TLS válido; autoassinado não serve. mTLS é opcional. A Meta troca de IP,
  então não usar lista de IPs.
- Campos relevantes: `messages` (mensagens e status), `smb_message_echoes`, `history`,
  `smb_app_state_sync`, `message_template_status_update`, `account_update`,
  `phone_number_quality_update`, `user_preferences`.

### 2.4 Mensagens, mídia e limites

- **Janela de atendimento de 24 h:** abre quando o cliente escreve. Fora dela só template
  aprovado (erro `131047`). Conversa vinda de anúncio click-to-WhatsApp abre janela gratuita de
  72 h quando a empresa responde em até 24 h.
- **Leitura:** `{"messaging_product":"whatsapp","status":"read","message_id":"<WAMID>"}`.
  Marca também as anteriores. Vale até 30 dias depois do recebimento.
- **Digitando:** o mesmo corpo com `"typing_indicator": {"type": "text"}`. Some quando a
  empresa envia ou depois de ~25 s, e marca a mensagem como lida.
- **Mídia:** upload em `POST /<PHONE_NUMBER_ID>/media`; `GET /<MEDIA_ID>` devolve uma URL que
  **expira em 5 minutos** e exige `Authorization` no download. IDs de mídia de webhook valem
  **7 dias**; os de upload, 30 dias.
- **Limites de arquivo:** áudio 16 MB (AAC, AMR, MP3, M4A, OGG Opus); imagem 5 MB (JPEG, PNG);
  vídeo 16 MB (MP4, 3GPP, H.264 + AAC); documento 100 MB; figurinha WebP 100 KB estática,
  500 KB animada.
- **Vazão:** 80 mensagens por segundo por número, até 1.000 com upgrade automático. Há um
  limite por par empresa-usuário (erro `131056`) para rajadas ao mesmo contato.
- **Limite de mensagens:** por portfólio de negócio, 250 → 2.000 → 10.000 → 100.000 →
  ilimitado usuários únicos em 24 h. Só contam templates fora da janela. Consultar pelo campo
  `whatsapp_business_manager_messaging_limit`; `messaging_limit_tier` está obsoleto.

### 2.5 Identidade do contato (BSUID e nomes de usuário)

- Desde abril de 2026 os webhooks trazem `contacts[].user_id` e `messages[].from_user_id`: o
  **BSUID**, id do usuário escopado ao portfólio de negócio (até 128 caracteres).
- **`contacts[].wa_id` (o telefone) pode faltar.** Ele só vem se houve mensagem ou ligação
  nos últimos 30 dias em qualquer direção, ou se o contato está na agenda do número. Um cliente
  novo que chega por nome de usuário pode vir só com BSUID.
- Envio por BSUID no campo `recipient` desde julho de 2026. Se vierem `to` e `recipient`,
  `to` (telefone) vence.
- Templates de autenticação one-tap, zero-tap e copy code exigem telefone. Existe o botão
  `REQUEST_CONTACT_INFO` para pedir o número ao cliente.
- Nos status: `statuses[].recipient_user_id`. Em status `failed`, `contacts` não vem.

### 2.6 Preço (impacto direto no agente de IA)

- Cobrança por mensagem entregue desde 01/07/2025, por categoria e país.
- **A partir de 01/10/2026 as mensagens de serviço (respostas livres dentro da janela) passam
  a ser cobradas**, ao preço de utilidade do país, depois de **1.000 gratuitas por número por
  mês**. Templates de utilidade dentro da janela perdem a gratuidade. Anúncio de 01/07/2026,
  tabela de 01/09/2026, segundo 360dialog, YCloud, Wati e Zendesk. **A página de preços da Meta
  que consultei ainda mostra o modelo anterior: confirmar no WhatsApp Manager antes de
  comunicar valores a clientes.**
- Consequência: um agente do n8n que responde em cinco mensagens curtas custa cinco vezes o
  que custaria numa mensagem só. Ver Fase 5.6 e Fase 8.

## 3. Regras obrigatórias

1. **Nunca** leia, imprima, copie ou faça commit do `.env` real. Testes usam
   `DOTENV_CONFIG_PATH` apontando para um arquivo de teste.
2. **Nunca** rode migração, backfill ou teste contra o banco de produção nem contra a Graph API
   real com número de cliente. Use Postgres descartável e o servidor falso da Graph API
   (seção 10).
3. Não faça commit de arquivos `.md`. Não faça commit nem push sem pedido explícito.
4. Comentários em português explicando **por que**, na densidade dos arquivos vizinhos
   (`REGRAS-GLOBAIS.md`).
5. Módulos alcançados pelo worker não importam `server-only`. Módulos alcançados pelo site
   não importam o Baileys em tempo de execução (só `import type`).
6. `PrismaPromise` é preguiçosa: `void prisma.x.update()` sem `await`/`.then`/`.catch` não
   executa.
7. **Isolamento de conta:** toda consulta leva `accountId`. Um webhook com `phone_number_id`
   de outra conta nunca pode gravar nesta. Rodar `scripts/check-tenant-isolation.mjs`.
8. **Segredos:** token de acesso, app secret e PIN são cifrados com
   `src/infrastructure/whatsapp/auth/crypto.ts` (AES-256-GCM, `WA_ENCRYPTION_KEY`). Nunca vão
   para log, auditoria, resposta HTTP ou navegador. Erros da Graph API são redigidos antes de
   logar.
9. A URL pública de mídia (`/api/whatsapp/media/<id>`) e o **formato do corpo entregue ao
   n8n** não podem mudar para as caixas Baileys existentes.
10. Validação de cada fase: `npm run typecheck`, `npx eslint <arquivos alterados>`,
    `npx prettier --check <arquivos alterados>` e os testes da seção 10. Os testes que já
    existem (`test-webhook.ts`, `test-pausa-do-agente.ts`, `test-worker-e2e.ts`,
    `test-etiqueta-unica.ts`) continuam passando.

## 4. Como o código está hoje (o que o plano reaproveita)

| Peça | Onde | Situação |
|---|---|---|
| Provedor da caixa | `Inbox.provider` (`prisma/schema.prisma`), `Inbox` em `src/core/domain/channel.ts:66` | Já existe. Grava `'baileys'`; o tipo aceita `'cloud_api'` e ninguém lê para decidir nada |
| Fronteira de canal | `WhatsAppChannel` em `src/infrastructure/whatsapp/channel.ts` | Interface única para tela, API v1, automações e agendamentos |
| Escolha do motor | `getWhatsAppChannel()` em `channel-provider.ts` | Global por `WA_ENGINE` (`inprocess`/`worker`), não por caixa |
| Sessões | `worker/session-manager.ts`, `worker/session.ts`, `WhatsAppConnection` | Restaura toda conexão com `autoConnect: true`, sem olhar provedor |
| Funil de gravação | `commitMessage` em `wa-store.ts` | Conversa, SLA, protocolo, auto-respostas, automações (`mensagem_recebida`, `conversa_criada`, `mensagem_enviada`), pausa do agente, outbox de webhook |
| Recibos | `applyDeliveryUpdate` em `wa-store.ts:965`, índice em `Message.externalId` | Reaproveitável com o `wamid` |
| Corpo para o n8n | `wa-webhook-payload.ts` (`buildUpsertPayload`) | Formato `messages.upsert` montado da `WAMessage` do Baileys |
| Janela de 24 h | `isHsmWindowOpen` em `src/core/domain/conversation.ts:198` | Devolve sempre `true`: certo para Baileys, errado para Cloud API |
| Templates | `MessageTemplate` (`status`, `externalTemplateId`), `sendTemplateAction` | O template sai como texto comum pelo canal |
| Mídia | `mediaStore` (`wa-media-store.ts`, OCI com dedup SHA-256) | Reaproveitável para guardar o que vier da Meta |
| Criptografia | `auth/crypto.ts` | Chaveiro com rotação (`WA_ENCRYPTION_KEY_PREVIOUS`) |
| Runners com lease | `webhooks/webhook-event-outbox-runner.ts`, `webhook-delivery-runner.ts` | Modelo para o runner de eventos da Meta |
| Middleware | `src/middleware.ts` | Não intercepta `/api/*`: a rota do webhook fica pública sem mudança |
| CSP | `next.config.ts` | Bloqueia `connect.facebook.net` e iframes do Facebook: ajustar na Fase 7 |

**Pareamento por código hoje** (tudo sai na Fase 1):

- `src/features/whatsapp/components/whatsapp-modal.tsx`: método `phone`, campo de número,
  bloco "Código de pareamento", textos do botão e do carregamento.
- `src/features/whatsapp/hooks/use-whatsapp-connection.ts`: `method: 'phone'`,
  `phoneNumber`, `isAwaitingPairingCode`, `pairingCode` no estado otimista.
- `src/app/api/inboxes/[inboxId]/whatsapp/connect/route.ts` e
  `src/app/api/whatsapp/connect/route.ts`: leitura de `method`/`phoneNumber`.
- `src/infrastructure/whatsapp/channel.ts`: `WhatsAppPairingOptions.method` e `phoneNumber`.
- `src/infrastructure/whatsapp/queue-channel.ts:187,273,351`: payload do comando `connect`.
- `src/infrastructure/whatsapp/worker/command-consumer.ts:649-667`: `pairingMethod`.
- `src/infrastructure/whatsapp/worker/session-manager.ts:128,145,274`.
- `src/infrastructure/whatsapp/worker/session.ts`: `pairingCodeRequested`, `pairingPhone`,
  `requestPairingCode` (~861-889), `trocaDeMetodo` (~1028), comentário em ~1224.
- `src/infrastructure/whatsapp/whatsapp-service.ts`: o mesmo no motor in-process (~86, 303-351,
  514-537, 569).
- `src/infrastructure/whatsapp/whatsapp-events.ts`: status `aguardando_codigo` e campo
  `pairingCode`.
- `src/infrastructure/whatsapp/wa-format.ts:157`, rotas de `status` e `events` (que zeram
  `pairingCode`), `auth/postgres-auth-state.ts:396` (comentário).
- Coluna `WhatsAppConnection.pairingCode`.

## 5. Arquitetura alvo

```
 Tela, API v1, automações,           ┌──────────────── getWhatsAppChannel() ─────────────────┐
 agendamentos, campanhas  ─────────► │ ProviderRouterChannel: inboxId → Inbox.provider       │
                                     └──────────┬──────────────────────────────┬─────────────┘
                                                │ baileys                      │ cloud_api
                                   QueueWhatsAppChannel /            CloudApiWhatsAppChannel
                                   InProcessWhatsAppChannel                    │ HTTPS
                                   (como hoje)                                 ▼
                                                │                     graph.facebook.com
                                          worker Baileys

 Meta ─► POST /api/whatsapp/cloud/webhook[/<webhookKey>]
            │ valida assinatura, grava cru, responde 200
            ▼
   WhatsAppCloudEvent (tabela, dedupe)  ─►  CloudEventRunner (lease)  ─►  commitMessage
                                                                      ─►  applyDeliveryUpdate
                                                                      ─►  templates, qualidade, alertas
```

Decisões:

- **D1. Provedor por caixa, fixo enquanto conectada.** Trocar é desconectar e reconectar pelo
  fluxo da Fase 9.
- **D2. Roteador de canal.** `ProviderRouterChannel` implementa `WhatsAppChannel` e escolhe o
  motor pelo `provider` da caixa, com cache em memória de 15 s por `inboxId`. Métodos sem
  `inboxId` (o `getStatus(accountId)` da topbar) mantêm o comportamento atual e passam a
  considerar também as caixas oficiais.
- **D3. Envio oficial é HTTP síncrono**, sem worker: devolve o `wamid` na hora, que vira
  `externalId`. **Sem retentativa em timeout**: a Cloud API não tem chave de idempotência, e
  repetir um envio cuja resposta se perdeu duplica a mensagem no aparelho do cliente.
  Retentativa só onde a Meta garante que não enviou (`130429`, `131056`, `5xx` com erro
  explícito), com espera exponencial e sem jitter de "simular humano".
- **D4. Entrada durável.** A rota do webhook só valida, grava o evento cru e responde `200` em
  menos de 1 s. O processamento é de um runner com lease, no worker (`WA_ENGINE=worker`) ou no
  processo do site (`inprocess`), igual aos runners de webhook de saída. Uma falha de banco no
  meio do processamento não perde a mensagem, e a Meta não fica retentando por 7 dias.
- **D5. Identidade compatível com o Baileys.** Com telefone, o chat é
  `<wa_id>@s.whatsapp.net`, a conversa é `cv-wa-<conta>-<numero>` e o `channelThreadId` é o
  mesmo formato de hoje. Assim `resolveStoredIds` (inclusive a regra do nono dígito), a busca
  por telefone e o `remoteJid` entregue ao n8n funcionam sem mudança. Sem telefone (só BSUID),
  o `channelThreadId` é `bsuid:<BSUID>` e o contato nasce sem telefone (ver 7.3).
- **D6. O corpo para o n8n mantém o formato.** A caixa oficial entrega o mesmo `messages.upsert`
  de hoje, com a mensagem da Meta traduzida para a forma da `WAMessage` e dois acréscimos:
  `data.source: 'cloud_api'` e `data.cloud` com o objeto original da Meta. Os fluxos atuais do
  n8n continuam lendo `data.key.remoteJid`, `data.message.conversation` e `solint.*`.
- **D7. Capacidades por provedor**, num lugar só do domínio (seção 9). A tela esconde o que o
  provedor não faz, em vez de mostrar botão que falha.
- **D8. Janela de 24 h depende do provedor.** `isHsmWindowOpen` recebe o provedor. Baileys
  continua `true`; Cloud API compara `lastInboundAt` com 24 h.

## 6. Dois modos de conexão oficial

**Modo A: manual, com app da própria empresa.** Não depende de a Solint ser Tech Provider e
pode sair primeiro. A empresa cria o app no Meta for Developers, adiciona o produto WhatsApp,
cria um System User com token permanente (permissões `whatsapp_business_management` e
`whatsapp_business_messaging`) e informa ao CRM: `phone_number_id`, `waba_id`, token e app
secret. O CRM mostra a URL do webhook e o verify token para ela colar no painel do app e assinar
o campo `messages`. Cada app tem o próprio app secret, então cada conexão tem **URL própria**
(`/api/whatsapp/cloud/webhook/<webhookKey>`, com `webhookKey` aleatório de 32 caracteres, nunca
o `inboxId`) e a assinatura é validada com o secret daquela conexão.

**Modo B: Embedded Signup, com a Solint como Tech Provider.** Botão "Conectar com a Meta", popup
oficial, e o CRM faz o resto (Fase 7). Um app só (o da Solint), um webhook global
(`/api/whatsapp/cloud/webhook`) roteado por `entry[].changes[].value.metadata.phone_number_id`,
e opção de coexistência para quem quer continuar usando o app WhatsApp Business no celular.

**Recomendação:** Fases 1 a 6 com o Modo A; Fase 7 quando a Meta aprovar verificação, App Review
e Tech Provider. Tudo depois da conexão (receber, enviar, templates) é igual nos dois modos.

## 7. Modelo de dados

### 7.1 Conexão oficial

Tabela nova, e não colunas em `WhatsAppConnection`: aquela é o estado de uma sessão Baileys
(credenciais Signal, chaves, trava de worker) e nada dela se aplica aqui.

```prisma
model WhatsAppCloudConnection {
  inboxId             String    @id
  accountId           String
  /// manual | embedded_signup
  mode                String
  coexistence         Boolean   @default(false)
  businessId          String?
  wabaId              String
  phoneNumberId       String    @unique
  displayPhoneNumber  String
  verifiedName        String?
  qualityRating       String?
  messagingLimit      String?
  /// conectando | pendente_registro | conectado | erro | desconectado
  status              String    @default("conectando")
  lastError           String?
  tokenCipher         Bytes
  tokenIv             Bytes
  tokenTag            Bytes
  tokenKeyId          String?
  /// Só no modo manual: o app é da empresa, e o secret dela valida o webhook.
  appId               String?
  appSecretCipher     Bytes?
  appSecretIv         Bytes?
  appSecretTag        Bytes?
  pinCipher           Bytes?
  pinIv               Bytes?
  pinTag              Bytes?
  webhookKey          String    @unique
  verifyTokenHash     String
  subscribedAt        DateTime?
  registeredAt        DateTime?
  contactsSyncAt      DateTime?
  historySyncAt       DateTime?
  lastWebhookAt       DateTime?
  connectedByUserId   String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  inbox   Inbox   @relation(fields: [inboxId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

### 7.2 Eventos recebidos da Meta

```prisma
model WhatsAppCloudEvent {
  id            String    @id @default(cuid())
  accountId     String?
  inboxId       String?
  phoneNumberId String
  /// message | status | echo | history | app_state_sync | template_status | account_update | quality | user_preferences | desconhecido
  kind          String
  /// kind:wamid[:status]. A Meta retenta por 7 dias e reenvia o mesmo evento.
  dedupeKey     String    @unique
  payload       Json
  /// pending | processing | done | failed | ignored
  status        String    @default("pending")
  attempts      Int       @default(0)
  availableAt   DateTime  @default(now())
  leaseUntil    DateTime?
  error         String?
  receivedAt    DateTime  @default(now())
  processedAt   DateTime?

  @@index([status, availableAt])
  @@index([inboxId, receivedAt])
}
```

Eventos `done` com mais de 30 dias são apagados por um runner de retenção, no padrão de
`webhook-retention-runner.ts`.

### 7.3 Contato sem telefone (BSUID)

- `Contact.whatsappUserId String?` com `@@index([accountId, whatsappUserId])`, preenchido
  sempre que o webhook trouxer `user_id`.
- O BSUID é escopado ao **portfólio de negócio**. Se uma conta tiver caixas oficiais em
  portfólios diferentes, o mesmo cliente terá BSUIDs diferentes. Antes de implementar, conferir
  se isso acontece nas contas reais; se acontecer, trocar a coluna por uma tabela
  `WhatsAppUserIdentity(accountId, businessId, userId, contactId)`.
- Contato que chega só com BSUID nasce com `phone` vazio. Revisar os pontos que assumem
  telefone: busca, `startContactConversationAction`, campanhas (pulam quem não tem telefone),
  exportação CSV, `PhoneNumber.isValid` em formulários.
- Quando um webhook posterior trouxer `wa_id` para um contato só com BSUID, preencher o telefone
  e rodar a mesma deduplicação que `resolveStoredIds` já faz.

### 7.4 Outras colunas

- `MessageTemplate.wabaId String?` e unicidade `[accountId, wabaId, name, language]`: o mesmo
  nome de template pode existir em duas WABAs da mesma conta.
- `Message.channelMeta Json?` (opcional, Fase 8): `pricing.category` e `pricing.billable` dos
  status, para estimar custo.
- `WhatsAppConnection.pairingCode`: **não** apagar no mesmo deploy da Fase 1 (um worker antigo
  ainda no ar pode gravar nela). Remover numa migração seguinte.

## 8. Fases

### Fase 0: pré-requisitos na Meta (não é código)

Modo A (por cliente):
- App do tipo Business no Meta for Developers, com o produto WhatsApp.
- Número que **não** esteja ativo no WhatsApp comum nem no WhatsApp Business app (no Modo A não
  há coexistência: o número sai do app para ser registrado).
- Nome de exibição aprovado, forma de pagamento no WhatsApp Manager, PIN de duas etapas.
- System User com token permanente e as duas permissões.

Plataforma (Solint):
- Domínio com TLS válido (o Caddy da VM já emite Let's Encrypt).
- URLs públicas de política de privacidade e exclusão de dados.
- Para o Modo B: verificação do negócio da Solint, App Review com acesso avançado a
  `whatsapp_business_management` e `whatsapp_business_messaging`, cadastro como Tech Provider,
  configuração do Facebook Login for Business com a variação "WhatsApp Embedded Signup", que
  gera o `config_id`.

Variáveis novas (documentar em `.env.example`, sem valores): `META_GRAPH_VERSION`,
`META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`,
`WA_CLOUD_API` (flag de liberação).

### Fase 1: remover o pareamento por código

1. Tirar `method` e `phoneNumber` de `WhatsAppPairingOptions`. As rotas de `connect` passam a
   responder `400` com "O pareamento por código foi removido. Use o QR Code ou a API oficial."
   se receberem `method: 'phone'` (aba aberta de antes do deploy).
2. Worker e in-process: remover `pairingPhone`, `pairingCodeRequested`, a chamada a
   `requestPairingCode` e `trocaDeMetodo`. O comando `connect` ignora `pairingMethod`.
3. `whatsapp-events.ts`: remover `aguardando_codigo` e `pairingCode`. Ajustar `wa-format.ts` e
   as rotas de `status`/`events`.
4. `use-whatsapp-connection.ts`: remover `isAwaitingPairingCode` e o parâmetro `phoneNumber`.
5. Modal: a escolha passa a ser "QR Code" e "API oficial da Meta". A segunda abre o formulário
   da Fase 3. Com `WA_CLOUD_API` desligada, o cartão não aparece e o modal vai direto para o QR.
6. Buscar resíduo: `rg "pairingCode|aguardando_codigo|requestPairingCode|method === 'phone'" src`
   não pode devolver nada fora da coluna do schema.

### Fase 2: fundação (domínio, dados, roteador, cliente Graph)

1. Migração das seções 7.1 a 7.4 (`npm run db:migrate -- api-oficial-whatsapp`, em banco
   descartável).
2. Domínio `src/core/domain/whatsapp-provider.ts`: tipo `WhatsAppProvider = 'baileys' |
   'cloud_api'`, `WHATSAPP_CAPABILITIES` (seção 9) e `isHsmWindowOpen(conversation, provider)`.
   Atualizar `canSendFreeText` e quem chama.
3. `src/infrastructure/whatsapp/cloud/graph-client.ts`: `fetch` com
   `AbortSignal.timeout(10_000)`, versão de `META_GRAPH_VERSION`, token recebido por parâmetro
   (nunca global), resposta de erro traduzida para `CloudApiError { code, subcode, title,
   mensagemPt, retentavel }`. Tabela inicial de mensagens em português:

   | Código | Significado | Retentável |
   |---|---|---|
   | 131047 | Janela de 24 h encerrada: envie um template | não |
   | 131026 | Mensagem não entregue (número sem WhatsApp, versão antiga, bloqueio) | não |
   | 131049 | A Meta segurou a mensagem de marketing para proteger o usuário | não |
   | 131056 | Muitas mensagens seguidas para o mesmo contato | sim, com espera |
   | 130429 | Limite de vazão do número atingido | sim, com espera |
   | 131051 | Tipo de mensagem não suportado | não |
   | 131042 | Problema de pagamento na conta da Meta | não, alerta admin |
   | 131031 | Conta bloqueada pela Meta | não, alerta admin |
   | 133010 | Número não registrado na Cloud API | não, caixa em `pendente_registro` |
   | 190 | Token inválido ou expirado | não, caixa em `erro` e alerta |
   | 368 | Bloqueio temporário por violação de política | não, alerta admin |
   | 132000 / 132001 | Parâmetros do template errados / template inexistente | não |
   | 100 | Parâmetro inválido | não |

4. `ProviderRouterChannel` (D2). `getWhatsAppChannel()` passa a devolvê-lo, embrulhando o motor
   Baileys atual e o `CloudApiWhatsAppChannel`.
5. Worker: `session-manager.ts` só restaura conexões de caixas com `provider = 'baileys'`, e o
   `command-consumer` recusa comando de caixa oficial com erro explícito (defesa em
   profundidade contra um comando antigo na fila).
6. `getStatus` de caixa oficial lê `WhatsAppCloudConnection` e devolve o mesmo
   `WhatsAppStatusPayload`, com `provider: 'cloud_api'`, número, nome verificado e qualidade.
   `InboxConnectionStatus` e a tela de caixas passam a mostrar o provedor.

### Fase 3: conectar pelo Modo A

1. `POST /api/inboxes/[inboxId]/whatsapp/cloud/connect` com `{ phoneNumberId, wabaId,
   accessToken, appSecret, pin? }`. Permissão `config.caixas:escrever` e
   `canSeeInbox`, como o `connect` atual.
2. Sequência, parando no primeiro erro com mensagem clara:
   1. `GET /<PHONE_NUMBER_ID>?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput`
      com o token: prova que o token enxerga o número.
   2. Conferir que o número pertence à WABA informada (`GET /<WABA_ID>/phone_numbers`).
   3. Se `platform_type` indicar que o número não está na Cloud API, `POST /register` com o PIN
      (pedido no formulário, guardado cifrado).
   4. Gravar a conexão cifrada, `webhookKey` aleatório, verify token aleatório (guardar só o
      hash), `Inbox.provider = 'cloud_api'`, `Inbox.identifier = display_phone_number`.
   5. Se a caixa tinha sessão Baileys: comando `disconnect` com `autoConnect = false`. A tela
      pede confirmação antes ("o QR Code desta caixa será desconectado").
   6. Auditoria `configuracao.alterada` com `detalhe: 'api_oficial_conectada'`, número e modo.
      **Sem token, secret ou PIN no metadata.**
3. Formulário `CloudApiConnectForm` dentro do modal: passo a passo curto, campos, e depois de
   salvar a URL do webhook e o verify token com botão de copiar, avisando que o verify token
   só aparece agora (há "gerar novo").
4. A conexão fica `conectando` até o primeiro `GET` de verificação da Meta chegar. Aí vira
   `conectado`. A tela mostra "Aguardando a Meta confirmar o webhook".
5. `POST .../cloud/disconnect`: apaga token, secret e PIN, marca `desconectado`. Não tenta
   desregistrar o número (irreversível do ponto de vista do cliente).
6. `POST .../cloud/test`: repete o passo 2.1 e devolve qualidade e limite atuais.

### Fase 4: receber

1. **Rotas:** `src/app/api/whatsapp/cloud/webhook/[webhookKey]/route.ts` (Modo A) e, na Fase 7,
   `src/app/api/whatsapp/cloud/webhook/route.ts` (Modo B). `export const dynamic =
   'force-dynamic'`.
   - `GET`: `hub.mode === 'subscribe'` e hash do `hub.verify_token` igual ao guardado
     (`timingSafeEqual`), responde o `hub.challenge` como texto puro.
   - `POST`: `await request.text()` **antes** de qualquer parse. Rejeitar corpo acima de 3 MB.
     Validar `X-Hub-Signature-256` com `timingSafeEqual` e o app secret da conexão (A) ou
     `META_APP_SECRET` (B). Assinatura inválida: `401`, nada gravado.
   - Para cada `entry[].changes[]`: descobrir a caixa pelo `metadata.phone_number_id` (e, no
     Modo A, conferir que é o da conexão do `webhookKey`), classificar o `kind`, montar a
     `dedupeKey` e gravar com `createMany({ skipDuplicates: true })`. Publicar `NOTIFY` num canal
     novo `CHANNELS.WHATSAPP_CLOUD`. Atualizar `lastWebhookAt`.
   - `phone_number_id` desconhecido: gravar com `status: 'ignored'`, log curto, responder `200`
     (se não, a Meta retenta por 7 dias).
2. **Runner** `src/infrastructure/whatsapp/cloud/cloud-event-runner.ts`: lease, lote, espera
   exponencial, teto de tentativas, ordem por `receivedAt` **dentro de cada conversa** (duas
   mensagens do mesmo contato não podem ser gravadas fora de ordem). Ligado em `worker.mts` e no
   ramo `inprocess` de `channel-provider.ts`, como os runners de webhook.
3. **Tradução** `cloud/cloud-inbound.ts` (função pura, testável sem banco): mensagem da Meta →
   `ChatIdentity`, `Contact` e `Message` do domínio, mais `preview`.

   | Tipo da Meta | Conteúdo no CRM |
   |---|---|
   | `text` | `text` |
   | `image`, `video`, `audio` (`voice: true` = nota de voz), `document`, `sticker` | mídia: baixar já (7.2 do fluxo abaixo) e gravar no `mediaStore` |
   | `location` | localização |
   | `contacts` | cartão de contato |
   | `interactive` (`button_reply`, `list_reply`) e `button` (resposta rápida de template) | texto com o título escolhido, id no metadata |
   | `reaction` | `applyReaction`, que já existe |
   | `order`, `system`, `unsupported`, `errors` | aviso "Mensagem não suportada pela API oficial", com o tipo |
   | `context.id` | citação: procurar a mensagem por `externalId` |
   | `referral` (anúncio click-to-WhatsApp) | metadata da mensagem e corpo do n8n |

   Mídia: `GET /<MEDIA_ID>` → URL (5 min) → download com `Authorization` → checar tamanho e
   tipo → `mediaStore.save`. Baixar **no processamento**, não sob demanda como o histórico do
   Baileys: o id da Meta morre em 7 dias. Falha no download não impede gravar a mensagem; ela
   fica com a mídia em estado de erro e o runner tenta de novo.

4. **Gravação:** `resolveStoredIds` → `commitMessage`. Com isso, sem código novo: conversa,
   reabertura, SLA, protocolo, CSAT, saudação, automações `conversa_criada`/`mensagem_recebida`,
   opt-out e webhook para o n8n.
5. **Status** (`statuses[]`): `sent`/`delivered`/`read` → `applyDeliveryUpdate` com ordem
   monotônica (um `delivered` atrasado não rebaixa um `read`). `failed` → `deliveryStatus:
   'falha'` e `dispatchError` com a mensagem em português da tabela da Fase 2. Emitir o evento de
   tempo real igual ao recibo do Baileys. Atualizar `CampaignRecipient` pelo `externalId`.
6. **Eco da coexistência** (`smb_message_echoes`): `commitMessage` com `fromMe: true`. Entra na
   regra de pausa do agente (que só pausa quando há webhook ativo de agente na caixa) e dispara
   `mensagem_enviada`, exatamente como uma resposta pelo celular no Baileys.
7. **Corpo para o n8n** `cloud/cloud-webhook-payload.ts` (D6). `key.remoteJid` =
   `<wa_id>@s.whatsapp.net` (ou `bsuid:<id>`), `key.id` = `wamid`, `key.fromMe`, `pushName` =
   `contacts[].profile.name`, `message` no formato da `WAMessage` (`conversation`,
   `extendedTextMessage` com `contextInfo.stanzaId` na citação, `imageMessage`, `audioMessage` com
   `ptt`, `documentMessage` com `fileName`, `videoMessage`, `stickerMessage`, `locationMessage`,
   `contactsMessage`, `reactionMessage`), `messageTimestamp`, `data.source: 'cloud_api'`,
   `data.cloud` com o original, `mediaUrl` absoluta e base64 respeitando `MAX_BASE64_BYTES`.
   **Só `import type` do Baileys neste arquivo.**
8. `POST /api/v1/mensagens` com `jid` + `instanceId`: conferir que resolve conversa de caixa
   oficial (inclusive `bsuid:`).

### Fase 5: enviar

`src/infrastructure/whatsapp/cloud/cloud-channel.ts`, implementando `WhatsAppChannel`:

1. **`sendText`**: `POST /<PHONE_NUMBER_ID>/messages` com `messaging_product`,
   `recipient_type: 'individual'`, `to` (telefone) ou `recipient` (BSUID, quando não há telefone),
   `type: 'text'`, `text: { body, preview_url: false }` e `context: { message_id }` na citação.
   Devolve `{ ok: true, externalId: wamid }`.
2. **`sendMedia`**: ler os bytes do `mediaStore`, validar contra os limites da seção 2.4 antes
   de subir (imagem acima de 5 MB vai como documento, com aviso), `POST /media` multipart,
   enviar com `{ id, caption, filename }`. Áudio gravado já sai em OGG/Opus pela conversão que
   existe (commit `d47677b`). **Conferir num aparelho real se aparece como nota de voz.**
3. **`sendReaction`**: `type: 'reaction'`, `reaction: { message_id, emoji }`. Emoji vazio remove.
4. **`markRead` / `markReadMany`**: `status: 'read'` com o `wamid` da última mensagem recebida da
   conversa (marca as anteriores). Pular se passou de 30 dias.
5. **`sendPresence`**: `composing` → `typing_indicator: { type: 'text' }` com o último `wamid`
   recebido. `recording` e `paused` não têm equivalente: sucesso sem chamada. A rota de presença
   do n8n passa a limitar a duração a 25 s nas caixas oficiais.
6. **Rajadas do agente de IA.** Serializar os envios **por conversa** (fila curta em memória com
   trava no banco para quando houver mais de uma instância do site). Em `131056`/`130429`,
   esperar e tentar de novo (a partir de 2 s, exponencial, teto de 3 tentativas). Documentar em
   `INTEGRACAO-N8N-AGENTE-IA.md` que, a partir de 01/10/2026, cada mensagem de serviço conta
   para a cobrança da Meta, e que o agente deve juntar a resposta numa mensagem.
7. **`deleteMessage`**: a Cloud API não oferece apagar para todos. Devolver erro "Não disponível
   na API oficial" e esconder o botão pela capacidade (seção 9). Conferir a referência de
   mensagens antes de esconder, caso a Meta tenha lançado o recurso.
8. **`startSession` / `disconnect`** do motor oficial delegam às rotas da Fase 3.
9. **Janela de 24 h na tela:** o compositor da conversa em caixa oficial com janela fechada mostra
   "A janela de 24 h terminou. Envie um template aprovado para retomar." e abre o seletor de
   templates. A API v1 já devolve `HSM_WINDOW_CLOSED`; conferir o status HTTP (`409`).
10. **Agendamentos, automações e auto-respostas** passam pelo roteador sem mudança. Agendamento
    que cair fora da janela falha com a mensagem do `131047`, e a tela de agendadas explica.

### Fase 6: templates

1. **Sincronizar:** `GET /<WABA_ID>/message_templates?fields=id,name,status,category,language,components&limit=100`,
   com paginação, para `MessageTemplate` (`wabaId`, `externalTemplateId`, cabeçalho, rodapé,
   botões, variáveis). Botão "Sincronizar com a Meta" na tela de templates e sincronização
   automática ao conectar.
2. **Criar:** `POST /<WABA_ID>/message_templates` a partir do editor atual. Status inicial
   `pending`.
3. **Status:** webhook `message_template_status_update` atualiza `status` e guarda o motivo da
   rejeição.
4. **Enviar:** em caixa oficial, `sendTemplateAction` e campanhas mandam `type: 'template'` com
   `name`, `language.code` e `components` montados das variáveis. Em caixa Baileys, continua como
   texto. A timeline guarda o texto renderizado, como hoje.
5. **Campanhas em caixa oficial:** só templates aprovados, respeitando o limite de mensagens do
   portfólio (lido na Fase 8), com os status vindo do webhook.

### Fase 7: Embedded Signup (Modo B)

1. **CSP** (`next.config.ts`): liberar `script-src https://connect.facebook.net`,
   `frame-src https://www.facebook.com https://web.facebook.com` e
   `connect-src https://graph.facebook.com` **só** na rota de configuração de caixas, se der; se
   não, no site todo, documentando o motivo.
2. **Cliente:** componente que carrega o SDK (`https://connect.facebook.net/en_US/sdk.js`),
   `FB.init({ appId, autoLogAppEvents: true, xfbml: true, version })` e chama
   `FB.login(callback, { config_id, response_type: 'code', override_default_response_type: true,
   extras: { setup: {}, ... } })`. Para coexistência, o `featureType` de onboarding de usuários do
   app (conferir o valor exato na doc "Onboard WhatsApp Business app users" na hora de
   implementar).
3. Ouvir `message` com `event.origin` terminando em `facebook.com` e `type ===
   'WA_EMBEDDED_SIGNUP'`. Eventos: `FINISH`, `FINISH_ONLY_WABA`,
   `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (coexistência), `CANCEL`, `ERROR`. Guardar
   `phone_number_id`, `waba_id`, `business_id`.
4. Mandar `{ code, phone_number_id, waba_id, business_id, event }` para
   `POST /api/inboxes/[inboxId]/whatsapp/cloud/embedded-signup` **imediatamente** (TTL de 30 s do
   código).
5. **Servidor:** `GET /oauth/access_token` (`client_id`, `client_secret`, `code`) →
   `POST /<WABA_ID>/subscribed_apps` → se não for coexistência, `POST /register` com PIN aleatório
   de 6 dígitos guardado cifrado → gravar conexão com `mode: 'embedded_signup'` → sincronizar
   templates.
6. **Coexistência:** dentro de 24 h (na prática, logo após o passo 5),
   `POST /<PHONE_NUMBER_ID>/smb_app_data` com `sync_type: 'smb_app_state_sync'` e depois
   `sync_type: 'history'`. Gravar `contactsSyncAt`/`historySyncAt` antes da chamada, para nunca
   pedir duas vezes. O webhook `history` alimenta um importador que reaproveita
   `wa-history-store.ts` em modo silencioso, com a mesma tela de progresso da importação do
   Baileys. `smb_app_state_sync` alimenta os nomes da agenda (`WhatsAppAddressBookName`).
7. Mostrar ao cliente, antes do popup, os efeitos da coexistência (seção 2.2), principalmente a
   desvinculação dos aparelhos e o fim dos grupos.
8. Contador de onboardings dos últimos 7 dias na plataforma, com aviso ao chegar perto do limite
   de 10 (ou 200).

### Fase 8: operação e custo

1. Painel da caixa oficial: qualidade (`quality_rating`), limite
   (`whatsapp_business_manager_messaging_limit`), status do nome, vazão, último webhook recebido,
   templates pendentes e rejeitados.
2. Webhooks `phone_number_quality_update` e `account_update` (restrição, banimento, violação)
   viram notificação para os administradores da conta e mudam o status da caixa quando for o caso.
3. Erro `190` em qualquer chamada: caixa em `erro`, banner "Reconecte a API oficial", notificação.
4. Guardar `pricing.category` e `pricing.billable` dos status (`Message.channelMeta`) e mostrar
   em Relatórios uma estimativa de mensagens cobráveis por categoria no período. Não mostrar
   valor em reais sem a tabela da Meta.
5. Retenção de `WhatsAppCloudEvent` (seção 7.2).
6. Alerta se uma caixa oficial `conectado` ficar mais de 24 h sem webhook nenhum enquanto envia
   mensagens (sinal de assinatura perdida).

### Fase 9: migrar uma caixa do Baileys para a API oficial

1. Botão "Migrar para a API oficial" na caixa Baileys conectada, só para administrador.
2. Tela de confirmação explicando: o QR Code desconecta; grupos param de receber e ficam só
   leitura no CRM; no Modo A o número precisa sair do app WhatsApp Business; na coexistência
   (Modo B) o app continua, mas os aparelhos conectados são desvinculados.
3. Desconectar o Baileys (`autoConnect = false`, logout), conectar pela Fase 3 ou 7 **na mesma
   caixa**. Conversas, contatos, etiquetas e cards continuam: os ids (`cv-wa-<conta>-<numero>`) e o
   `channelThreadId` são os mesmos (D5).
4. Conversas de grupo da caixa ganham o aviso "Grupos não são suportados pela API oficial" e o
   compositor fica desativado nelas.
5. Voltar para o Baileys é o caminho inverso, também explícito.

## 9. Capacidades por provedor

`WHATSAPP_CAPABILITIES` no domínio, lido pela tela e pelos casos de uso.

| Recurso | Baileys | Cloud API | O que fazer |
|---|---|---|---|
| Texto livre | sempre | só na janela de 24 h | bloquear e oferecer template |
| Template aprovado | não se aplica | sim | seletor no compositor |
| Grupos | sim | não (neste plano) | esconder; grupos antigos só leitura |
| Apagar para todos | sim | não | esconder o botão |
| Reações | sim | sim | nada |
| Citação | sim | sim (`context.message_id`) | nada |
| Digitando | `composing` e `recording` | só "digitando", até ~25 s, ligado a mensagem recebida | mapear, limitar duração |
| Confirmação de leitura | sim | sim, até 30 dias | nada |
| Histórico ao conectar | até 90 dias, o celular decide | só coexistência: até 180 dias, pedido uma vez em 24 h | tela de importação diferente |
| Agenda do celular | sim | só coexistência (`smb_app_state_sync`) | nada |
| Foto de perfil do contato | sim | não | avatar com iniciais |
| Contato sem telefone | não acontece | acontece (BSUID) | seção 7.3 |
| Pausa do agente por resposta fora do CRM | `fromMe` desconhecido | eco `smb_message_echoes` | mesma regra, já pronta |
| Corpo para o n8n | `messages.upsert` | o mesmo formato, mais `data.cloud` | D6 |
| Visualização única e temporárias | recebe | não suportado | aviso de mensagem não suportada |
| Custo por mensagem | nenhum na Meta | por mensagem; serviço cobrado a partir de 01/10/2026 | Fase 8.4 |
| Risco de banimento por uso não oficial | existe | não se aplica | nada |

## 10. Testes

Funções puras, sem banco (`npx tsx scripts/<nome>.ts`):

- `test-cloud-assinatura.ts`: assinatura válida, corpo alterado em um byte, header ausente,
  prefixo `sha256=` errado, verificação `GET` com token certo e errado.
- `test-cloud-traducao.ts`: fixtures reais (anonimizadas) de cada tipo da tabela da Fase 4.3 →
  `CommitInput` e corpo do n8n; número brasileiro com e sem o nono dígito; mensagem só com BSUID;
  citação; reação; `referral` de anúncio.
- `test-cloud-status.ts`: ordem monotônica (`read` antes de `delivered`), `failed` com código
  traduzido.
- `test-janela-24h.ts`: Baileys sempre aberto; Cloud API aberta com 23 h 59 min, fechada com
  24 h 01 min, fechada sem `lastInboundAt`.
- `test-capacidades.ts`: nenhum recurso marcado como indisponível aparece como ação na tela
  (teste do mapa, não de componente).

Com Postgres descartável e servidor falso da Graph API (`scripts/fake-graph-server.ts`, no
molde de `fake-par-server.ts`):

- `test-cloud-conexao.ts`: Modo A feliz; token sem acesso ao número; número de outra WABA;
  número não registrado com e sem PIN; nada de token em log ou auditoria.
- `test-cloud-webhook-e2e.ts`: `POST` assinado → evento → runner → `Message` gravada, automação
  `mensagem_recebida` disparada, corpo do n8n na outbox com `data.source = 'cloud_api'`; o mesmo
  evento duas vezes grava uma mensagem só; `phone_number_id` de outra conta não grava nada.
- `test-cloud-envio.ts`: texto, mídia com upload, citação, reação, leitura; `131047` vira erro de
  janela; `131056` tenta de novo e depois falha; timeout **não** tenta de novo; `190` põe a caixa
  em `erro`.
- `test-cloud-eco-pausa.ts`: eco de coexistência pausa o agente só com webhook de agente ativo
  (mesma regra que `wa-store.ts` já aplica ao Baileys) e dispara `mensagem_enviada`.

Na Meta, antes de liberar: número de teste do próprio app (até 5 destinatários verificados) e o
botão "Test" dos campos de webhook no painel do app.

## 11. Ordem de entrega e estimativa

| Fase | Depende de | Esforço | Liberação |
|---|---|---|---|
| 0. Pré-requisitos Meta | nada | fora do código; o Modo B leva semanas | em paralelo a tudo |
| 1. Remover pareamento por código | nada | 1 dia | junto com a 3, ou com flag |
| 2. Fundação | 1 | 2 a 3 dias | invisível |
| 3. Conectar (Modo A) | 2 | 2 dias | `WA_CLOUD_API=1` para uma conta piloto |
| 4. Receber | 3 | 4 a 5 dias | piloto |
| 5. Enviar | 4 | 3 a 4 dias | piloto |
| 6. Templates | 5 | 3 dias | piloto, depois todos |
| 7. Embedded Signup | 5, Fase 0 do Modo B | 3 a 4 dias | quando a Meta aprovar |
| 8. Operação e custo | 5 | 2 dias | todos |
| 9. Migração Baileys → oficial | 3 a 6 | 1 a 2 dias | todos |

Uma conta piloto com número de teste do app da Meta desde a Fase 3. Só abrir para todas as contas
depois das Fases 4, 5 e 6 rodando uma semana no piloto sem mensagem perdida.

## 12. Riscos e perguntas em aberto

1. **Custo a partir de 01/10/2026.** Clientes que migrarem para a API oficial passam a pagar por
   resposta depois de 1.000 mensagens por número por mês. Isso precisa ser comunicado antes da
   migração, não depois da primeira fatura.
2. **Aprovações da Meta** (verificação, App Review, Tech Provider) têm prazo que não controlamos.
   Por isso o Modo A vem primeiro.
3. **Contato sem telefone (BSUID)** afeta busca, campanhas, exportação e o "iniciar conversa".
   Levantar todos os usos de `contact.phone` na Fase 2.
4. **Número ativo no app:** no Modo A o registro exige tirar o número do app. Sem coexistência
   (Modo B), o cliente perde o uso do celular com aquele número.
5. **BSUID entre portfólios** (seção 7.3): confirmar se alguma conta real tem caixas em portfólios
   diferentes.
6. **Versão da Graph API:** cada versão vive cerca de dois anos. Um alerta no painel da plataforma
   quando `META_GRAPH_VERSION` estiver a 90 dias do fim evita descobrir pela falha.
7. **Várias instâncias do site** processando o mesmo webhook: resolvido pela `dedupeKey` única e
   pelo lease do runner, mas precisa de teste com duas instâncias.
8. **Nota de voz:** conferir em aparelho real se o OGG/Opus convertido aparece como nota de voz ou
   como arquivo de áudio.
9. **Apagar para todos:** confirmar na referência atual que a Cloud API continua sem esse recurso
   antes de esconder o botão.
10. **Datas conflitantes** do fim do Embedded Signup v2 (15/10 na Meta, 08/10 num parceiro): não
    afeta o plano, que começa na v4.

## 13. Fontes

Meta for Developers:
- [Embedded Signup: visão geral](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Embedded Signup: implementação](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboarding como Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [Onboarding de usuários do WhatsApp Business app (coexistência)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Tokens de acesso](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)
- [Webhooks: visão geral](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
- [Webhooks: criar o endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)
- [Mídia](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)
- [Marcar como lida](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read)
- [Limites de mensagens](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/)
- [Preços](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Sobre a plataforma (vazão)](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform)
- [Changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) (fora do ar na consulta)

Parceiros e terceiros (para o que a página da Meta ainda não mostrava):
- [360dialog: cobrança de mensagens de serviço a partir de 01/10/2026](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/)
- [YCloud: atualização de preços de 01/10/2026](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [Zendesk: mudanças de preço anunciadas](https://support.zendesk.com/hc/en-us/articles/11113277351322-Announcing-upcoming-changes-to-WhatsApp-Business-messaging-pricing)
- [360dialog: webhooks de coexistência](https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence/coexistence-webhooks)
- [Twilio: campo BSUID](https://www.twilio.com/en-us/changelog/whatsapp-usernames--new-business-scoped-user-id--bsuid--field-re)
- [Kapso: indicador de digitação](https://docs.kapso.ai/docs/whatsapp/send-messages/mark-read)
- [DoubleTick: erro 131056](https://learn.doubletick.io/understanding-whatsapp-error-code-131056-pair-rate-limit)
