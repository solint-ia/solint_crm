-- Foto de perfil do usuário. A URL guarda tipo e versão na própria query
-- string (ver o comentário do campo no schema); não há coluna separada para
-- eles.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
