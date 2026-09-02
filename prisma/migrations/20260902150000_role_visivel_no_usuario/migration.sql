-- `Membership.roleSlug` continua sendo a fonte de verdade da autorização:
-- um mesmo usuário pode ser administrador em uma conta e colaborador em outra.
-- Esta coluna é uma projeção deliberadamente simples para que inspecionar
-- `User` no painel do banco mostre de imediato o papel principal da pessoa.
ALTER TABLE "User" ADD COLUMN "role" TEXT;

CREATE OR REPLACE FUNCTION sync_user_debug_role(target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "User" AS u
  SET "role" = CASE
    WHEN u."isSuperAdmin" THEN 'superadmin'
    ELSE (
      SELECT m."roleSlug"
      FROM "Membership" AS m
      WHERE m."userId" = u.id
      ORDER BY m."createdAt" ASC, m.id ASC
      LIMIT 1
    )
  END
  WHERE u.id = target_user_id;
END;
$$;

-- Preenche quem já existia antes da coluna.
UPDATE "User" AS u
SET "role" = CASE
  WHEN u."isSuperAdmin" THEN 'superadmin'
  ELSE (
    SELECT m."roleSlug"
    FROM "Membership" AS m
    WHERE m."userId" = u.id
    ORDER BY m."createdAt" ASC, m.id ASC
    LIMIT 1
  )
END;

CREATE OR REPLACE FUNCTION sync_user_debug_role_from_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_user_debug_role(OLD."userId");
    RETURN OLD;
  END IF;

  PERFORM sync_user_debug_role(NEW."userId");

  IF TG_OP = 'UPDATE' AND OLD."userId" IS DISTINCT FROM NEW."userId" THEN
    PERFORM sync_user_debug_role(OLD."userId");
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_sync_user_role_after_insert
AFTER INSERT ON "Membership"
FOR EACH ROW EXECUTE FUNCTION sync_user_debug_role_from_membership();

CREATE TRIGGER membership_sync_user_role_after_update
AFTER UPDATE OF "userId", "roleSlug", "createdAt" ON "Membership"
FOR EACH ROW EXECUTE FUNCTION sync_user_debug_role_from_membership();

CREATE TRIGGER membership_sync_user_role_after_delete
AFTER DELETE ON "Membership"
FOR EACH ROW EXECUTE FUNCTION sync_user_debug_role_from_membership();

CREATE OR REPLACE FUNCTION sync_user_debug_role_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM sync_user_debug_role(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_sync_debug_role_after_superadmin_change
AFTER UPDATE OF "isSuperAdmin" ON "User"
FOR EACH ROW
WHEN (OLD."isSuperAdmin" IS DISTINCT FROM NEW."isSuperAdmin")
EXECUTE FUNCTION sync_user_debug_role_from_user();
