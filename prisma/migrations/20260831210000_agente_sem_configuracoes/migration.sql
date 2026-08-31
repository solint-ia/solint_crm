-- Tira o acesso a Configuracoes do papel de agente.
--
-- O modelo de papel de sistema concedia `configuracoes:ler` ao agente, e e essa
-- permissao que a navegacao exige para desenhar a aba. Todo agente de conta
-- criada pelo cadastro via Configuracoes -- canais, equipe, faturamento,
-- seguranca e tokens de API -- em modo leitura. Nada no produto depende disso:
-- respostas rapidas e etiquetas, que o agente usa de verdade, chegam pela tela
-- de conversas.
--
-- `ensureSystemRoles` so cria papeis que faltam, nunca atualiza os que existem,
-- entao as contas ja criadas precisam desta correcao explicita.
--
-- Restrito a `isSystem`: um papel personalizado a que alguem deu acesso a
-- Configuracoes de proposito nao e tocado.
UPDATE "Role"
SET "permissions" = (
  SELECT COALESCE(jsonb_agg(perm), '[]'::jsonb)
  FROM jsonb_array_elements("permissions") AS perm
  WHERE perm::text <> '"configuracoes:ler"'
)
WHERE "slug" = 'agente'
  AND "isSystem" = true
  AND "permissions" @> '["configuracoes:ler"]'::jsonb;
