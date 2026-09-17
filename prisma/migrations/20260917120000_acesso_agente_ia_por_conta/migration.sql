-- A liberacao e por conta e nasce fechada. Contas que ja usam IA devem ser
-- habilitadas explicitamente antes de publicar o codigo que aplica o bloqueio.
ALTER TABLE "Account"
ADD COLUMN "aiAgentAccessEnabled" BOOLEAN NOT NULL DEFAULT false;
