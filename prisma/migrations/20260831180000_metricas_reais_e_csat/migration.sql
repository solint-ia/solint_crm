-- Instantes reais do atendimento.
--
-- O painel calculava tempo de 1a resposta, tempo de resolucao e CSAT a partir
-- de constantes escritas no codigo. Nao havia de onde tirar o numero real: a
-- conversa nao guardava quando nasceu, quando foi respondida nem quando foi
-- resolvida, e nota de satisfacao nao existia em lugar nenhum do banco.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "firstResponseSecs" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "resolutionSecs" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "csatScore" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "csatComment" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "csatAskedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "csatAnsweredAt" TIMESTAMP(3);

-- Configuracao das mensagens automaticas que dependem de prazo.
ALTER TABLE "Inbox" ADD COLUMN IF NOT EXISTS "waitingMessageDelayMinutes" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Inbox" ADD COLUMN IF NOT EXISTS "csatEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Inbox" ADD COLUMN IF NOT EXISTS "csatQuestion" TEXT;

-- Retroalimentacao das conversas que ja existiam.
--
-- Sem isto toda conversa anterior a esta migracao nasceria com "agora" como
-- data de criacao e o painel diria que a conta inteira comecou hoje. A primeira
-- mensagem da conversa e a melhor aproximacao disponivel de quando ela comecou.
UPDATE "Conversation" c
SET "createdAt" = m."primeira"
FROM (
  SELECT "conversationId", MIN("createdAt") AS "primeira"
  FROM "Message"
  GROUP BY "conversationId"
) m
WHERE m."conversationId" = c."id" AND m."primeira" < c."createdAt";

-- Primeira resposta: a primeira mensagem publica de atendente/sistema que veio
-- depois da primeira mensagem do contato.
UPDATE "Conversation" c
SET "firstResponseAt" = r."respondeu",
    "firstResponseSecs" = GREATEST(0, EXTRACT(EPOCH FROM (r."respondeu" - c."createdAt"))::int)
FROM (
  SELECT m."conversationId", MIN(m."createdAt") AS "respondeu"
  FROM "Message" m
  WHERE m."author" <> 'contact' AND m."isPrivate" = false AND m."deletedAt" IS NULL
  GROUP BY m."conversationId"
) r
WHERE r."conversationId" = c."id" AND c."firstResponseAt" IS NULL;

-- Resolucao: nao ha registro de quando aconteceu, entao a ultima atividade e a
-- unica aproximacao honesta -- e so para quem ja esta resolvida.
UPDATE "Conversation"
SET "resolvedAt" = COALESCE("lastActivityAt", "createdAt"),
    "resolutionSecs" = GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE("lastActivityAt", "createdAt") - "createdAt"))::int
    )
WHERE "status" = 'resolvida' AND "resolvedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Conversation_accountId_createdAt_idx" ON "Conversation"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Conversation_status_lastInboundAt_idx" ON "Conversation"("status", "lastInboundAt");
