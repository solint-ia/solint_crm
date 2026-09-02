import type { NotificationKind } from '@/core/domain/notification';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@/core/domain/user';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { horaLabel } from '@/lib/datetime';

/**
 * O produtor de avisos que faltava.
 *
 * O sistema de notificações tinha tabela, tipos, repositório de leitura,
 * sininho, barramento de tempo real e uma tela de preferências — e **nenhuma
 * escrita**. Os avisos que apareciam vinham do `seed`, um de cada tipo, e uma
 * conta criada pelo cadastro nascia com o sininho vazio para sempre.
 *
 * Tudo que grava aviso passa por aqui, para que três coisas valham sempre e não
 * dependam de quem chamou lembrar delas: a preferência da pessoa é respeitada,
 * o sininho acende sem recarregar, e uma falha ao avisar nunca derruba a ação
 * que gerou o aviso.
 */

/** Qual preferência governa cada tipo de aviso. `null` = sempre avisa. */
const PREFERENCIA_DE: Readonly<Record<NotificationKind, keyof NotificationPreferences | null>> = {
  atribuicao: 'assigned',
  mencao: 'mentions',
  sla: 'sla',
  sistema: null,
  mensagem: null,
};

export interface CreateNotificationInput {
  readonly accountId: string;
  /** Nulo = aviso da conta inteira, visível para todos os agentes. */
  readonly userId?: string | null;
  readonly kind: NotificationKind;
  readonly text: string;
  readonly href?: string;
  /**
   * A conversa a que o aviso se refere, e a caixa dela.
   *
   * As duas viajam no evento porque a rota de SSE recorta por caixa: sem
   * `inboxId` ela recusa o evento, que é o comportamento correto — deixar
   * passar o que não se sabe identificar seria escolher o vazamento em vez do
   * evento perdido.
   */
  readonly conversationId: string;
  readonly inboxId: string;
  /**
   * Consultar a preferência do destinatário antes de gravar.
   *
   * Verdadeiro por padrão. Um aviso de sistema ("sua conexão caiu") não é
   * opcional e passa com `false`.
   */
  readonly respeitarPreferencia?: boolean;
}

const permitido = async (
  userId: string | null | undefined,
  kind: NotificationKind,
): Promise<boolean> => {
  const chave = PREFERENCIA_DE[kind];
  // Sem preferência associada, ou sem destinatário definido (aviso da conta
  // inteira), não há o que consultar.
  if (!chave || !userId) return true;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  if (!user) return false;

  // O `merge` com o padrão é o que impede uma preferência nova de significar
  // "desligado" para toda a base: a coluna nasce nula para quem já existia.
  const prefs = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...readJson<Partial<NotificationPreferences>>(user.notificationPrefs, {}),
  };
  return Boolean(prefs[chave]);
};

/**
 * Grava o aviso e o anuncia. Nunca lança.
 *
 * Devolve `true` quando o aviso foi de fato criado, para quem chamou poder
 * registrar isso — e `false` tanto para "a pessoa desligou" quanto para
 * "falhou", porque do ponto de vista de quem chamou os dois significam a mesma
 * coisa: não avisamos, e a ação principal continua valendo.
 */
export const createNotification = async (input: CreateNotificationInput): Promise<boolean> => {
  try {
    if (input.respeitarPreferencia !== false && !(await permitido(input.userId, input.kind))) {
      return false;
    }

    const agora = new Date();
    const criada = await prisma.notification.create({
      data: {
        id: `ntf-${agora.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        accountId: input.accountId,
        userId: input.userId ?? null,
        kind: input.kind,
        text: input.text,
        timeLabel: horaLabel(agora),
        href: input.href ?? null,
        read: false,
      },
    });

    // O sininho é remontado a cada navegação e lê a lista do servidor; sem o
    // evento, o aviso só apareceria no próximo carregamento de página.
    try {
      const { waEventBus } = await import('@/infrastructure/whatsapp/whatsapp-events');
      waEventBus.emitConversation({
        type: 'notification',
        accountId: input.accountId,
        conversationId: input.conversationId,
        inboxId: input.inboxId,
        notificationId: criada.id,
        ...(input.userId ? { userId: input.userId } : {}),
        notification: {
          id: criada.id,
          accountId: input.accountId,
          kind: input.kind,
          text: input.text,
          timeLabel: criada.timeLabel,
          read: false,
          ...(input.href ? { href: input.href } : {}),
        },
      });
    } catch (error) {
      // O aviso está gravado: ele aparece no próximo carregamento. Falhar aqui
      // não vale desfazer a gravação.
      console.warn('[notificacoes] Falha ao anunciar o aviso em tempo real:', error);
    }

    return true;
  } catch (error) {
    console.warn('[notificacoes] Falha ao criar o aviso:', error);
    return false;
  }
};
