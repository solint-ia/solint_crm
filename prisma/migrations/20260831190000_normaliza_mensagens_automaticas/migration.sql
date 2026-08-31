-- Normaliza as respostas automaticas gravadas com a chave errada.
--
-- O cadastro gravava `{ "enabled": false, "message": "" }` e o dominio sempre
-- leu `text`. O objeto passava pela leitura (era um objeto valido), chegava na
-- tela sem `text` e voltava para o servidor sem o campo -- onde a validacao
-- recusava o salvamento INTEIRO da caixa com "Dados invalidos para a caixa de
-- entrada", mesmo quando a pessoa tinha editado outra mensagem.
--
-- O codigo agora normaliza na leitura (`normalizeAutoReply`), entao isto nao e
-- o conserto: e a limpeza, para que o que esta no banco pare de mentir sobre a
-- forma e ninguem tropece nela de novo pela via de uma consulta direta.
UPDATE "Inbox"
SET "awayMessage" = jsonb_build_object(
      'enabled', COALESCE(("awayMessage" -> 'enabled')::boolean, false),
      'text', COALESCE("awayMessage" ->> 'message', '')
    )
WHERE "awayMessage" IS NOT NULL
  AND "awayMessage" ? 'message'
  AND NOT ("awayMessage" ? 'text');

UPDATE "Inbox"
SET "greeting" = jsonb_build_object(
      'enabled', COALESCE(("greeting" -> 'enabled')::boolean, false),
      'text', COALESCE("greeting" ->> 'message', '')
    )
WHERE "greeting" IS NOT NULL
  AND "greeting" ? 'message'
  AND NOT ("greeting" ? 'text');

UPDATE "Inbox"
SET "closingMessage" = jsonb_build_object(
      'enabled', COALESCE(("closingMessage" -> 'enabled')::boolean, false),
      'text', COALESCE("closingMessage" ->> 'message', '')
    )
WHERE "closingMessage" IS NOT NULL
  AND "closingMessage" ? 'message'
  AND NOT ("closingMessage" ? 'text');

UPDATE "Inbox"
SET "waitingMessage" = jsonb_build_object(
      'enabled', COALESCE(("waitingMessage" -> 'enabled')::boolean, false),
      'text', COALESCE("waitingMessage" ->> 'message', '')
    )
WHERE "waitingMessage" IS NOT NULL
  AND "waitingMessage" ? 'message'
  AND NOT ("waitingMessage" ? 'text');

-- As duas mensagens novas nascem desligadas em vez de nulas, para a tela nao
-- depender de um padrao inventado no cliente.
UPDATE "Inbox"
SET "closingMessage" = '{"enabled": false, "text": ""}'::jsonb
WHERE "closingMessage" IS NULL;

UPDATE "Inbox"
SET "waitingMessage" = '{"enabled": false, "text": ""}'::jsonb
WHERE "waitingMessage" IS NULL;
