import type { Priority } from '@/core/domain/conversation';
import type { Id } from '@/core/domain/shared';
import type { AutomationEffects } from '@/core/use-cases/run-automations';
import { prisma } from '@/infrastructure/db/prisma';
import { dataCurtaLabel, horaLabel } from '@/lib/datetime';

/**
 * Os efeitos das automações, contra o Postgres.
 *
 * Pessoas, equipes e etiquetas ainda chegam por nome. O destino do Kanban
 * chega por id, porque nomes de etapas se repetem entre funis; regras antigas
 * sem ids mantêm a resolução por nome para não mudar de comportamento.
 *
 * Nome que não casa com nada vira erro, e o motor registra a falha daquela ação
 * sem derrubar as outras. É melhor que o silêncio: uma regra apontando para uma
 * equipe renomeada precisa aparecer em algum lugar.
 */
export const prismaAutomationEffects: AutomationEffects = {
  async setPriority(accountId: Id, conversationId: Id, priority: Priority) {
    return prisma.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: { priority },
    });
  },

  async assignToAgent(accountId: Id, conversationId: Id, agentName: string) {
    const membership = await prisma.membership.findFirst({
      where: { accountId, user: { name: { equals: agentName, mode: 'insensitive' } } },
      select: { userId: true, user: { select: { name: true } } },
    });
    if (!membership) throw new Error(`Nenhum agente chamado "${agentName}" nesta conta.`);

    return prisma.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: { assigneeId: membership.userId, assigneeName: membership.user.name },
    });
  },

  /**
   * Atribuir a uma equipe é escolher alguém dentro dela.
   *
   * A conversa tem um responsável, não uma equipe — então "atribuir à equipe"
   * só pode significar entregar a um dos membros. Sem critério de carga aqui, a
   * escolha é estável (o primeiro por nome) em vez de aleatória: uma regra que
   * entrega para pessoa diferente a cada disparo seria impossível de depurar.
   */
  async assignToTeam(accountId: Id, conversationId: Id, teamName: string) {
    const team = await prisma.team.findFirst({
      where: { accountId, name: { equals: teamName, mode: 'insensitive' } },
      select: {
        teamMembers: {
          select: { userId: true, user: { select: { name: true } } },
        },
      },
    });
    if (!team) throw new Error(`Nenhuma equipe chamada "${teamName}" nesta conta.`);

    const membro = team.teamMembers
      .toSorted((a, b) => a.user.name.localeCompare(b.user.name))
      .at(0);
    if (!membro) throw new Error(`A equipe "${teamName}" não tem membros para receber a conversa.`);

    return prisma.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: { assigneeId: membro.userId, assigneeName: membro.user.name },
    });
  },

  async addLabel(accountId: Id, conversationId: Id, labelName: string) {
    const label = await prisma.label.findFirst({
      where: { accountId, name: { equals: labelName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!label) throw new Error(`Nenhuma etiqueta chamada "${labelName}" nesta conta.`);

    // `connect`, não `set`: a automação **acrescenta** uma etiqueta. `set`
    // apagaria as que o atendente aplicou à mão.
    return prisma.conversation.update({
      where: { id: conversationId, accountId },
      data: { labels: { connect: { id: label.id } } },
    });
  },

  /**
   * Resolve a conversa -- e faz o encerramento sair, como sairia pelo botão.
   *
   * A regra mudava o status direto no banco e parava aí. Para quem configurou
   * a mensagem de encerramento, o resultado era uma automação que fechava o
   * atendimento em silêncio: o texto estava ligado, aparecia na tela de
   * Configurações, e o cliente nunca o recebia.
   */
  async resolve(accountId: Id, conversationId: Id) {
    const agora = new Date();
    const atual = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: { createdAt: true, status: true },
    });

    const resultado = await prisma.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: {
        status: 'resolvida',
        statusLabel: 'Resolvido',
        resolvedAt: agora,
        resolutionSecs: atual
          ? Math.max(0, Math.round((agora.getTime() - atual.createdAt.getTime()) / 1000))
          : null,
      },
    });

    if (atual?.status !== 'resolvida') {
      const { runClosingAutoReply } = await import('@/infrastructure/whatsapp/inbox-auto-messages');
      await runClosingAutoReply(accountId, conversationId).catch((error) => {
        console.warn('[automacoes] Falha ao despachar o encerramento automático:', error);
      });
    }

    return resultado;
  },

  /**
   * Mensagem automática entra na timeline como nota do sistema.
   *
   * Despachá-la ao WhatsApp daqui exigiria o canal, e o motor roda em contextos
   * onde ele não está disponível (worker e servidor). Gravar a intenção é o
   * passo honesto: a mensagem aparece na conversa e não some, e o envio ao
   * canal fica explícito como pendência em vez de parecer entregue.
   */
  async sendMessage(accountId: Id, conversationId: Id, text: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: {
        id: true,
        inboxId: true,
        channel: true,
        channelThreadId: true,
        contact: { select: { phone: true, whatsappOptOutAt: true } },
      },
    });
    if (!conversation) throw new Error('Conversa não encontrada.');
    if (conversation.channel === 'whatsapp' && conversation.contact.whatsappOptOutAt) {
      return { suppressed: true, reason: 'whatsapp_opt_out' };
    }

    const { dispatchAutoMessage } = await import('@/infrastructure/whatsapp/auto-reply');
    const message = await dispatchAutoMessage({
      accountId,
      inboxId: conversation.inboxId,
      conversationId,
      recipient: {
        channelThreadId: conversation.channelThreadId,
        phone: conversation.contact?.phone ?? '',
      },
      text,
      origin: 'automacao',
      authorName: 'Automação',
    });

    if (!message) throw new Error('Mensagem vazia.');
    return message;
  },

  async notify(accountId: Id, conversationId: Id, text: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: { assigneeId: true, contact: { select: { name: true } } },
    });
    if (!conversation) throw new Error('Conversa não encontrada.');

    const contato = conversation.contact?.name ?? 'contato';

    return prisma.notification.create({
      data: {
        id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        accountId,
        // Sem responsável o aviso vale para a conta inteira (`userId` nulo), em
        // vez de falhar: uma conversa na fila geral é justamente a que mais
        // precisa que alguém seja avisado.
        userId: conversation.assigneeId,
        kind: 'sistema',
        text: text ? `${text} (${contato})` : `Automação disparada na conversa com ${contato}`,
        timeLabel: horaLabel(new Date()),
        href: `/conversas?conversa=${conversationId}`,
        read: false,
      },
    });
  },

  /**
   * Leva a conversa para uma etapa do funil, criando o card se ele não existir.
   *
   * Criar faz parte da ação, e não é conveniência: uma regra do tipo "etiqueta
   * Interessado → etapa Novo Lead" existe justamente para **colocar** a
   * conversa no funil. A primeira versão exigia card pré-existente e falhava
   * com "esta conversa não tem oportunidade" exatamente no caso que a regra foi
   * escrita para atender — a automação só funcionaria depois de alguém fazer à
   * mão o trabalho que ela deveria fazer.
   */
  async moveDealToStage(
    accountId: Id,
    conversationId: Id,
    target: { readonly pipelineId?: Id; readonly stageId?: Id; readonly stageName: string },
  ) {
    const now = new Date();
    const hoje = dataCurtaLabel(now);
    const procuraPorNome = { equals: target.stageName, mode: 'insensitive' as const };

    const deal = await prisma.deal.findFirst({
      where: { accountId, conversationId },
      select: { id: true, pipelineId: true, history: true },
    });

    const explicitTarget = target.pipelineId && target.stageId;
    const stage = explicitTarget
      ? await prisma.pipelineStage.findFirst({
          where: {
            id: target.stageId,
            pipelineId: target.pipelineId,
            pipeline: { accountId },
          },
          select: { id: true, name: true, pipelineId: true },
        })
      : deal
        ? await prisma.pipelineStage.findFirst({
            // Compatibilidade com regras antigas: o nome continua restrito ao
            // funil em que o card já está.
            where: { pipelineId: deal.pipelineId, name: procuraPorNome },
            select: { id: true, name: true, pipelineId: true },
          })
        : await prisma.pipelineStage.findFirst({
            // Regra antiga sem card: mantém o desempate estável anterior.
            where: { name: procuraPorNome, pipeline: { accountId } },
            select: { id: true, name: true, pipelineId: true },
            orderBy: [{ pipeline: { name: 'asc' } }, { order: 'asc' }],
          });

    if (!stage) {
      if (explicitTarget) throw new Error('O funil ou a etapa configurada não existe mais.');
      if (deal) {
        throw new Error(`O funil desta oportunidade não tem etapa chamada "${target.stageName}".`);
      }
      throw new Error(`Nenhum funil desta conta tem etapa chamada "${target.stageName}".`);
    }

    if (deal) {
      const history = Array.isArray(deal.history) ? deal.history : [];
      return prisma.deal.update({
        where: { id: deal.id },
        data: {
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          enteredStageAt: now.toISOString(),
          stageAgeLabel: 'hoje',
          history: [...history, { text: `Movido para ${stage.name} por automação`, date: hoje }],
        },
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: {
        contactId: true,
        priority: true,
        assigneeName: true,
        contact: { select: { name: true, company: true } },
      },
    });
    if (!conversation) throw new Error('Conversa não encontrada.');

    return prisma.deal.create({
      data: {
        id: `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        accountId,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        conversationId,
        contactId: conversation.contactId,
        contactName: conversation.contact?.name ?? 'Contato',
        company: conversation.contact?.company ?? null,
        amountInCents: 0,
        ownerName: conversation.assigneeName ?? 'Não atribuído',
        priority: conversation.priority,
        nextAction: 'Entrar em contato para qualificação',
        enteredStageAt: now.toISOString(),
        stageAgeLabel: 'hoje',
        history: [{ text: `Oportunidade criada por automação em ${stage.name}`, date: hoje }],
      },
    });
  },
};
