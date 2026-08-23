import { waEventBus, type ConversationEventPayload } from '@/infrastructure/whatsapp/whatsapp-events';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Registra listener para atualizações de conversas
      const onConversationUpdate = (payload: ConversationEventPayload) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // Stream fechada pelo cliente
        }
      };

      waEventBus.on('conversation', onConversationUpdate);

      // Heartbeat a cada 20 segundos
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 20000);

      // Limpeza ao fechar conexão
      request.signal.addEventListener('abort', () => {
        waEventBus.off('conversation', onConversationUpdate);
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
