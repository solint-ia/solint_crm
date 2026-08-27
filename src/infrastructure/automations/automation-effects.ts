import type { Priority } from '@/core/domain/conversation';
import type { Id } from '@/core/domain/shared';
import type { AutomationEffects } from '@/core/use-cases/run-automations';
import { prisma } from '@/infrastructure/db/prisma';
import { dataCurtaLabel, horaLabel } from '@/lib/datetime';

/**
 * Os efeitos das automações, contra o Postgres.
 *
 * O motor fala em nomes ("Suporte N1", "VIP", "Proposta enviada") porque é
 * assim que o construtor de regras grava — ele oferece listas de nomes reais do
 * workspace, não ids. A tradução nome→id mora aqui: é detalhe de persistência,
 * e deixá-la no motor obrigaria o domínio a conhecer tabelas.
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

  async resolve(accountId: Id, conversationId: Id) {
    return prisma.conversation.updateMany({
      where: { id: conversationId, accountId },
      data: { status: 'resolvida', statusLabel: 'Resolvido' },
    });
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
      select: { id: true },
    });
    if (!conversation) throw new Error('Conversa não encontrada.');

    return prisma.message.create({
      data: {
        id: `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId,
        author: 'system',
        authorName: 'Automação',
        contentType: 'texto',
        content: { type: 'texto', text },
        time: horaLabel(new Date()),
        isPrivate: true,
        origin: 'automacao',
      },
    });
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
        kind: 'automacao',
        text: text ? `${text} — ${contato}` : `Automação disparada na conversa com ${contato}`,
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
  async moveDealToStage(accountId: Id, conversationId: Id, stageName: string) {
    const now = new Date();
    const hoje = dataCurtaLabel(now);
    const procuraPorNome = { equals: stageName, mode: 'insensitive' as const };

    const deal = await prisma.deal.findFirst({
      where: { accountId, conversationId },
      select: { id: true, pipelineId: true, history: true },
    });

    if (deal) {
      // Card existente muda de etapa dentro do **próprio** funil: procurar a
      // etapa pelo nome em toda a conta poderia mudar o card de quadro.
      const stage = await prisma.pipelineStage.findFirst({
        where: { pipelineId: deal.pipelineId, name: procuraPorNome },
        select: { id: true, name: true },
      });
      if (!stage) {
        throw new Error(`O funil desta oportunidade não tem etapa chamada "${stageName}".`);
      }

      const history = Array.isArray(deal.history) ? deal.history : [];
      return prisma.deal.update({
        where: { id: deal.id },
        data: {
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

    // Sem card, a etapa é procurada nos funis da conta. `orderBy` desempata de
    // forma estável quando dois funis têm etapa de mesmo nome — sem ele, o
    // card cairia num quadro diferente a cada disparo.
    const stage = await prisma.pipelineStage.findFirst({
      where: { name: procuraPorNome, pipeline: { accountId } },
      select: { id: true, name: true, pipelineId: true },
      orderBy: [{ pipeline: { name: 'asc' } }, { order: 'asc' }],
    });
    if (!stage) throw new Error(`Nenhum funil desta conta tem etapa chamada "${stageName}".`);

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
