import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { qrImage } from '@/infrastructure/whatsapp/qr-image';
import { waEventBus, type WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';
import { workerPresence } from '@/infrastructure/whatsapp/worker-presence';

export const dynamic = 'force-dynamic';

/**
 * Fluxo de status da conexão de WhatsApp.
 *
 * Exige sessão, e o QR só sai para a conta que pareou o número.
 *
 * O motivo é que o QR *é* a credencial: com ele, qualquer um pareia o WhatsApp
 * da empresa no próprio aparelho e passa a ler as conversas dos clientes. Esta
 * rota transmitia o payload inteiro, QR incluído, para qualquer requisição —
 * o `middleware.ts` deixa `/api` fora do matcher de propósito, então a checagem
 * é responsabilidade de cada rota.
 */
export async function GET(request: Request) {
  const session = await container.session.getSession();
  if (!session) {
    return new Response('Não autenticado', { status: 401 });
  }

  const accountId = session.account.id;
  const channel = await getWhatsAppChannel();
  const encoder = new TextEncoder();

  // No motor worker o barramento é compartilhado por todas as caixas: sem saber
  // qual é a desta conta, a tela de uma empresa mostraria o QR de outra.
  const inbox = await prisma.inbox.findFirst({
    where: { accountId, channel: 'whatsapp' },
    select: { id: true },
  });
  const ownInboxId = inbox?.id;

  /** Sem dono, o canal ainda não é de ninguém; com dono, o QR é só dele. */
  const scoped = (payload: WhatsAppStatusPayload): WhatsAppStatusPayload =>
    !payload.owner || payload.owner.accountId === accountId
      ? payload
      : { ...payload, qr: undefined };

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // Stream fechada pelo cliente entre o teste e a escrita.
        }
      };

      // Gerar a imagem do QR é assíncrono e o barramento avisa de forma
      // síncrona: a fila garante que dois status não se ultrapassem no caminho.
      let queue: Promise<void> = Promise.resolve();
      const publish = (payload: WhatsAppStatusPayload) => {
        queue = queue.then(async () => {
          const visible = scoped(payload);
          send(`data: ${JSON.stringify({ ...visible, qr: await qrImage(visible.qr) })}\n\n`);
        });
      };

      // 1. Envia estado inicial imediatamente
      queue = queue.then(async () => {
        const initial = await channel.getStatus(accountId);
        const visible = scoped(initial);
        send(`data: ${JSON.stringify({ ...visible, qr: await qrImage(visible.qr) })}\n\n`);
      });

      // 2. Registra listener para atualizações
      const onStatus = (payload: WhatsAppStatusPayload) => {
        // Status carimbado com outra caixa não é desta conta. Payload sem
        // `inboxId` vem do motor in-process, que atende uma sessão só.
        if (payload.inboxId && ownInboxId && payload.inboxId !== ownInboxId) return;
        publish(payload);
      };

      waEventBus.on('status', onStatus);

      // Heartbeat a cada 15 segundos para manter a conexão ativa.
      //
      // No motor worker ele também vigia a presença do worker: se o processo cair,
      // nenhuma atualização de status chega pelo barramento — justamente porque
      // não há mais quem as emita — e a tela ficaria mostrando "conectado" para
      // sempre. A mudança de presença é o gatilho para reler o estado real.
      let lastPresence = workerPresence().online;
      const interval = setInterval(() => {
        send(': heartbeat\n\n');
        if (channel.engine !== 'worker') return;

        const presence = workerPresence().online;
        if (presence === lastPresence) return;
        lastPresence = presence;
        queue = queue.then(async () => {
          const refreshed = await channel.getStatus(accountId);
          send(`data: ${JSON.stringify({ ...scoped(refreshed), qr: undefined })}\n\n`);
        });
      }, 15000);

      // Limpeza ao fechar conexão
      request.signal.addEventListener('abort', () => {
        closed = true;
        waEventBus.off('status', onStatus);
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // Já fechado
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
