-- Pausa do agente de IA por conversa.
--
-- Conversas existentes ficam com o agente ativo (colunas nulas), que e o
-- comportamento de hoje. As caixas recebem os prazos padrao; quem quiser outro
-- numero muda na tela de configuracoes da caixa.

ALTER TABLE "Conversation"
ADD COLUMN "aiPausedUntil" TIMESTAMP(3),
ADD COLUMN "aiPausedBy" TEXT,
ADD COLUMN "aiPausedByName" TEXT,
ADD COLUMN "aiPausedReason" TEXT;

ALTER TABLE "Inbox"
ADD COLUMN "aiPauseManualMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN "aiPauseChannelReplyMinutes" INTEGER NOT NULL DEFAULT 30;
