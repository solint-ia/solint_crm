-- Corrige o preenchimento retroativo do tempo de primeira resposta.
--
-- A migracao anterior mediu da criacao da conversa ate a primeira mensagem que
-- nao fosse do contato. Em quase todo o historico importado do WhatsApp, essa
-- mensagem E a primeira da conversa -- entao a diferenca dava zero, e o painel
-- passaria a exibir "0s" de tempo de resposta para 86 conversas. Trocar uma
-- constante inventada por um zero inventado nao e conserto nenhum.
--
-- A medida certa comeca na primeira mensagem DO CONTATO e termina na primeira
-- resposta publica de atendente depois dela. Conversa que nunca teve mensagem
-- do contato (campanha, retomada) nao tem espera a medir e fica nula.
UPDATE "Conversation" c
SET "firstResponseAt" = NULL,
    "firstResponseSecs" = NULL;

UPDATE "Conversation" c
SET "firstResponseAt" = t."respondeu",
    "firstResponseSecs" = GREATEST(0, EXTRACT(EPOCH FROM (t."respondeu" - t."perguntou"))::int)
FROM (
  SELECT
    entrada."conversationId",
    entrada."perguntou",
    MIN(resposta."createdAt") AS "respondeu"
  FROM (
    SELECT "conversationId", MIN("createdAt") AS "perguntou"
    FROM "Message"
    WHERE "author" = 'contact' AND "isPrivate" = false
    GROUP BY "conversationId"
  ) entrada
  JOIN "Message" resposta
    ON resposta."conversationId" = entrada."conversationId"
   AND resposta."author" = 'agent'
   AND resposta."isPrivate" = false
   AND resposta."deletedAt" IS NULL
   AND resposta."createdAt" > entrada."perguntou"
  GROUP BY entrada."conversationId", entrada."perguntou"
) t
WHERE t."conversationId" = c."id";
