import 'server-only';
import { WA_ENGINE, type WhatsAppChannel } from './channel';

/**
 * Devolve o motor de WhatsApp configurado.
 *
 * O import é dinâmico por necessidade, não por estilo: carregar
 * `whatsapp-service` **liga** o Baileys (o construtor agenda a restauração da
 * sessão salva). Com um import estático, o motor `worker` subiria uma segunda
 * sessão dentro do site — as duas brigariam pelo mesmo número e o WhatsApp
 * derrubaria ambas com `connectionReplaced`.
 *
 * A promessa é memorizada para que o motor seja um só por processo.
 */
let cached: Promise<WhatsAppChannel> | undefined;

export const getWhatsAppChannel = (): Promise<WhatsAppChannel> => {
  cached ??= (async () => {
    if (WA_ENGINE === 'worker') {
      const { QueueWhatsAppChannel } = await import('./queue-channel');
      const { watchWorker } = await import('./worker-presence');
      // Começa a ouvir as batidas já: quem perguntar o status logo depois do
      // boot precisa ter uma resposta honesta, não um "offline" por ignorância.
      watchWorker();
      return new QueueWhatsAppChannel();
    }

    const { InProcessWhatsAppChannel } = await import('./in-process-channel');
    const canal = new InProcessWhatsAppChannel();

    /**
     * Sem worker, quem tem relógio é este processo.
     *
     * No motor `worker` o varredor de agendamentos vive lá (ver `worker.mts`) e
     * ligar um segundo aqui faria a mesma mensagem disputar duas saídas. No
     * motor in-process não há outro processo: o servidor Next é tudo o que
     * existe, e sem isto uma mensagem agendada simplesmente nunca sairia.
     */
    const { ScheduledMessageRunner } = await import('../scheduling/scheduled-runner');
    const runner = new ScheduledMessageRunner(async (envio) => {
      const enviado = await canal.sendText(
        {
          accountId: envio.accountId,
          conversationId: envio.conversationId,
          messageId: envio.messageId,
          inboxId: envio.inboxId,
        },
        envio.recipient,
        envio.text,
      );
      return {
        ok: enviado.ok,
        ...(enviado.externalId ? { externalId: enviado.externalId } : {}),
        ...(enviado.error ? { error: enviado.error } : {}),
      };
    });
    runner.start();

    return canal;
  })();

  return cached;
};
