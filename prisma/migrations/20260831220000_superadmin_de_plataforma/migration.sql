-- Superadministrador de plataforma.
--
-- A flag é da pessoa, não do vínculo com uma conta: quem administra webhooks e
-- tokens de todas as contas não é membro de nenhuma delas em particular. Por
-- isso mora em "User" e não em "Membership"/"Role".
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- O gerente da plataforma. O e-mail é guardado em minúsculas (ver o comentário
-- do campo no schema), então a comparação é direta.
UPDATE "User" SET "isSuperAdmin" = true WHERE "email" = 'llx.webpro@gmail.com';
