import type { AiAgentRepository, AiAgentSandbox } from '@/core/ports/ai-agent-repository';
import type { AnalyticsRepository } from '@/core/ports/analytics-repository';
import type { CampaignRepository } from '@/core/ports/campaign-repository';
import type { ContactRepository } from '@/core/ports/contact-repository';
import type { ConversationRepository } from '@/core/ports/conversation-repository';
import type { NotificationRepository } from '@/core/ports/notification-repository';
import type { PipelineRepository } from '@/core/ports/pipeline-repository';
import type { SessionProvider } from '@/core/ports/session-provider';
import type { SettingsRepository } from '@/core/ports/settings-repository';
import { createChangeConversationStatus } from '@/core/use-cases/change-conversation-status';
import { createListContacts } from '@/core/use-cases/list-contacts';
import { createListConversations } from '@/core/use-cases/list-conversations';
import { createMoveConversationInbox } from '@/core/use-cases/move-conversation-inbox';
import { createMoveDeal } from '@/core/use-cases/move-deal';
import { createSendMessage } from '@/core/use-cases/send-message';
import { createSendMedia, createSendTemplate } from '@/core/use-cases/send-rich-message';
import {
  createAssignConversation,
  createChangeConversationPriority,
  createSetConversationLabels,
} from '@/core/use-cases/triage-conversation';
import { EchoAiAgentSandbox } from './repositories/in-memory/ai-agent-repository';
import { PrismaAnalyticsRepository } from './repositories/prisma/analytics-repository';
import { PrismaCampaignRepository } from './repositories/prisma/campaign-repository';
import { PrismaContactRepository } from './repositories/prisma/contact-repository';
import { PrismaConversationRepository } from './repositories/prisma/conversation-repository';
import {
  PrismaAiAgentRepository,
  PrismaNotificationRepository,
  PrismaPipelineRepository,
} from './repositories/prisma/misc-repositories';
import { CookieSessionProvider } from './repositories/prisma/session-provider';
import { PrismaSettingsRepository } from './repositories/prisma/settings-repository';

export interface Container {
  readonly session: SessionProvider;
  readonly conversations: ConversationRepository;
  readonly contacts: ContactRepository;
  readonly pipelines: PipelineRepository;
  readonly aiAgents: AiAgentRepository;
  readonly aiSandbox: AiAgentSandbox;
  readonly campaigns: CampaignRepository;
  readonly analytics: AnalyticsRepository;
  readonly notifications: NotificationRepository;
  readonly settings: SettingsRepository;
  readonly useCases: {
    readonly listConversations: ReturnType<typeof createListConversations>;
    readonly sendMessage: ReturnType<typeof createSendMessage>;
    readonly changeConversationStatus: ReturnType<typeof createChangeConversationStatus>;
    readonly assignConversation: ReturnType<typeof createAssignConversation>;
    readonly moveConversationInbox: ReturnType<typeof createMoveConversationInbox>;
    readonly changeConversationPriority: ReturnType<typeof createChangeConversationPriority>;
    readonly setConversationLabels: ReturnType<typeof createSetConversationLabels>;
    readonly sendTemplate: ReturnType<typeof createSendTemplate>;
    readonly sendMedia: ReturnType<typeof createSendMedia>;
    readonly moveDeal: ReturnType<typeof createMoveDeal>;
    readonly listContacts: ReturnType<typeof createListContacts>;
  };
}

/**
 * Composition root (DIP): o unico lugar que conhece implementacoes concretas.
 */
const buildContainer = (): Container => {
  const conversations = new PrismaConversationRepository();
  const contacts = new PrismaContactRepository();
  const pipelines = new PrismaPipelineRepository();
  const aiAgents = new PrismaAiAgentRepository();
  const campaigns = new PrismaCampaignRepository();
  const settings = new PrismaSettingsRepository();

  return {
    session: new CookieSessionProvider(),
    conversations,
    contacts,
    pipelines,
    aiAgents,
    aiSandbox: new EchoAiAgentSandbox(),
    campaigns,
    analytics: new PrismaAnalyticsRepository(),
    notifications: new PrismaNotificationRepository(),
    settings,
    useCases: {
      listConversations: createListConversations(conversations),
      sendMessage: createSendMessage(conversations),
      changeConversationStatus: createChangeConversationStatus(conversations),
      assignConversation: createAssignConversation(conversations),
      moveConversationInbox: createMoveConversationInbox(conversations),
      changeConversationPriority: createChangeConversationPriority(conversations),
      setConversationLabels: createSetConversationLabels(conversations),
      sendTemplate: createSendTemplate(conversations),
      sendMedia: createSendMedia(conversations),
      moveDeal: createMoveDeal(pipelines),
      listContacts: createListContacts(contacts),
    },
  };
};

const globalRef = globalThis as typeof globalThis & { __solintContainer?: Container };

if (
  process.env.NODE_ENV !== 'production' ||
  (globalRef.__solintContainer &&
    typeof globalRef.__solintContainer.settings.createInbox !== 'function')
) {
  delete globalRef.__solintContainer;
}

export const container: Container =
  process.env.NODE_ENV === 'production'
    ? (globalRef.__solintContainer ??= buildContainer())
    : buildContainer();
