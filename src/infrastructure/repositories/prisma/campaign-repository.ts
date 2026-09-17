import type {
  Campaign,
  CampaignAudience,
  CampaignAudienceOption,
  CampaignInbox,
  CampaignMetrics,
  CampaignRecipient,
  CampaignRecipientStatus,
  CampaignStatus,
  CampaignVariable,
  WhatsAppTemplate,
} from '@/core/domain/campaign';
import {
  canCancelCampaign,
  canPauseCampaign,
  canResumeCampaign,
  resolveCampaignVariables,
} from '@/core/domain/campaign';
import { DomainError, NotFoundError, type Id } from '@/core/domain/shared';
import type { CampaignDraft, CampaignRepository } from '@/core/ports/campaign-repository';
import type { Prisma } from '@/generated/prisma';
import { prisma, readJson, asJson } from '@/infrastructure/db/prisma';
import { agendamentoLabel } from '@/lib/datetime';

const STATUS: ReadonlySet<string> = new Set([
  'rascunho',
  'agendada',
  'em_andamento',
  'pausada',
  'concluida',
  'cancelada',
]);

const statusOf = (raw: string): CampaignStatus =>
  STATUS.has(raw) ? (raw as CampaignStatus) : 'rascunho';

const RECIPIENT_STATUS: ReadonlySet<string> = new Set([
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
]);

const recipientStatusOf = (raw: string): CampaignRecipientStatus =>
  RECIPIENT_STATUS.has(raw) ? (raw as CampaignRecipientStatus) : 'queued';

const audienceOf = (raw: Prisma.JsonValue): CampaignAudience => {
  const value = readJson<Partial<CampaignAudience>>(raw, { kind: 'todos' });
  if (value.kind === 'lista' && 'batchId' in value && value.batchId) {
    return { kind: 'lista', batchId: value.batchId, ...(value.name ? { name: value.name } : {}) };
  }
  if (value.kind === 'etiqueta' && 'labelId' in value && value.labelId) {
    return {
      kind: 'etiqueta',
      labelId: value.labelId,
      ...(value.name ? { name: value.name } : {}),
    };
  }
  return { kind: 'todos' };
};

const audienceLabelOf = (audience: CampaignAudience): string => {
  switch (audience.kind) {
    case 'todos':
      return 'Todos os contatos com telefone';
    case 'lista':
      return `Lista importada · ${audience.name ?? 'sem nome'}`;
    case 'etiqueta':
      return `Etiqueta · ${audience.name ?? 'sem nome'}`;
  }
};

const variablesOf = (raw: Prisma.JsonValue): CampaignVariable[] => {
  const lista = readJson<unknown>(raw, []);
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((item): CampaignVariable[] => {
    if (!item || typeof item !== 'object') return [];
    const v = item as { source?: string; value?: string; field?: string };
    if (v.source === 'campo' && typeof v.field === 'string') {
      const field = v.field;
      if (
        field === 'nome' ||
        field === 'primeiro_nome' ||
        field === 'empresa' ||
        field === 'telefone'
      ) {
        return [{ source: 'campo', field }];
      }
      return [];
    }
    return [{ source: 'texto', value: typeof v.value === 'string' ? v.value : '' }];
  });
};

const EMPTY_METRICS: CampaignMetrics = {
  recipients: 0,
  queued: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  replied: 0,
  failed: 0,
};

/**
 * Métricas contadas dos destinatários, e não de um JSON acumulado.
 *
 * Cada recibo da Meta muda uma linha de destinatário; somar de novo a cada
 * leitura é mais barato que manter um contador que qualquer recibo perdido
 * deixaria errado para sempre.
 */
const metricsFor = async (
  campaignIds: readonly string[],
): Promise<Map<string, CampaignMetrics>> => {
  const result = new Map<string, CampaignMetrics>();
  if (campaignIds.length === 0) return result;
  const grupos = await prisma.campaignRecipient.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: [...campaignIds] } },
    _count: { _all: true },
  });
  for (const grupo of grupos) {
    const atual = result.get(grupo.campaignId) ?? { ...EMPTY_METRICS };
    const n = grupo._count._all;
    const status = recipientStatusOf(grupo.status);
    const proximo: CampaignMetrics = {
      ...atual,
      recipients: atual.recipients + n,
      queued: atual.queued + (status === 'queued' || status === 'sending' ? n : 0),
      // A escada é cumulativa: quem leu foi entregue e enviado.
      sent:
        atual.sent +
        (status === 'sent' || status === 'delivered' || status === 'read' || status === 'replied'
          ? n
          : 0),
      delivered:
        atual.delivered +
        (status === 'delivered' || status === 'read' || status === 'replied' ? n : 0),
      read: atual.read + (status === 'read' || status === 'replied' ? n : 0),
      replied: atual.replied + (status === 'replied' ? n : 0),
      failed: atual.failed + (status === 'failed' ? n : 0),
    };
    result.set(grupo.campaignId, proximo);
  }
  return result;
};

const INCLUDE = {
  template: { select: { id: true, name: true, body: true } },
  inbox: { select: { name: true, identifier: true } },
} as const;

type Row = NonNullable<Awaited<ReturnType<typeof findRow>>>;
const findRow = (accountId: string, campaignId: string) =>
  prisma.campaign.findFirst({ where: { id: campaignId, accountId }, include: INCLUDE });

const toCampaign = (r: Row, metrics: CampaignMetrics): Campaign => {
  const audience = audienceOf(r.audience);
  return {
    id: r.id,
    accountId: r.accountId,
    name: r.name,
    status: statusOf(r.status),
    inboxId: r.inboxId,
    inboxName: r.inbox.name,
    inboxPhone: r.inbox.identifier,
    templateId: r.template?.id ?? null,
    templateName: r.template?.name ?? 'Template removido',
    templateBody: r.template?.body ?? '',
    audience,
    audienceLabel: audienceLabelOf(audience),
    variables: variablesOf(r.variables),
    rateLimit: r.rateLimit,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    scheduledLabel: r.scheduledAt
      ? agendamentoLabel(r.scheduledAt)
      : r.startedAt
        ? `começou ${agendamentoLabel(r.startedAt)}`
        : 'imediato',
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
    metrics,
  };
};

/**
 * Os contatos de uma origem, prontos para virar destinatários.
 *
 * Fora, sem exceção: grupo, quem pediu para não receber, quem foi arquivado e
 * quem não tem telefone. Nenhum deles é uma escolha de quem dispara — são as
 * regras que já valem para o envio um a um.
 */
const contatosDaOrigem = async (accountId: string, audience: CampaignAudience) => {
  const base = {
    deletedAt: null,
    whatsappOptOutAt: null,
    kind: { not: 'grupo' },
    phone: { not: '' },
  } as const;
  const origem =
    audience.kind === 'lista'
      ? { ...base, importBatchEntries: { some: { batchId: audience.batchId } } }
      : audience.kind === 'etiqueta'
        ? { ...base, labels: { some: { id: audience.labelId, accountId } } }
        : base;
  return prisma.contact.findMany({
    where: { accountId, ...origem },
    select: { id: true, name: true, phone: true, company: true },
    orderBy: { name: 'asc' },
  });
};

export class PrismaCampaignRepository implements CampaignRepository {
  async list(accountId: Id): Promise<readonly Campaign[]> {
    const rows = await prisma.campaign.findMany({
      where: { accountId },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const metrics = await metricsFor(rows.map((r) => r.id));
    return rows.map((r) => toCampaign(r, metrics.get(r.id) ?? EMPTY_METRICS));
  }

  async findById(accountId: Id, campaignId: Id): Promise<Campaign | null> {
    const r = await findRow(accountId, campaignId);
    if (!r) return null;
    const metrics = await metricsFor([r.id]);
    return toCampaign(r, metrics.get(r.id) ?? EMPTY_METRICS);
  }

  async listRecipients(accountId: Id, campaignId: Id): Promise<readonly CampaignRecipient[]> {
    const rows = await prisma.campaignRecipient.findMany({
      where: { campaignId, campaign: { accountId } },
      orderBy: [{ sentAt: 'desc' }, { name: 'asc' }],
      take: 2_000,
    });
    return rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      name: r.name ?? r.phone,
      phone: r.phone,
      status: recipientStatusOf(r.status),
      error: r.error,
      conversationId: r.conversationId,
      sentAt: r.sentAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
      repliedAt: r.repliedAt?.toISOString() ?? null,
    }));
  }

  async listInboxes(accountId: Id): Promise<readonly CampaignInbox[]> {
    const rows = await prisma.whatsAppCloudConnection.findMany({
      where: { accountId, status: { not: 'desconectado' } },
      select: {
        inboxId: true,
        wabaId: true,
        displayPhoneNumber: true,
        status: true,
        inbox: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.inboxId,
      name: r.inbox.name,
      phone: r.displayPhoneNumber,
      wabaId: r.wabaId,
      connected: r.status === 'conectado',
    }));
  }

  async listAudiences(accountId: Id): Promise<readonly CampaignAudienceOption[]> {
    const elegivel = {
      deletedAt: null,
      whatsappOptOutAt: null,
      kind: { not: 'grupo' },
      phone: { not: '' },
    } as const;
    const [total, listas, etiquetas] = await Promise.all([
      prisma.contact.count({ where: { accountId, ...elegivel } }),
      prisma.contactImportBatch.findMany({
        where: { accountId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { contacts: { where: { contact: elegivel } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.label.findMany({
        where: { accountId },
        select: {
          id: true,
          name: true,
          _count: { select: { contacts: { where: elegivel } } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return [
      ...listas.map((lista) => ({
        audience: { kind: 'lista' as const, batchId: lista.id, name: lista.name },
        label: lista.name,
        description: `Lista importada em ${lista.createdAt.toLocaleDateString('pt-BR')}`,
        contactCount: lista._count.contacts,
      })),
      ...etiquetas
        .filter((etiqueta) => etiqueta._count.contacts > 0)
        .map((etiqueta) => ({
          audience: { kind: 'etiqueta' as const, labelId: etiqueta.id, name: etiqueta.name },
          label: etiqueta.name,
          description: 'Contatos com esta etiqueta',
          contactCount: etiqueta._count.contacts,
        })),
      {
        audience: { kind: 'todos' as const },
        label: 'Todos os contatos',
        description: 'A base inteira, exceto grupos, arquivados e quem pediu para não receber',
        contactCount: total,
      },
    ];
  }

  async listTemplates(accountId: Id): Promise<readonly WhatsAppTemplate[]> {
    const rows = await prisma.messageTemplate.findMany({
      where: { accountId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => {
      // Extrai variáveis {{1}}, {{2}}, etc. do corpo da mensagem
      const matches = Array.from(r.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => `Variável ${m[1]}`);
      return {
        id: r.id,
        accountId: r.accountId,
        name: r.name,
        body: r.body,
        // Template da API oficial traz a aprovação da Meta; os demais (usados como
        // texto pelo QR Code) não passam por aprovação nenhuma.
        approval:
          !r.wabaId || r.status === 'approved'
            ? 'aprovado'
            : r.status === 'rejected' || r.status === 'disabled' || r.status === 'paused'
              ? 'rejeitado'
              : 'em_analise',
        variables: [...new Set(matches)],
        ...(r.wabaId ? { wabaId: r.wabaId } : {}),
        language: r.language,
        category: r.category,
      };
    });
  }

  async createCampaign(accountId: Id, draft: CampaignDraft): Promise<Campaign> {
    const conexao = await prisma.whatsAppCloudConnection.findFirst({
      where: { inboxId: draft.inboxId, accountId, status: { not: 'desconectado' } },
      select: { wabaId: true, inbox: { select: { id: true } } },
    });
    if (!conexao) {
      throw new DomainError(
        'Campanhas só saem por caixas conectadas pela API oficial da Meta.',
        'CAMPAIGN_INBOX_NOT_CLOUD',
      );
    }
    const template = await prisma.messageTemplate.findFirst({
      where: { id: draft.templateId, accountId },
      select: { id: true, status: true, wabaId: true },
    });
    if (!template || template.wabaId !== conexao.wabaId) {
      throw new DomainError(
        'O template precisa ser da mesma conta do WhatsApp Business da caixa.',
        'CAMPAIGN_TEMPLATE_WABA',
      );
    }
    if (template.status !== 'approved') {
      throw new DomainError(
        'Só templates aprovados pela Meta podem ser disparados.',
        'TEMPLATE_NOT_APPROVED',
      );
    }

    const contatos = await contatosDaOrigem(accountId, draft.audience);
    if (contatos.length === 0) {
      throw new DomainError(
        'Nenhum contato elegível nessa origem: todos sem telefone, arquivados ou com opt-out.',
        'CAMPAIGN_EMPTY',
      );
    }

    // Um telefone recebe uma vez por campanha, mesmo que dois cadastros o
    // compartilhem: o cliente não sabe que tem dois cadastros, só vê duas
    // mensagens iguais.
    const porTelefone = new Map<string, (typeof contatos)[number]>();
    for (const contato of contatos) {
      const chave = contato.phone.replace(/\D/g, '');
      if (chave && !porTelefone.has(chave)) porTelefone.set(chave, contato);
    }

    const scheduledAt = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
    const comecaAgora = !scheduledAt || scheduledAt.getTime() <= Date.now();

    const row = await prisma.$transaction(async (tx) => {
      const criada = await tx.campaign.create({
        data: {
          accountId,
          inboxId: draft.inboxId,
          channel: 'whatsapp',
          name: draft.name,
          templateId: template.id,
          audience: asJson(draft.audience),
          variables: asJson(draft.variables),
          rateLimit: draft.rateLimit,
          scheduledAt: comecaAgora ? null : scheduledAt,
          status: comecaAgora ? 'em_andamento' : 'agendada',
          startedAt: comecaAgora ? new Date() : null,
          createdById: draft.createdById,
          stats: asJson({}),
        },
        select: { id: true },
      });
      await tx.campaignRecipient.createMany({
        data: [...porTelefone.values()].map((contato) => ({
          campaignId: criada.id,
          contactId: contato.id,
          phone: contato.phone,
          name: contato.name,
          variables: asJson(
            resolveCampaignVariables(draft.variables, {
              name: contato.name,
              phone: contato.phone,
              ...(contato.company ? { company: contato.company } : {}),
            }),
          ),
          status: 'queued',
        })),
      });
      return criada;
    });

    const criada = await this.findById(accountId, row.id);
    if (!criada) throw new NotFoundError('Campanha', row.id);
    return criada;
  }

  private async transition(
    accountId: Id,
    campaignId: Id,
    permitido: (status: CampaignStatus) => boolean,
    data: { status: CampaignStatus; canceledAt?: Date; startedAt?: Date; lastError?: null },
    erro: string,
  ): Promise<Campaign> {
    const atual = await prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
      select: { status: true, scheduledAt: true, startedAt: true },
    });
    if (!atual) throw new NotFoundError('Campanha', campaignId);
    if (!permitido(statusOf(atual.status))) throw new DomainError(erro, 'CAMPAIGN_STATE');
    await prisma.campaign.updateMany({ where: { id: campaignId, accountId }, data });
    const campanha = await this.findById(accountId, campaignId);
    if (!campanha) throw new NotFoundError('Campanha', campaignId);
    return campanha;
  }

  pauseCampaign(accountId: Id, campaignId: Id): Promise<Campaign> {
    return this.transition(
      accountId,
      campaignId,
      canPauseCampaign,
      { status: 'pausada' },
      'Só campanhas agendadas ou em andamento podem ser pausadas.',
    );
  }

  async resumeCampaign(accountId: Id, campaignId: Id): Promise<Campaign> {
    // Retomar ignora o agendamento original: quem pausou e voltou quer que
    // saia agora, não que espere uma data que talvez já passou.
    return this.transition(
      accountId,
      campaignId,
      canResumeCampaign,
      { status: 'em_andamento', startedAt: new Date(), lastError: null },
      'Só campanhas pausadas podem ser retomadas.',
    );
  }

  async cancelCampaign(accountId: Id, campaignId: Id): Promise<Campaign> {
    const campanha = await this.transition(
      accountId,
      campaignId,
      canCancelCampaign,
      { status: 'cancelada', canceledAt: new Date() },
      'Esta campanha já terminou.',
    );
    // Quem ainda estava na fila não recebe. Quem já recebeu, recebeu.
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, status: { in: ['queued', 'sending'] } },
      data: { status: 'failed', error: 'Campanha cancelada antes do envio.' },
    });
    return (await this.findById(accountId, campaignId)) ?? campanha;
  }

  async deleteCampaign(accountId: Id, campaignId: Id): Promise<void> {
    const atual = await prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
      select: { status: true },
    });
    if (!atual) throw new NotFoundError('Campanha', campaignId);
    if (statusOf(atual.status) === 'em_andamento') {
      throw new DomainError('Pause ou cancele a campanha antes de excluí-la.', 'CAMPAIGN_STATE');
    }
    await prisma.campaign.deleteMany({ where: { id: campaignId, accountId } });
  }
}
