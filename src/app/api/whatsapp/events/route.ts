import { whatsappService } from '@/infrastructure/whatsapp/whatsapp-service';
import { waEventBus, type WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Envia estado inicial imediatamente
      const initialStatus = whatsappService.getStatus();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialStatus)}\n\n`));

      // 2. Registra listener para atualizações
      const onStatus = (payload: WhatsAppStatusPayload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream fechada pelo cliente
        }
      };

      waEventBus.on('status', onStatus);

      // Heartbeat a cada 15 segundos para manter a conexão ativa
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
