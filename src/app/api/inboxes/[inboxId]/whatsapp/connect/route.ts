import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { PhoneNumber } from '@/core/domain/contact';
import { can, canSeeInbox } from '@/core/domain/user';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, props: { params: Promise<{ inboxId: string }> }) {
  try {
    const { inboxId } = await props.params;
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }
    if (!can(session, 'config.caixas:escrever') || !canSeeInbox(session, inboxId)) {
      return NextResponse.json(
        { ok: false, error: 'Sem permissão para conectar esta caixa.' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      method?: unknown;
      phoneNumber?: unknown;
      historyDays?: unknown;
    };
    const method = body.method === 'phone' ? 'phone' : 'qr';
    const rawPhone = typeof body.phoneNumber === 'string' ? body.phoneNumber : '';
    const normalizedPhone = PhoneNumber.normalize(rawPhone);

    if (method === 'phone' && !PhoneNumber.isValid(rawPhone)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Informe um número válido com DDI e DDD (ex.: 5511999998888).',
        },
        { status: 400 },
      );
    }
    const phoneNumber = normalizedPhone.slice(1);
    const allowedHistoryDays = [0, 7, 15, 30, 90] as const;
    const requestedHistoryDays = typeof body.historyDays === 'number' ? body.historyDays : 0;
    if (!allowedHistoryDays.some((days) => days === requestedHistoryDays)) {
      return NextResponse.json(
        { ok: false, error: 'Período de importação de histórico inválido.' },
        { status: 400 },
      );
    }

    // 1. Confere se a caixa de entrada pertence à conta ativa
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, accountId: session.account.id },
      select: {
        id: true,
        channel: true,
      },
    });

    if (!inbox) {
      return NextResponse.json(
        { ok: false, error: 'Caixa de entrada não encontrada para esta conta.' },
        { status: 404 },
      );
    }

    if (inbox.channel !== 'whatsapp') {
      return NextResponse.json(
        { ok: false, error: `Canal desta caixa é ${inbox.channel}, não whatsapp.` },
        { status: 400 },
      );
    }

    const channel = await getWhatsAppChannel();
    const status = await channel.startSession(
      {
        userId: session.user.id,
        userName: session.user.name,
        accountId: session.account.id,
      },
      {
        method,
        inboxId,
        ...(method === 'phone' ? { phoneNumber } : {}),
        historyDays:
          process.env.WA_HISTORY_IMPORT === '1'
            ? (requestedHistoryDays as 0 | 7 | 15 | 30 | 90)
            : 0,
      },
    );

    if (process.env.WA_HISTORY_IMPORT === '1' && requestedHistoryDays > 0) {
      void writeAuditLog({
        accountId: session.account.id,
        actorId: session.user.id,
        actorName: session.user.name,
        action: 'configuracao.alterada',
        targetType: 'configuracao',
        targetId: inboxId,
        targetName: 'Importação do histórico do WhatsApp',
        metadata: { detalhe: 'historico_whatsapp_solicitado', dias: requestedHistoryDays },
      });
    }

    return NextResponse.json({ ok: true, engine: channel.engine, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao iniciar conexão de WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
