import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { qrImage } from '@/infrastructure/whatsapp/qr-image';
import { waEventBus, type WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

export const dynamic = 'force-dynamic';

/**
 * O QR circula cru pelo domínio e vira imagem só na resposta ao navegador.
 * Ver `qr-image.ts`: como data URL ele não cabe no teto do `pg_notify`.
 */
const withQrImage = async (payload: WhatsAppStatusPayload): Promise<WhatsAppStatusPayload> => ({
  ...payload,
  qr: await qrImage(payload.qr),
});

export async function GET(request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;
  const session = await container.session.getSession();

  if (!session) {
    return new Response('Não autenticado', { status: 401 });
  }

  // Valida que a Inbox pertence à conta
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, accountId: session.account.id },
    select: { id: true },
  });

  if (!inbox) {
    return new Response('Caixa de entrada não encontrada', { status: 404 });
  }

  const encoder = new TextEncoder();
  const FRAME_END = '\n\n';

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // Stream fechada pelo cliente
        }
      };

      // Gerar a imagem do QR é assíncrono e o barramento avisa de forma
      // síncrona: a fila garante que dois status não se ultrapassem no caminho.
      let queue: Promise<void> = Promise.resolve();
      const publish = (payload: WhatsAppStatusPayload) => {
        queue = queue.then(async () => {
          send(`data: ${JSON.stringify(await withQrImage(payload))}${FRAME_END}`);
        });
      };

      // 1. Envia estado inicial lido diretamente do banco de dados
      const conn = await prisma.whatsAppConnection.findUnique({ where: { inboxId } });

      publish({
        inboxId,
        status: (conn?.status as WhatsAppStatusPayload['status']) ?? 'desconectado',
        qr: conn?.qrPayload ?? undefined,
        error: conn?.lastError ?? undefined,
        phone: conn?.phoneJid ?? undefined,
        name: conn?.profileName ?? 'WhatsApp',
        owner: conn?.pairedByUserId
          ? {
              userId: conn.pairedByUserId,
              userName: conn.profileName ?? 'WhatsApp',
              accountId: session.account.id,
            }
          : undefined,
        updatedAt: conn?.updatedAt.toISOString() ?? new Date().toISOString(),
      });

      // 2. Registra listener para atualizações em tempo real
      //
      // O barramento e do processo, nao da caixa: com o worker mantendo varias
      // sessoes, o status de uma caixa chegava na tela de todas. Payload sem
      // `inboxId` vem do servico in-process, que atende uma sessao so.
      const onStatus = (payload: WhatsAppStatusPayload) => {
        if (payload.inboxId && payload.inboxId !== inboxId) return;
        publish(payload);
      };

      waEventBus.on('status', onStatus);

      // Heartbeat a cada 15 segundos
      const interval = setInterval(() => send(`: heartbeat${FRAME_END}`), 15000);

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
