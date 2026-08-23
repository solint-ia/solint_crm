import 'server-only';

import type { AgentFlowBlock, AiAgent } from '@/core/domain/ai-agent';
import type { AppNotification } from '@/core/domain/notification';
import type { Deal, Pipeline } from '@/core/domain/pipeline';
import { DomainError, NotFoundError, type Id } from '@/core/domain/shared';
import type { AiAgentRepository } from '@/core/ports/ai-agent-repository';
import type { NotificationRepository } from '@/core/ports/notification-repository';
import type { PipelineRepository } from '@/core/ports/pipeline-repository';
import { prisma, fromJson, toJson } from '@/infrastructure/db/prisma';
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
      where: { id: dealId },
      data: {
        stageId: targetStageId,
        enteredStageAt: now.toISOString(),
        stageAgeLabel: 'hoje',
        historyJson: toJson([
          ...fromJson<Deal['history']>(deal.historyJson, []),
          {
            text: `Movido para ${stage.name}`,
            date: now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
          },
        ]),
      },
    });
    return dealRow(row);
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
    return aiAgentRow(await prisma.aiAgent.update({ where: { id: agentId }, data: { active } }));
  }

  async toggleTransferRule(accountId: Id, agentId: Id, ruleId: Id): Promise<AiAgent> {
    const current = await this.assertExists(accountId, agentId);
    const rules = fromJson<AiAgent['transferRules']>(current.transferRulesJson, []);

    return aiAgentRow(
      await prisma.aiAgent.update({
        where: { id: agentId },
        data: {
          transferRulesJson: toJson(
            rules.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)),
          ),
        },
      }),
    );
  }

  async saveFlow(accountId: Id, agentId: Id, flow: readonly AgentFlowBlock[]): Promise<AiAgent> {
    await this.assertExists(accountId, agentId);
    return aiAgentRow(
      await prisma.aiAgent.update({ where: { id: agentId }, data: { flowJson: toJson(flow) } }),
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
