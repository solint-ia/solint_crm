import type { AgentFlowBlock, AiAgent } from '@/core/domain/ai-agent';
import type { AppNotification } from '@/core/domain/notification';
import type { Deal, Pipeline } from '@/core/domain/pipeline';
import { DomainError, NotFoundError, type Id } from '@/core/domain/shared';
import type { AiAgentRepository } from '@/core/ports/ai-agent-repository';
import type { NotificationRepository } from '@/core/ports/notification-repository';
import type { PipelineRepository } from '@/core/ports/pipeline-repository';
import { prisma, readJson, asJson } from '@/infrastructure/db/prisma';
import { aiAgentRow, dealRow, notificationRow, pipelineRow } from './mappers';

export class PrismaPipelineRepository implements PipelineRepository {
  async listPipelines(accountId: Id): Promise<readonly Pipeline[]> {
    const rows = await prisma.pipeline.findMany({
      where: { accountId },
      include: { stages: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(pipelineRow);
  }

  async listDeals(accountId: Id, pipelineId: Id): Promise<readonly Deal[]> {
    const rows = await prisma.deal.findMany({ where: { accountId, pipelineId } });
    return rows.map(dealRow);
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
            date: now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
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
      probability?: number;
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
        priority: 'media',
        nextAction: 'Entrar em contato para qualificação',
        enteredStageAt: now.toISOString(),
        stageAgeLabel: 'hoje',
        history: asJson([
          {
            text: `Oportunidade criada: ${draft.title} em ${stage.name}`,
            date: now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
          },
        ]),
      },
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
