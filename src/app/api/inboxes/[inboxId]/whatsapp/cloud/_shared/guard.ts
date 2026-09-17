import { NextResponse } from 'next/server';

import { can, canSeeInbox, type Session } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';

export interface CloudRouteContext {
  readonly session: Session;
  readonly inbox: { readonly id: string; readonly name: string; readonly provider: string };
}

/**
 * A mesma porta das rotas de QR Code: sessão, permissão de configurar caixas,
 * alcance da caixa e caixa de WhatsApp desta conta.
 */
export const guardCloudRoute = async (
  inboxId: string,
): Promise<CloudRouteContext | NextResponse> => {
  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }
  if (!can(session, 'config.caixas:escrever') || !canSeeInbox(session, inboxId)) {
    return NextResponse.json(
      { ok: false, error: 'Sem permissão para configurar esta caixa.' },
      { status: 403 },
    );
  }
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, accountId: session.account.id },
    select: { id: true, name: true, provider: true, channel: true },
  });
  if (!inbox || inbox.channel !== 'whatsapp') {
    return NextResponse.json(
      { ok: false, error: 'Caixa de WhatsApp não encontrada nesta conta.' },
      { status: 404 },
    );
  }
  return { session, inbox };
};

export const cloudErrorResponse = (error: unknown, fallback: string): NextResponse => {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const status = error instanceof Error && error.name === 'CloudApiError' ? 400 : 500;
  if (status === 500) console.error(`[cloud] ${fallback}:`, error);
  return NextResponse.json({ ok: false, error: message }, { status });
};
