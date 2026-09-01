-- Permissões granulares: renomeia `agente` -> `colaborador`, cria o Supervisor
-- real e abre espaço para personalização por pessoa.

-- 1. Personalização por pessoa. `NULL` = segue o papel exatamente, que é o
--    estado de todo mundo hoje.
ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "permissionOverrides" JSONB;

-- 2. O papel muda de nome.
--
--    O `id` precisa mudar junto com o `slug` porque `systemRoleId()` embute o
--    slug no id (`role-${slug}-${accountId}`): trocar só o slug deixaria
--    `ensureSystemRoles` achando que o papel está faltando e tentando recriá-lo
--    — o que estouraria na chave única de (accountId, slug).
--
--    A ordem importa: o `Role` primeiro, o `Membership` depois. Como `roleSlug`
--    não é chave estrangeira (ver o comentário do campo no schema), não há
--    cascata a temer — mas entre as duas linhas os vínculos apontam para um
--    slug que não existe, e é uma janela curta dentro da mesma transação.
UPDATE "Role"
   SET "id" = 'role-colaborador-' || "accountId",
       "slug" = 'colaborador',
       "name" = 'Colaborador'
 WHERE "slug" = 'agente';

UPDATE "Membership" SET "roleSlug" = 'colaborador' WHERE "roleSlug" = 'agente';
UPDATE "Invite" SET "roleSlug" = 'colaborador' WHERE "roleSlug" = 'agente';

-- 3. A taxonomia de Configurações deixa de ser um par único.
--
--    `Role.permissions` é uma coluna JSON com um array de strings. Quem tinha o
--    antigo `configuracoes:ler` genérico recebe o equivalente explícito em cada
--    sub-seção — do contrário, um administrador personalizado perderia acesso a
--    Configurações inteira no deploy. O administrador é corrigido por este mesmo
--    UPDATE e, daqui em diante, `ensureSystemRoles` o mantém em dia com
--    `PERMISSIONS` a cada carga de Configurações.
--
--    Quem tinha só `configuracoes:ler` (sem escrever) fica só com os `:ler`.
UPDATE "Role" AS r
   SET "permissions" = calculado.perms
  FROM (
    SELECT alvo.id,
           COALESCE(jsonb_agg(DISTINCT origem.p), '[]'::jsonb) AS perms
      FROM "Role" AS alvo
      CROSS JOIN LATERAL (
              SELECT t.p
                FROM jsonb_array_elements_text(alvo."permissions") AS t(p)
               WHERE t.p NOT IN ('configuracoes:ler', 'configuracoes:escrever',
                                 'equipe:gerenciar', 'faturamento:gerenciar')
        UNION ALL
              SELECT unnest(ARRAY[
                       'config.caixas:ler', 'config.equipe.membros:ler',
                       'config.automacoes:ler', 'config.etiquetas:ler',
                       'config.respostas:ler', 'config.conhecimento:ler',
                       'config.atributos:ler', 'config.empresa:ler',
                       'config.seguranca:ler', 'config.faturamento:ler'
                     ])
               WHERE alvo."permissions" ? 'configuracoes:ler'
        UNION ALL
              SELECT unnest(ARRAY[
                       'config.caixas:escrever', 'config.caixas:excluir',
                       'config.equipe.membros:escrever',
                       'config.automacoes:escrever', 'config.etiquetas:escrever',
                       'config.respostas:escrever', 'config.conhecimento:escrever',
                       'config.atributos:escrever', 'config.empresa:escrever',
                       'config.seguranca:escrever'
                     ])
               WHERE alvo."permissions" ? 'configuracoes:escrever'
        UNION ALL
              SELECT unnest(ARRAY['config.equipe.papeis:ler', 'config.equipe.papeis:escrever'])
               WHERE alvo."permissions" ? 'equipe:gerenciar'
                 AND alvo."permissions" ? 'configuracoes:escrever'
      ) AS origem(p)
     WHERE jsonb_typeof(alvo."permissions") = 'array'
     GROUP BY alvo.id
  ) AS calculado
 WHERE r.id = calculado.id;

-- 4. Colaborador ganha `config.caixas:ler` mesmo sem ter tido `configuracoes:ler`
--    antes — é o "caixa de entrada todo mundo tem acesso" do pedido, e o papel
--    de sistema já nasce assim daqui em diante.
UPDATE "Role"
   SET "permissions" = ("permissions" || '["config.caixas:ler"]'::jsonb)
 WHERE "slug" = 'colaborador'
   AND jsonb_typeof("permissions") = 'array'
   AND NOT ("permissions" ? 'config.caixas:ler');
