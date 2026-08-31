import type { Conversation } from '@/core/domain/conversation';
import { canSeeInbox } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import {
  waEventBus,
  type ConversationEventPayload,
} from '@/infrastructure/whatsapp/whatsapp-events';

export const dynamic = 'force-dynamic';

/**
 * De qual caixa é este evento.
 *
 * Duas origens porque os emissores diferem: alguns declaram `inboxId` na raiz
 * do evento, outros trazem a conversa inteira (reidratada do banco no processo
 * do site) e a caixa está dentro dela. Ler as duas evita depender de todo
 * emissor lembrar do campo — e o que não tiver nenhuma das duas é barrado por
 * `canSeeInbox`.
 */
const inboxIdOf = (payload: ConversationEventPayload): string | undefined =>
  payload.inboxId ?? (payload.conversation as Conversation | undefined)?.inboxId;

export async function GET(request: Request) {
  // Sem sessão não há conta, e sem conta não há como filtrar: recusar é a única
  // resposta correta. Antes esta rota abria para qualquer um e repassava os
  // eventos de todas as contas.
  const session = await container.session.getSession();
  if (!session) {
    return new Response('Não autenticado', { status: 401 });
  }

  const accountId = session.account.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Registra listener para atualizações de conversas
      const onConversationUpdate = (payload: ConversationEventPayload) => {
        // O barramento é do processo, não da conta: o filtro é aqui.
        if (payload.accountId !== accountId) return;

        // Conta certa não basta: dentro dela, cada pessoa alcança só as caixas
        // das suas equipes. Sem este filtro, uma conversa da Cobrança apareceria
        // ao vivo na tela de quem só atende a Recepção — e a lista, que já é
        // recortada no banco, seria contornada pelo tempo real.
        //
        // O `inboxId` vem do próprio evento; quando não vem, `canSeeInbox`
        // recusa. Deixar passar o que não se sabe identificar seria escolher o
        // vazamento em vez do evento perdido.
        if (!canSeeInbox(session, inboxIdOf(payload))) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream fechada pelo cliente
        }
      };

      waEventBus.on('conversation', onConversationUpdate);

      /**
       * Batida **como evento**, não como comentário.
       *
       * Era `: heartbeat`, que o protocolo SSE trata como comentário: serve para
       * manter a conexão viva num proxy, mas o `EventSource` do navegador não o
       * entrega a ninguém. Do lado do cliente, portanto, uma conexão viva e uma
       * conexão morta em silêncio eram indistinguíveis — e a segunda acontece:
       * o processo do outro lado reinicia, um balanceador corta o fluxo, e o
       * `onerror` nem sempre dispara.
       *
       * Mandando a batida como dado, o cliente ganha o que lhe faltava: prova
       * periódica de que o canal responde, e um vigia que reconecta quando ela
       * para de chegar. Ver `conversation-events.tsx`.
       */
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 15000);

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
