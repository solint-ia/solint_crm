-- Quem foi mencionado numa nota interna.
--
-- Coluna JSON pela regra do topo do schema: a lista é lida e gravada inteira
-- junto com a mensagem e nunca é consultada isoladamente. Normalizá-la criaria
-- uma tabela que só existiria para ser lida em join com a mensagem.
ALTER TABLE "Message" ADD COLUMN "mentions" JSONB NOT NULL DEFAULT '[]';
