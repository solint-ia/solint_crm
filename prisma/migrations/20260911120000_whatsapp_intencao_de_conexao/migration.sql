-- Intenção de conexão da caixa. `true` preserva o comportamento de hoje para as
-- linhas existentes: o worker continua restaurando o que tem sessão pareada.
ALTER TABLE "WhatsAppConnection"
ADD COLUMN "autoConnect" BOOLEAN NOT NULL DEFAULT true;
