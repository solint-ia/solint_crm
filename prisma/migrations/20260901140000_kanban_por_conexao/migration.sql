-- Kanban por conexão do WhatsApp: cada caixa de entrada ganha o próprio funil.

-- 1. O vínculo. `NULL` = funil avulso, que é o estado de tudo que já existe.
ALTER TABLE "Pipeline" ADD COLUMN IF NOT EXISTS "inboxId" TEXT;

CREATE INDEX IF NOT EXISTS "Pipeline_inboxId_idx" ON "Pipeline"("inboxId");

-- `SET NULL` e não `CASCADE`: excluir uma conexão do WhatsApp já apaga
-- conversas e mensagens daquela caixa. Levar junto o histórico comercial —
-- negócios ganhos, valores fechados — seria uma perda de outra natureza, que
-- ninguém pediu ao clicar em "excluir caixa".
ALTER TABLE "Pipeline"
  ADD CONSTRAINT "Pipeline_inboxId_fkey"
  FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Corrige um bug pré-existente: `isDefault` quase nunca é `true`.
--
--    O cadastro cria o funil da conta sem marcar a flag; só o auto-criador de
--    "conta com zero funis" a marca, e ele quase nunca dispara. O resultado é
--    que `funilDaConta` — usado pelo card de funil do Dashboard — não encontrava
--    o padrão que o próprio comentário dela afirma existir. Marca o mais antigo
--    de cada conta, e só quando a conta não tem nenhum marcado.
UPDATE "Pipeline" AS p
   SET "isDefault" = true
  FROM (
    SELECT DISTINCT ON (mais."accountId") mais."id"
      FROM "Pipeline" AS mais
     WHERE NOT EXISTS (
             SELECT 1 FROM "Pipeline" AS irmao
              WHERE irmao."accountId" = mais."accountId" AND irmao."isDefault"
           )
     ORDER BY mais."accountId", mais."id" ASC
  ) AS escolhido
 WHERE p."id" = escolhido."id";
