import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/infrastructure/db/prisma';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import {
  connectManual,
  syncCloudTemplates,
} from '@/infrastructure/whatsapp/cloud/cloud-onboarding';
import { cloudErrorResponse, guardCloudRoute } from '../_shared/guard';

export const dynamic = 'force-dynamic';

const schema = z.object({
  phoneNumberId: z.string().trim().min(5).max(40),
  wabaId: z.string().trim().min(5).max(40),
  accessToken: z.string().trim().min(20).max(2048),
  appSecret: z.string().trim().min(16).max(64),
  appId: z.string().trim().max(40).optional(),
  pin: z.string().trim().max(6).optional(),
  regenerateVerifyToken: z.boolean().optional(),
});

/**
 * Conecta a caixa pela API oficial, no modo manual (app da própria empresa).
 *
 * Se a caixa tinha QR Code pareado, ele é desconectado antes: o mesmo número não
 * fala pelos dois caminhos, e uma sessão de QR esquecida continuaria gravando
 * mensagens duplicadas na mesma conversa.
 */
export async function POST(request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Preencha o ID do número, o ID da conta, o token e a chave secreta do app.',
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
        const channel = await getWhatsAppChannel();
        await channel.disconnect(ctx.session.account.id, inboxId);
      }
    }

    const resultado = await connectManual({
      accountId: ctx.session.account.id,
      inboxId,
      userId: ctx.session.user.id,
      ...parsed.data,
    });

    void writeAuditLog({
      accountId: ctx.session.account.id,
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'configuracao.alterada',
      targetType: 'configuracao',
      targetId: inboxId,
      targetName: ctx.inbox.name,
      // Sem token, secret ou PIN: a auditoria é lida por gente que não deve vê-los.
      metadata: {
        detalhe: 'api_oficial_conectada',
        modo: 'manual',
        numero: resultado.displayPhoneNumber,
      },
    });

    // Os templates vêm junto para o seletor já abrir cheio. Falhar aqui não
    // desfaz a conexão: dá para sincronizar depois pela tela.
    await syncCloudTemplates(ctx.session.account.id, inboxId).catch((error) => {
      console.warn('[cloud] Sincronização inicial de templates falhou:', error);
    });

    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    return cloudErrorResponse(error, 'Falha ao conectar a API oficial');
  }
}
