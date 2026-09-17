import { prisma } from '@/infrastructure/db/prisma';
import type { DispatchContext, DispatchResult, DispatchTarget } from '../channel';
import { announceCloudSent, handleCloudSendError, requireCloudConnection } from './cloud-channel';
import { sendCloudTemplate } from './cloud-sender';

/**
 * Envia um template aprovado pela API oficial.
 *
 * O template precisa ser da mesma WABA da caixa: o nome sozinho não basta, e
 * mandar pelo número de uma conta um template aprovado em outra dá erro 132001.
 */
export const sendTemplateViaCloud = async (
  context: DispatchContext,
  target: DispatchTarget,
  templateId: string,
  values: readonly string[],
): Promise<DispatchResult> => {
  try {
    const conn = await requireCloudConnection(context.inboxId);
    const template = await prisma.messageTemplate.findFirst({
      where: { id: templateId, accountId: context.accountId },
      select: { name: true, language: true, wabaId: true, status: true },
    });
    if (!template) return { ok: false, error: 'Template não encontrado.' };
    if (template.wabaId !== conn.wabaId) {
      return {
        ok: false,
        error:
          'Este template não pertence à conta do WhatsApp Business desta caixa. Sincronize os templates.',
      };
    }
    if (template.status !== 'approved') {
      return { ok: false, error: 'O template ainda não foi aprovado pela Meta.' };
    }
    const wamid = await sendCloudTemplate(conn, target, {
      name: template.name,
      language: template.language,
      bodyValues: values,
    });
    await announceCloudSent(conn, context.messageId, wamid);
    return { ok: true, externalId: wamid };
  } catch (error) {
    return { ok: false, error: await handleCloudSendError(context.inboxId, error) };
  }
};
