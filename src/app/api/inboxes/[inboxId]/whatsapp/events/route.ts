import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { waEventBus, type WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  props: { params: Promise<{ inboxId: string }> },
) {
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

  const stream = new ReadableStream({
    async start(controller) {
      // 1. Envia estado inicial lido diretamente do banco de dados
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { inboxId },
      });

      const initialStatus: WhatsAppStatusPayload = {
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
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialStatus)}\n\n`));

      // 2. Registra listener para atualizações em tempo real
      const onStatus = (payload: WhatsAppStatusPayload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream fechada pelo cliente
        }
      };

      waEventBus.on('status', onStatus);

      // Heartbeat a cada 15 segundos
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 15000);

      // Limpeza ao fechar conexão
      request.signal.addEventListener('abort', () => {
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
