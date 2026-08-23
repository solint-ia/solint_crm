import {
  matchesScope,
  PRIORITY_WEIGHT,
  type Conversation,
  type ConversationFilter,
} from '../domain/conversation';
import type { Id } from '../domain/shared';
import type { ConversationReader } from '../ports/conversation-repository';

export interface ListConversationsInput {
  readonly accountId: Id;
  readonly currentUserId: Id;
  readonly filter: ConversationFilter;
}

/**
 * Aplica escopo, filtros e ordenacao sobre as conversas.
 * As regras vivem aqui (e não no componente) para serem testaveis e reutilizaveis.
 */
export const createListConversations =
  (repository: ConversationReader) =>
  async ({
    accountId,
    currentUserId,
    filter,
  }: ListConversationsInput): Promise<readonly Conversation[]> => {
    const conversations = await repository.list(accountId, currentUserId, filter);
    const term = filter.search?.trim().toLowerCase() ?? '';

    const filtered = conversations.filter((conversation) => {
      if (!matchesScope(conversation, filter.scope, currentUserId)) return false;
      if (filter.status && filter.status !== 'todas' && conversation.status !== filter.status) {
        return false;
      }
      if (filter.channel && conversation.channel !== filter.channel) return false;
      if (filter.priority && conversation.priority !== filter.priority) return false;
      if (filter.labelId && !conversation.labels.some((label) => label.id === filter.labelId)) {
        return false;
      }
      if (!term) return true;
      return (
        conversation.contact.name.toLowerCase().includes(term) ||
        conversation.lastMessagePreview.toLowerCase().includes(term) ||
        conversation.contact.phone.includes(term)
      );
    });

    return sortConversations(filtered, filter.sort ?? 'recentes');
  };

const sortConversations = (
  conversations: readonly Conversation[],
  sort: NonNullable<ConversationFilter['sort']>,
): readonly Conversation[] => {
  const copy = [...conversations];
  if (sort === 'prioridade') {
    return copy.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
  }
  if (sort === 'antigas') return copy.reverse();
  return copy;
};
