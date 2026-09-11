-- Horário de funcionamento do agente de IA, por caixa. Nulo = atende a qualquer
-- hora, que é o comportamento de hoje para as caixas existentes.
ALTER TABLE "Inbox" ADD COLUMN "aiAgentSchedule" JSONB;

-- A mensagem fora do expediente saiu do produto. A coluna fica (sem apagar o
-- texto de ninguém), mas deixa de ser exigida de quem cria uma caixa.
ALTER TABLE "Inbox" ALTER COLUMN "awayMessage" SET DEFAULT '{}';
