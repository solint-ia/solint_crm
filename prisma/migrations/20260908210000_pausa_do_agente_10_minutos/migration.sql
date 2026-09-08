-- A pausa deduzida do agente cai de 30 para 10 minutos.
--
-- Este prazo nao e decisao de ninguem: ele nasce de o atendente ter respondido
-- pelo app do WhatsApp, e o sistema deduz que um humano assumiu. Meia hora era
-- caro demais para um palpite — uma unica mensagem digitada no celular deixava
-- o agente calado por trinta minutos, e o cliente sem resposta automatica
-- nenhuma nesse intervalo. Errar para menos devolve o agente cedo uma vez;
-- errar para mais para o atendimento sem ninguem ter pedido.
--
-- A pausa do botao (`manual`) nao tem prazo e nao e afetada por nada disto.

ALTER TABLE "Inbox"
ALTER COLUMN "aiPauseChannelReplyMinutes" SET DEFAULT 10;

-- Caixas que nunca mexeram no numero passam a seguir o padrao novo.
--
-- O filtro por 30 e o que separa "herdou o padrao antigo" de "alguem escolheu
-- este valor na tela". Nao da para distinguir os dois casos com certeza, e a
-- escolha aqui e assumir que 30 era heranca: quem quiser outro prazo continua
-- podendo defini-lo em Configuracoes > Caixas de entrada > Agente de IA.
UPDATE "Inbox"
SET "aiPauseChannelReplyMinutes" = 10
WHERE "aiPauseChannelReplyMinutes" = 30;

-- Pausas em curso encurtam junto.
--
-- Sem isto, um `aiPausedUntil` gravado antes desta migracao manteria o agente
-- fora por mais tempo do que a regra nova permite — a mudanca so valeria para
-- a proxima mensagem, e quem esta esperando agora continuaria esperando.
-- So a pausa deduzida da resposta pelo celular e encurtada: as outras tem
-- motivo proprio e prazo proprio.
UPDATE "Conversation"
SET "aiPausedUntil" = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
WHERE "aiPausedReason" = 'resposta_no_celular'
  AND "aiPausedUntil" > CURRENT_TIMESTAMP + INTERVAL '10 minutes';
