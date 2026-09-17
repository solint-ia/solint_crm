import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/infrastructure/db/prisma';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import {
  connectEmbeddedSignup,
  embeddedSignupConfigured,
  syncCloudTemplates,
} from '@/infrastructure/whatsapp/cloud/cloud-onboarding';
import { cloudErrorResponse, guardCloudRoute } from '../_shared/guard';

export const dynamic = 'force-dynamic';

const schema = z.object({
  code: z.string().min(10).max(2048),
  phoneNumberId: z.string().trim().min(5).max(40),
  wabaId: z.string().trim().min(5).max(40),
  businessId: z.string().trim().max(40).optional(),
  event: z.enum(['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING']),
});

/** O que a tela precisa para abrir o popup da Meta. Nada daqui é segredo. */
export async function GET(_request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;
  if (!embeddedSignupConfigured()) return NextResponse.json({ ok: true, enabled: false });
  return NextResponse.json({
    ok: true,
    enabled: true,
    appId: process.env.META_APP_ID?.trim(),
    configId: process.env.META_ES_CONFIG_ID?.trim(),
    graphVersion: process.env.META_GRAPH_VERSION?.trim() || 'v25.0',
  });
}

/**
 * Recebe o resultado do popup da Meta e conclui a conexão.
 *
 * O código vale 30 segundos: a tela chama esta rota assim que o popup fecha.
 */
export async function POST(request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'O cadastro da Meta não devolveu os dados do número.' },
      { status: 400 },
    );
  }
  if (parsed.data.event === 'FINISH_ONLY_WABA') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'A conta do WhatsApp Business foi criada, mas nenhum número foi adicionado. Refaça o cadastro escolhendo um número.',
      },
      { status: 400 },
    );
  }

  try {
    if (ctx.inbox.provider !== 'cloud_api') {
      const qr = await prisma.whatsAppConnection.findUnique({
        where: { inboxId },
        select: { credsCipher: true },
      });
      if (qr?.credsCipher) {
        await (await getWhatsAppChannel()).disconnect(ctx.session.account.id, inboxId);
      }
    }

    const resultado = await connectEmbeddedSignup({
      accountId: ctx.session.account.id,
      inboxId,
      userId: ctx.session.user.id,
      code: parsed.data.code,
      phoneNumberId: parsed.data.phoneNumberId,
      wabaId: parsed.data.wabaId,
      ...(parsed.data.businessId ? { businessId: parsed.data.businessId } : {}),
      event: parsed.data.event,
    });

    void writeAuditLog({
      accountId: ctx.session.account.id,
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'configuracao.alterada',
      targetType: 'configuracao',
      targetId: inboxId,
      targetName: ctx.inbox.name,
      metadata: {
        detalhe: 'api_oficial_conectada',
        modo: 'embedded_signup',
        coexistencia: parsed.data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        numero: resultado.displayPhoneNumber,
      },
    });

    await syncCloudTemplates(ctx.session.account.id, inboxId).catch(() => undefined);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    return cloudErrorResponse(error, 'Falha ao concluir o cadastro da Meta');
  }
}
