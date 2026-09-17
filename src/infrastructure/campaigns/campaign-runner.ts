import { randomUUID } from 'node:crypto';

import { renderTemplate } from '@/core/domain/campaign';
import type { Message } from '@/core/domain/message';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { PrismaContactRepository } from '@/infrastructure/repositories/prisma/contact-repository';
import { PrismaConversationRepository } from '@/infrastructure/repositories/prisma/conversation-repository';
import {
  acquireBackgroundLease,
  releaseBackgroundLease,
  renewBackgroundLease,
  type BackgroundLeaseHandle,
} from '@/infrastructure/scheduling/background-lease';
import {
  announceCloudSent,
  handleCloudSendError,
  requireCloudConnection,
} from '@/infrastructure/whatsapp/cloud/cloud-channel';
import { sendCloudTemplate } from '@/infrastructure/whatsapp/cloud/cloud-sender';
import { CloudApiError } from '@/infrastructure/whatsapp/cloud/graph-client';
import { openOutboundConversation } from '@/infrastructure/whatsapp/wa-store';
import { waEventBus } from '@/infrastructure/whatsapp/whatsapp-events';

/**
 * O executor das campanhas.
 *
 * Mesmo desenho dos outros varredores com relógio: um lease global para não
 * haver dois processos disparando a mesma fila, uma rodada curta a cada poucos
 * segundos, e cada rodada manda só o que o ritmo da campanha permite.
 *
 * O envio é direto pela API oficial, sem worker de QR: campanha só existe em
 * caixa oficial. Cada destinatário vira uma conversa (a mesma que o cliente
 * usará para responder) com o template gravado nela, igual ao envio manual
 * pelo banner de janela fechada.
 */

const POLL_MS = 5_000;
const LEASE_MS = 60_000;
/** Teto por rodada, mesmo que o ritmo permita mais: uma rodada não pode virar um lote infinito. */
const MAX_POR_RODADA = 50;

/** Erros da Meta que são da caixa, e não do destinatário: param a campanha. */
const PARA_A_CAMPANHA = new Set([190, 131031, 131042, 368, 133010, 131045]);

const jaAtivo = globalThis as typeof globalThis & { __solintCampaignRunner?: true };

// Repositórios direto, e não o `container`: ele carrega a sessão por cookie do
// Next, que não existe no worker.
const contacts = new PrismaContactRepository();
const conversations = new PrismaConversationRepository();

export class CampaignRunner {
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  private readonly owner: string;

  constructor(owner = `campaigns-${randomUUID()}`) {
    this.owner = owner;
  }

  start(): void {
    if (this.timer || jaAtivo.__solintCampaignRunner) return;
    jaAtivo.__solintCampaignRunner = true;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
    void this.tick();
    console.log('[Campanhas] Executor de campanhas ativo.');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    delete jaAtivo.__solintCampaignRunner;
    const deadline = Date.now() + 30_000;
    while (this.rodando && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async tick(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    let lease: BackgroundLeaseHandle | null = null;
    let renew: NodeJS.Timeout | null = null;
    try {
      lease = await acquireBackgroundLease('campaigns', this.owner, LEASE_MS);
      if (!lease) return;
      const ownedLease = lease;
      renew = setInterval(
        () => void renewBackgroundLease(ownedLease).catch(() => undefined),
        20_000,
      );
      renew.unref?.();

      // Agendada cuja hora chegou começa agora.
      await prisma.campaign.updateMany({
        where: { status: 'agendada', scheduledAt: { lte: new Date() } },
        data: { status: 'em_andamento', startedAt: new Date() },
      });

      const ativas = await prisma.campaign.findMany({
        where: { status: 'em_andamento' },
        select: {
          id: true,
          accountId: true,
          inboxId: true,
          name: true,
          rateLimit: true,
          template: { select: { name: true, language: true, body: true, status: true } },
        },
        orderBy: { startedAt: 'asc' },
        take: 20,
      });

      for (const campanha of ativas) {
        await this.processar(campanha).catch((error) => {
          console.warn(`[Campanhas] Campanha ${campanha.id} falhou na rodada:`, error);
        });
      }
    } catch (error) {
      console.warn('[Campanhas] Falha ao varrer campanhas:', error);
    } finally {
      if (renew) clearInterval(renew);
      if (lease) await releaseBackgroundLease(lease).catch(() => undefined);
      this.rodando = false;
    }
  }

  private async processar(campanha: {
    readonly id: string;
    readonly accountId: string;
    readonly inboxId: string;
    readonly name: string;
    readonly rateLimit: number;
    readonly template: {
      readonly name: string;
      readonly language: string;
      readonly body: string;
      readonly status: string;
    } | null;
  }): Promise<void> {
    if (!campanha.template || campanha.template.status !== 'approved') {
      await this.parar(campanha.id, 'O template foi removido ou deixou de estar aprovado.');
      return;
    }

    // Ritmo: N por minuto vira N * (POLL_MS / 60 s) por rodada, no mínimo 1.
    const porRodada = Math.min(
      MAX_POR_RODADA,
      Math.max(1, Math.ceil((campanha.rateLimit * POLL_MS) / 60_000)),
    );

    const fila = await prisma.campaignRecipient.findMany({
      where: { campaignId: campanha.id, status: 'queued' },
      orderBy: { id: 'asc' },
      take: porRodada,
      select: { id: true, contactId: true, phone: true, name: true, variables: true },
    });

    if (fila.length === 0) {
      const restantes = await prisma.campaignRecipient.count({
        where: { campaignId: campanha.id, status: { in: ['queued', 'sending'] } },
      });
      if (restantes === 0) {
        await prisma.campaign.updateMany({
          where: { id: campanha.id, status: 'em_andamento' },
          data: { status: 'concluida', completedAt: new Date() },
        });
      }
      return;
    }

    let conn;
    try {
      conn = await requireCloudConnection(campanha.inboxId);
    } catch (error) {
      await this.parar(
        campanha.id,
        error instanceof Error ? error.message : 'A caixa não está conectada pela API oficial.',
      );
      return;
    }

    for (const destinatario of fila) {
      // Reivindica a linha: se outra rodada (ou outro processo entre leases)
      // já a pegou, `count` é 0 e nada é enviado duas vezes.
      const { count } = await prisma.campaignRecipient.updateMany({
        where: { id: destinatario.id, status: 'queued' },
        data: { status: 'sending' },
      });
      if (count !== 1) continue;

      const contato = destinatario.contactId
        ? await contacts.findById(campanha.accountId, destinatario.contactId)
        : null;
      if (!contato || !contato.phone) {
        await this.falhar(destinatario.id, 'Contato removido ou sem telefone.');
        continue;
      }
      if (contato.whatsappOptOutAt) {
        await this.falhar(destinatario.id, 'O contato pediu para não receber mensagens.');
        continue;
      }

      const values = readJson<string[]>(destinatario.variables, []);
      const texto = renderTemplate(campanha.template.body, values);

      let conversationId: string;
      let message: Message;
      try {
        const aberta = await openOutboundConversation({
          accountId: campanha.accountId,
          inboxId: campanha.inboxId,
          contact: contato,
          recipientPhone: destinatario.phone,
        });
        conversationId = aberta.id;
        message = await conversations.appendRichMessage(
          campanha.accountId,
          conversationId,
          {
            id: `msg-cmp-${destinatario.id}`,
            conversationId,
            author: 'agent',
            authorName: `Campanha · ${campanha.name}`,
            origin: 'crm',
            content: { type: 'template', templateName: campanha.template.name, text: texto },
            time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            isPrivate: false,
            deliveryStatus: 'enviando',
          },
          `campanha:${campanha.id}`,
        );
      } catch (error) {
        await this.falhar(
          destinatario.id,
          error instanceof Error ? error.message : 'Não foi possível abrir a conversa.',
        );
        continue;
      }

      try {
        const wamid = await sendCloudTemplate(
          conn,
          { phone: destinatario.phone },
          {
            name: campanha.template.name,
            language: campanha.template.language,
            bodyValues: values,
          },
        );
        await conversations.attachExternalId(campanha.accountId, conversationId, message.id, wamid);
        await prisma.campaignRecipient.updateMany({
          where: { id: destinatario.id },
          data: {
            status: 'sent',
            externalId: wamid,
            conversationId,
            sentAt: new Date(),
            error: null,
          },
        });
        waEventBus.emitConversation({
          type: 'new_message',
          accountId: campanha.accountId,
          conversationId,
          messageId: message.id,
          message: { ...message, externalId: wamid, deliveryStatus: 'enviado' },
        });
        await announceCloudSent(conn, message.id, wamid);
      } catch (error) {
        const mensagem = await handleCloudSendError(campanha.inboxId, error);
        await prisma.message.updateMany({
          where: { id: message.id, conversationId },
          data: { deliveryStatus: 'falha', dispatchError: mensagem },
        });
        await this.falhar(destinatario.id, mensagem, conversationId);

        // Erro da caixa (token, bloqueio, pagamento): parar a campanha inteira
        // é melhor que marcar centenas de destinatários com o mesmo erro.
        if (error instanceof CloudApiError && error.code && PARA_A_CAMPANHA.has(error.code)) {
          await this.parar(campanha.id, mensagem);
          return;
        }
        // Rajada: devolve o resto da rodada para a próxima, sem marcar nada.
        if (error instanceof CloudApiError && error.retentavel) return;
      }
    }
  }

  private async falhar(id: string, error: string, conversationId?: string): Promise<void> {
    await prisma.campaignRecipient.updateMany({
      where: { id },
      data: {
        status: 'failed',
        error: error.slice(0, 500),
        ...(conversationId ? { conversationId } : {}),
      },
    });
  }

  private async parar(campaignId: string, motivo: string): Promise<void> {
    await prisma.campaign.updateMany({
      where: { id: campaignId, status: 'em_andamento' },
      data: { status: 'pausada', lastError: motivo.slice(0, 500) },
    });
    // O que estava a caminho volta para a fila: ninguém foi enviado.
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, status: 'sending' },
      data: { status: 'queued' },
    });
  }
}

/** Recibo da Meta sobre uma mensagem de campanha. */
export const applyCampaignReceipt = async (
  externalId: string,
  status: 'entregue' | 'lido' | 'falha',
  error?: string,
): Promise<void> => {
  const agora = new Date();
  if (status === 'falha') {
    await prisma.campaignRecipient.updateMany({
      where: { externalId, status: { in: ['sent', 'delivered'] } },
      data: { status: 'failed', error: (error ?? 'A Meta não entregou.').slice(0, 500) },
    });
    return;
  }
  if (status === 'entregue') {
    await prisma.campaignRecipient.updateMany({
      where: { externalId, status: 'sent' },
      data: { status: 'delivered', deliveredAt: agora },
    });
    return;
  }
  await prisma.campaignRecipient.updateMany({
    where: { externalId, status: { in: ['sent', 'delivered'] } },
    data: { status: 'read', readAt: agora, deliveredAt: agora },
  });
};

/**
 * O contato respondeu: marca os envios recentes de campanha para ele.
 *
 * Sete dias é a janela em que uma resposta ainda é resposta ao disparo, e não
 * uma conversa nova por outro motivo.
 */
export const applyCampaignReply = async (inboxId: string, phone: string): Promise<void> => {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return;
  await prisma.campaignRecipient.updateMany({
    where: {
      phone: { in: [phone, `+${digits}`, digits] },
      status: { in: ['sent', 'delivered', 'read'] },
      sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
      campaign: { inboxId },
    },
    data: { status: 'replied', repliedAt: new Date() },
  });
};
