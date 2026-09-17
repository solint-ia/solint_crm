import { NextResponse } from 'next/server';

import { testCloudConnection } from '@/infrastructure/whatsapp/cloud/cloud-onboarding';
import { cloudErrorResponse, guardCloudRoute } from '../_shared/guard';

export const dynamic = 'force-dynamic';

/** Confere o token na Meta e atualiza qualidade, limite e nome verificado. */
export async function POST(_request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;

  try {
    return NextResponse.json({
      ok: true,
      ...(await testCloudConnection(ctx.session.account.id, inboxId)),
    });
  } catch (error) {
    return cloudErrorResponse(error, 'Falha ao testar a API oficial');
  }
}
