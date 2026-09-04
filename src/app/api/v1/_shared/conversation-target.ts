import { z } from 'zod';

import { CONVERSATION_ID_MAX_LENGTH } from '@/core/domain/conversation';
import { prisma } from '@/infrastructure/db/prisma';

/**
 * Formas públicas de apontar uma conversa nas rotas de integração.
 *
 * O n8n normalmente já tem `conversaId`, mas webhooks no formato bruto do
 * WhatsApp carregam `jid`/`number`. Manter este vocabulário em um lugar só
 * impede que envio de mensagem e presença escolham caixas diferentes.
 */
export const conversationTargetShape = {
  conversaId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH).optional(),
  jid: z.string().trim().min(1).max(128).optional(),
  number: z.string().trim().min(1).max(32).optional(),
  instanceId: z.string().trim().min(1).max(128).optional(),
};

export interface ConversationTargetInput {
  readonly conversaId?: string;
  readonly jid?: string;
  readonly number?: string;
  readonly instanceId?: string;
}

export const hasConversationTarget = (input: ConversationTargetInput): boolean =>
  Boolean(input.conversaId ?? input.jid ?? input.number);

/**
 * As formas de JID que podem estar gravadas para o mesmo telefone.
 *
 * Um celular brasileiro pode aparecer com ou sem o nono dígito. O identificador
 * completo é preservado, inclusive para grupos e LIDs; telefone solto ganha as
 * duas formas brasileiras possíveis antes da busca.
 */
export const candidateJids = (raw: string): readonly string[] => {
  if (raw.includes('@')) return [raw];

  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];

  const forms = new Set<string>([digits]);
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    forms.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    forms.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  }

  return [...forms].map((form) => `${form}@s.whatsapp.net`);
};

/**
 * Resolve o id dentro da conta autenticada.
 *
 * `conversaId` não exige consulta aqui: cada caso de uso ainda precisa carregar
 * e autorizar a conversa. Para `jid`/`number`, o escopo por conta e caixa é
 * obrigatório para que um token nunca encontre o atendimento de outra empresa.
 */
export const resolveApiConversationId = async (
  accountId: string,
  target: ConversationTargetInput,
): Promise<string | null> => {
  if (target.conversaId) return target.conversaId;

  const recipient = target.jid ?? target.number;
  if (!recipient) return null;

  const candidates = candidateJids(recipient);
  if (candidates.length === 0) return null;

  const conversation = await prisma.conversation.findFirst({
    where: {
      accountId,
      channelThreadId: { in: [...candidates] },
      ...(target.instanceId ? { inboxId: target.instanceId } : {}),
    },
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true },
  });

  return conversation?.id ?? null;
};
