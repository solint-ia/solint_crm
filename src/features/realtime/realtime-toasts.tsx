'use client';

import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import type { Conversation } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import { previewOfMessage } from '@/core/domain/message';
import { useToast } from '@/components/ui/toast';
import { useConversationEvents } from './conversation-events';

/**
 * Traduz o barramento de eventos em avisos visíveis.
 *
 * Regra de silêncio: dentro de `/conversas` não aparece toast. Quem está na
 * caixa de entrada já vê a lista se reorganizar e a bolha chegar — repetir a
 * informação num cartão flutuante só atrapalharia a leitura. O aviso serve a
 * quem está em outra tela e perderia a mensagem.
 */
export function RealtimeToasts() {
  const pathname = usePathname();
  const { show } = useToast();
  const onInbox = pathname.startsWith('/conversas');

  useConversationEvents((payload) => {
    if (onInbox) return;

    const conversation = payload.conversation as Conversation | undefined;
    const message =
      (payload.message as Message | undefined) ??
      [...(conversation?.timeline ?? [])]
        .reverse()
        .find((item) => item.kind === 'message')?.message;

    // Eco das nossas próprias mensagens não é novidade para quem as enviou.
    if (!message || message.author !== 'contact') return;

    const href = `/conversas/${payload.conversationId}` as Route;
    const who = conversation?.contact.name ?? message.authorName ?? 'Novo contato';

    show({
      tone: payload.type === 'new_conversation' ? 'sucesso' : 'info',
      title:
        payload.type === 'new_conversation' ? `Nova conversa · ${who}` : `${who} respondeu`,
      description: previewOfMessage(message),
      href,
      actionLabel: 'Abrir conversa',
      dedupeKey: payload.conversationId,
    });
  });

  return null;
}
