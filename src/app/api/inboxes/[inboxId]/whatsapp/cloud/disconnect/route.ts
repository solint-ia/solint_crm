import { NextResponse } from 'next/server';

import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { disconnectCloudInbox } from '@/infrastructure/whatsapp/cloud/cloud-onboarding';
import { cloudErrorResponse, guardCloudRoute } from '../_shared/guard';

export const dynamic = 'force-dynamic';

/** Desliga a API oficial da caixa e apaga token, secret e PIN. */
export async function POST(_request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;

  try {
    await disconnectCloudInbox(ctx.session.account.id, inboxId);
    void writeAuditLog({
      accountId: ctx.session.account.id,
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'configuracao.alterada',
      targetType: 'configuracao',
      targetId: inboxId,
      targetName: ctx.inbox.name,
      metadata: { detalhe: 'api_oficial_desconectada' },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return cloudErrorResponse(error, 'Falha ao desconectar a API oficial');
  }
}
