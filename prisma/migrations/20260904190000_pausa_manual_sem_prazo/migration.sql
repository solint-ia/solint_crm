-- A pausa do botao deixa de ter validade.
--
-- Quem assume a conversa devolve quando terminar; dar prazo a isso traria o
-- agente de volta no meio de um atendimento humano sem ninguem ter pedido. O
-- que decide se o agente esta calado passa a ser `aiPausedReason`, e
-- `aiPausedUntil` fica so para a pausa que o sistema deduziu sozinho — a que
-- nasce de uma resposta pelo app do WhatsApp, que nao tem botao para desfazer.

UPDATE "Conversation"
SET "aiPausedUntil" = NULL
WHERE "aiPausedReason" = 'manual';

-- Pausas ja vencidas viram ausencia de pausa: com a regra nova, motivo sem
-- prazo significa "pausado para sempre", e deixa-las gravadas ressuscitaria
-- pausas que tinham terminado.
UPDATE "Conversation"
SET "aiPausedUntil" = NULL, "aiPausedBy" = NULL, "aiPausedByName" = NULL, "aiPausedReason" = NULL
WHERE "aiPausedReason" IS NOT NULL
  AND "aiPausedUntil" IS NOT NULL
  AND "aiPausedUntil" <= CURRENT_TIMESTAMP;

ALTER TABLE "Inbox" DROP COLUMN "aiPauseManualMinutes";
