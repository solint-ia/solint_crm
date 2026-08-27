import type { AgentFlowBlock, AiAgent } from '@/core/domain/ai-agent';
import type { AppNotification } from '@/core/domain/notification';
import type { Deal, Pipeline, PipelineStage } from '@/core/domain/pipeline';
import { DomainError, NotFoundError, type Id } from '@/core/domain/shared';
import type { AiAgentRepository, CreateAiAgentDraft } from '@/core/ports/ai-agent-repository';
import type { NotificationRepository } from '@/core/ports/notification-repository';
import type { PipelineRepository } from '@/core/ports/pipeline-repository';
import { prisma, readJson, asJson } from '@/infrastructure/db/prisma';
import { aiAgentRow, dealRow, notificationRow, pipelineRow } from './mappers';
import { dataCurtaLabel } from '@/lib/datetime';

export class PrismaPipelineRepository implements PipelineRepository {
  async listPipelines(accountId: Id): Promise<readonly Pipeline[]> {
    let rows = await prisma.pipeline.findMany({
      where: { accountId },
      include: { stages: true },
      orderBy: { name: 'asc' },
    });

    if (rows.length === 0) {
      const pipelineId = `pip-${accountId}`;
      await prisma.pipeline.create({
        data: {
          id: pipelineId,
          accountId,
          name: 'Funil Comercial',
          isDefault: true,
          stages: {
            create: [
              { id: `stg-1-${accountId}`, name: 'Novo Lead', order: 1, color: '#3B82F6' },
              { id: `stg-2-${accountId}`, name: 'Qualificação', order: 2, color: '#F59E0B' },
              { id: `stg-3-${accountId}`, name: 'Proposta Enviada', order: 3, color: '#8B5CF6' },
              { id: `stg-4-${accountId}`, name: 'Negociação', order: 4, color: '#EC4899' },
              { id: `stg-5-${accountId}`, name: 'Fechado Ganho', order: 5, color: '#10B981', isWon: true },
              { id: `stg-6-${accountId}`, name: 'Fechado Perdido', order: 6, color: '#64748B', isLost: true },
            ],
          },
        },
      });

      rows = await prisma.pipeline.findMany({
        where: { accountId },
        include: { stages: true },
        orderBy: { name: 'asc' },
      });
    } else if (rows.some((r) => r.stages.length === 0)) {
      for (const row of rows) {
        if (row.stages.length === 0) {
          await prisma.pipelineStage.createMany({
            data: [
              { id: `stg-1-${row.id}`, pipelineId: row.id, name: 'Novo Lead', order: 1, color: '#3B82F6' },
              { id: `stg-2-${row.id}`, pipelineId: row.id, name: 'Qualificação', order: 2, color: '#F59E0B' },
              { id: `stg-3-${row.id}`, pipelineId: row.id, name: 'Proposta Enviada', order: 3, color: '#8B5CF6' },
              { id: `stg-4-${row.id}`, pipelineId: row.id, name: 'Negociação', order: 4, color: '#EC4899' },
              { id: `stg-5-${row.id}`, pipelineId: row.id, name: 'Fechado Ganho', order: 5, color: '#10B981', isWon: true },
              { id: `stg-6-${row.id}`, pipelineId: row.id, name: 'Fechado Perdido', order: 6, color: '#64748B', isLost: true },
            ],
          });
        }
      }

      rows = await prisma.pipeline.findMany({
        where: { accountId },
        include: { stages: true },
        orderBy: { name: 'asc' },
      });
    }

    return rows.map(pipelineRow);
  }

  async listDeals(accountId: Id, pipelineId: Id): Promise<readonly Deal[]> {
    const rows = await prisma.deal.findMany({
      where: { accountId, pipelineId },
      // O painel de detalhe mostra o checklist e é aberto a partir desta lista;
      // buscá-lo à parte por card seria uma consulta por clique.
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map(dealRow);
  }

  async addDealTask(accountId: Id, dealId: Id, title: string): Promise<Deal> {
    await this.assertDeal(accountId, dealId);
    await prisma.task.create({ data: { accountId, dealId, title } });
    return this.dealWithTasks(accountId, dealId);
  }

  async toggleDealTask(accountId: Id, dealId: Id, taskId: Id): Promise<Deal> {
    await this.assertDeal(accountId, dealId);

    const task = await prisma.task.findFirst({
      where: { id: taskId, dealId, accountId },
      select: { id: true, completed: true },
    });
    if (!task) throw new NotFoundError('Tarefa', taskId);

    const completed = !task.completed;
    await prisma.task.update({
      where: { id: taskId },
      // `completedAt` acompanha o estado em vez de só marcar a ida: desmarcar
      // uma tarefa que voltou a ser pendente precisa limpar a data, senão o
      // relatório contaria como concluída algo que está aberto.
      data: { completed, completedAt: completed ? new Date() : null },
    });

    return this.dealWithTasks(accountId, dealId);
  }

  async deleteDealTask(accountId: Id, dealId: Id, taskId: Id): Promise<Deal> {
    await this.assertDeal(accountId, dealId);
    const { count } = await prisma.task.deleteMany({ where: { id: taskId, dealId, accountId } });
    if (count === 0) throw new NotFoundError('Tarefa', taskId);
    return this.dealWithTasks(accountId, dealId);
  }

  private async assertDeal(accountId: Id, dealId: Id) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, accountId },
      select: { id: true },
    });
    if (!deal) throw new NotFoundError('Oportunidade', dealId);
    return deal;
  }

  private async dealWithTasks(accountId: Id, dealId: Id): Promise<Deal> {
    const row = await prisma.deal.findFirstOrThrow({
      where: { id: dealId, accountId },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });
    return dealRow(row);
  }

  /**
   * Move o card de etapa.
   *
   * A etapa de destino é conferida contra o **mesmo funil** do card: sem isso,
   * um id de etapa de outro funil moveria o card para fora do quadro em que ele
   * vive, e ele sumiria da tela sem erro nenhum.
   */
  async moveDeal(accountId: Id, dealId: Id, targetStageId: Id): Promise<Deal> {
    const deal = await prisma.deal.findFirst({ where: { id: dealId, accountId } });
    if (!deal) throw new NotFoundError('Oportunidade', dealId);

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: targetStageId, pipelineId: deal.pipelineId },
    });
    if (!stage) throw new DomainError('Etapa inválida para este funil.', 'INVALID_STAGE');

    const now = new Date();
    const row = await prisma.deal.update({
      where: { id: dealId, accountId },
      data: {
        stageId: targetStageId,
        enteredStageAt: now.toISOString(),
        stageAgeLabel: 'hoje',
        history: asJson([
          ...readJson<Deal['history']>(deal.history, []),
          {
            text: `Movido para ${stage.name}`,
            date: dataCurtaLabel(now),
          },
        ]),
      },
    });
    return dealRow(row);
  }

  async createDeal(
    accountId: Id,
    draft: {
      pipelineId: Id;
      stageId: Id;
      title: string;
      value: number;
      contactName?: string;
      companyName?: string;
      ownerName?: string;
      priority?: string;
      probability?: number;
      source?: string;
      nextAction?: string;
    },
  ): Promise<Deal> {
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: draft.stageId, pipelineId: draft.pipelineId },
    });
    if (!stage) throw new DomainError('Etapa inválida para este funil.', 'INVALID_STAGE');

    const now = new Date();
    const row = await prisma.deal.create({
      data: {
        id: `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        accountId,
        pipelineId: draft.pipelineId,
        stageId: draft.stageId,
        contactName: draft.contactName ?? draft.title,
        company: draft.companyName ?? null,
        amountInCents: draft.value,
        ownerName: draft.ownerName ?? 'Não atribuído',
        priority: draft.priority ?? 'media',
        nextAction: draft.nextAction ?? 'Entrar em contato para qualificação',
        enteredStageAt: now.toISOString(),
        stageAgeLabel: 'hoje',
        history: asJson([
          {
            text: `Oportunidade criada: ${draft.title} em ${stage.name}`,
            date: dataCurtaLabel(now),
          },
        ]),
      },
    });
    return dealRow(row);
  }

  async updateDeal(
    accountId: Id,
    dealId: Id,
    patch: {
      title?: string;
      value?: number;
      stageId?: string;
      contactName?: string;
      companyName?: string;
      ownerName?: string;
      priority?: string;
      probability?: number;
      source?: string;
      nextAction?: string;
    },
  ): Promise<Deal> {
    const deal = await prisma.deal.findFirst({ where: { id: dealId, accountId } });
    if (!deal) throw new NotFoundError('Oportunidade', dealId);

    const data: Record<string, unknown> = {};
    if (patch.value !== undefined) data.amountInCents = patch.value;
    if (patch.contactName !== undefined) data.contactName = patch.contactName;
    if (patch.companyName !== undefined) data.company = patch.companyName;
    if (patch.ownerName !== undefined) data.ownerName = patch.ownerName;
    if (patch.priority !== undefined) data.priority = patch.priority;
    if (patch.nextAction !== undefined) data.nextAction = patch.nextAction;
    if (patch.stageId && patch.stageId !== deal.stageId) {
      data.stageId = patch.stageId;
      data.enteredStageAt = new Date().toISOString();
      data.stageAgeLabel = 'hoje';
    }

    const row = await prisma.deal.update({
      where: { id: dealId, accountId },
      data,
    });
    return dealRow(row);
  }

  async deleteDeal(accountId: Id, dealId: Id): Promise<void> {
    const exists = await prisma.deal.findFirst({
      where: { id: dealId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Oportunidade', dealId);
    await prisma.deal.delete({ where: { id: dealId, accountId } });
  }

  async deleteDealsOfContact(accountId: Id, contactId: Id): Promise<number> {
    // Sem `assertDeal`: um contato que não tem card nenhum não é erro, é o
    // caso comum de quem nunca entrou no funil.
    const { count } = await prisma.deal.deleteMany({ where: { accountId, contactId } });
    return count;
  }

  async updateStages(
    accountId: Id,
    pipelineId: Id,
    stages: readonly {
      id?: string;
      name: string;
      order: number;
      color: string;
      isWon: boolean;
      isLost: boolean;
      defaultProbability?: number;
      labelId?: string | null;
    }[],
  ): Promise<readonly PipelineStage[]> {
    const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, accountId } });
    if (!pipeline) throw new NotFoundError('Funil', pipelineId);

    /**
     * Etiqueta escolhida precisa ser da conta.
     *
     * O id vem de um `<select>`, e um `<select>` é uma sugestão do servidor que
     * o cliente pode ignorar. Sem esta conferência, um id de outra conta
     * entraria na coluna e passaria a decidir quais contatos entram e saem
     * deste funil — a etiqueta de um workspace governando o quadro de outro.
     */
    const pedidas = stages
      .map((stage) => stage.labelId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (pedidas.length > 0) {
      const validas = await prisma.label.findMany({
        where: { accountId, id: { in: pedidas } },
        select: { id: true },
      });
      const conhecidas = new Set(validas.map((label) => label.id));
      const intrusa = pedidas.find((id) => !conhecidas.has(id));
      if (intrusa) throw new NotFoundError('Etiqueta', intrusa);
    }

    // Upsert or create stages
    const result: PipelineStage[] = [];
    for (const [index, st] of stages.entries()) {
      const stageId = st.id ?? `st-${Date.now().toString(36)}-${index}`;
      const updated = await prisma.pipelineStage.upsert({
        where: { id: stageId },
        create: {
          id: stageId,
          pipelineId,
          name: st.name,
          order: st.order ?? index + 1,
          color: st.color,
          isWon: st.isWon ?? false,
          isLost: st.isLost ?? false,
          labelId: st.labelId ?? null,
        },
        update: {
          name: st.name,
          order: st.order ?? index + 1,
          color: st.color,
          isWon: st.isWon ?? false,
          isLost: st.isLost ?? false,
          // `undefined` mantém o vínculo; `null` o desfaz. Quem manda o campo
          // ausente não está pedindo para desassociar a etiqueta.
          ...(st.labelId === undefined ? {} : { labelId: st.labelId }),
        },
      });
      result.push({
        id: updated.id,
        pipelineId: updated.pipelineId,
        name: updated.name,
        order: updated.order,
        color: updated.color,
        isWon: updated.isWon,
        isLost: updated.isLost,
        defaultProbability: st.defaultProbability,
        ...(updated.labelId ? { labelId: updated.labelId } : {}),
      });
    }

    return result;
  }
}


export class PrismaAiAgentRepository implements AiAgentRepository {
  async list(accountId: Id): Promise<readonly AiAgent[]> {
    const rows = await prisma.aiAgent.findMany({ where: { accountId }, orderBy: { name: 'asc' } });
    return rows.map(aiAgentRow);
  }

  async findById(accountId: Id, agentId: Id): Promise<AiAgent | null> {
    const row = await prisma.aiAgent.findFirst({ where: { id: agentId, accountId } });
    return row ? aiAgentRow(row) : null;
  }

  async create(accountId: Id, draft: CreateAiAgentDraft): Promise<AiAgent> {
    const id = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const defaultFlow: AgentFlowBlock[] = [
      {
        id: 'blk-start',
        type: 'inicio',
        title: 'Início do atendimento',
        branches: [{ label: 'Próximo', targetId: 'blk-msg' }],
      },
      {
        id: 'blk-msg',
        type: 'mensagem',
        title: 'Boas-vindas',
        detail: 'Olá! Sou o assistente virtual da Solint. Como posso te ajudar hoje?',
        branches: [{ label: 'Encerrar', targetId: 'blk-end' }],
      },
      {
        id: 'blk-end',
        type: 'encerrar',
        title: 'Fim do atendimento',
        branches: [],
      },
    ];

    const row = await prisma.aiAgent.create({
      data: {
        id,
        accountId,
        name: draft.name,
        scope: draft.scope,
        active: false,
        persona: draft.persona,
        systemPrompt:
          draft.systemPrompt ||
          `Você é ${draft.name}, assistente virtual da empresa. Responda de forma prestativa, concisa e precisa aos clientes.`,
        model: draft.model || 'gemini-1.5-flash',
        handledCount: 0,
        transferRate: '0%',
        knowledgeBase: asJson([]),
        transferRules: asJson([
          {
            id: 'rule-explicit',
            type: 'solicitacao_explicita',
            condition: 'Cliente pede para falar com um atendente humano',
            enabled: true,
          },
        ]),
        flow: asJson(defaultFlow),
        logs: asJson([]),
      },
    });

    return aiAgentRow(row);
  }

  async setActive(accountId: Id, agentId: Id, active: boolean): Promise<AiAgent> {
    await this.assertExists(accountId, agentId);
    return aiAgentRow(
      await prisma.aiAgent.update({ where: { id: agentId, accountId }, data: { active } }),
    );
  }

  async toggleTransferRule(accountId: Id, agentId: Id, ruleId: Id): Promise<AiAgent> {
    const current = await this.assertExists(accountId, agentId);
    const rules = readJson<AiAgent['transferRules']>(current.transferRules, []);

    return aiAgentRow(
      await prisma.aiAgent.update({
        where: { id: agentId, accountId },
        data: {
          transferRules: asJson(
            rules.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)),
          ),
        },
      }),
    );
  }

  async saveFlow(accountId: Id, agentId: Id, flow: readonly AgentFlowBlock[]): Promise<AiAgent> {
    await this.assertExists(accountId, agentId);
    return aiAgentRow(
      await prisma.aiAgent.update({
        where: { id: agentId, accountId },
        data: { flow: asJson(flow) },
      }),
    );
  }

  private async assertExists(accountId: Id, agentId: Id) {
    const row = await prisma.aiAgent.findFirst({ where: { id: agentId, accountId } });
    if (!row) throw new NotFoundError('Agente de IA', agentId);
    return row;
  }
}

export class PrismaNotificationRepository implements NotificationRepository {
  /** Avisos do usuário mais os da conta inteira (`userId` nulo). */
  async list(accountId: Id, userId: Id): Promise<readonly AppNotification[]> {
    const rows = await prisma.notification.findMany({
      where: { accountId, OR: [{ userId }, { userId: null }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(notificationRow);
  }

  async markAllAsRead(accountId: Id, userId: Id): Promise<void> {
    await prisma.notification.updateMany({
      where: { accountId, OR: [{ userId }, { userId: null }], read: false },
      data: { read: true },
    });
  }
}
