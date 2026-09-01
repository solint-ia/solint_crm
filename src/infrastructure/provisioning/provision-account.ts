import {
  DEFAULT_INBOX_NAME,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  STARTER_BILLING,
} from '@/core/domain/account-provisioning';
import { defaultBusinessHours } from '@/core/domain/business-hours';
import { SYSTEM_ROLES, systemRoleId } from '@/core/domain/system-roles';
import { asJson } from '@/infrastructure/db/prisma';
import type { Prisma } from '@/generated/prisma';

/**
 * Escreve um workspace novo inteiro, dentro da transação de quem chamou.
 *
 * Recebe o cliente de transação em vez de abrir a própria: no cadastro público
 * a conta e o **usuário** nascem juntos, e uma conta sem administrador seria
 * inacessível. Deixar cada lado abrir a sua transação permitiria exatamente
 * esse meio cadastro.
 *
 * O que nasce, e por quê:
 *
 *  - **Conta** no plano `starter`. Não há cobrança no cadastro nem na criação.
 *  - **Os dois papéis de sistema.** Antes só o de administrador era criado, e
 *    quem convidasse um colaborador não tinha outro papel para oferecer.
 *  - **Vínculo de administrador** para quem criou. Papel, equipes e
 *    disponibilidade vivem no vínculo: são do par pessoa+conta, não da pessoa.
 *  - **Configurações** com o faturamento vazio, para a tela de plano abrir.
 *  - **Caixa de entrada** padrão, já na forma canônica do domínio. Ela usa
 *    `text` e nunca `message`: o campo já se chamou `message` aqui, o domínio
 *    sempre leu `text`, e toda conta criada pelo cadastro nascia com a tela de
 *    Configurações recusando salvar.
 *  - **Funil comercial** com as etapas e os pesos de conversão padrão.
 */
export interface ProvisionAccountInput {
  readonly accountId: string;
  readonly name: string;
  readonly document?: string;
  /** Quem vira administrador da conta. Precisa já existir na transação. */
  readonly ownerUserId: string;
}

export const provisionAccount = async (
  tx: Prisma.TransactionClient,
  { accountId, name, document, ownerUserId }: ProvisionAccountInput,
): Promise<void> => {
  await tx.account.create({
    data: { id: accountId, name, plan: 'starter', ...(document ? { document } : {}) },
  });

  await tx.role.createMany({
    data: SYSTEM_ROLES.map((role) => ({
      id: systemRoleId(accountId, role.slug),
      accountId,
      slug: role.slug,
      name: role.name,
      description: role.description,
      permissions: asJson(role.permissions),
      isSystem: true,
    })),
  });

  await tx.membership.create({
    data: { userId: ownerUserId, accountId, roleSlug: 'administrador', availability: 'disponivel' },
  });

  await tx.accountSettings.create({
    data: { accountId, billing: asJson(STARTER_BILLING) },
  });

  await tx.inbox.create({
    data: {
      id: `ibx-${accountId}`,
      accountId,
      name: DEFAULT_INBOX_NAME,
      channel: 'whatsapp',
      identifier: 'whatsapp-primary',
      status: 'ativo',
      provider: 'baileys',
      businessHours: asJson(defaultBusinessHours()),
      awayMessage: asJson({ enabled: false, text: '' }),
      greeting: asJson({ enabled: false, text: '' }),
      closingMessage: asJson({ enabled: false, text: '' }),
      waitingMessage: asJson({ enabled: false, text: '' }),
    },
  });

  const pipelineId = `pip-${accountId}`;
  await tx.pipeline.create({
    data: { id: pipelineId, accountId, name: DEFAULT_PIPELINE_NAME },
  });
  await tx.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((stage) => ({
      id: `stg-${stage.slug}-${accountId}`,
      pipelineId,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      isWon: stage.isWon,
      isLost: stage.isLost,
      conversionWeight: stage.conversionWeight,
    })),
  });
};
