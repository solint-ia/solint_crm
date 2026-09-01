import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { qrImage } from '@/infrastructure/whatsapp/qr-image';

export const dynamic = 'force-dynamic';

/**
 * Leitura pontual do status de **uma caixa**.
 *
 * Existia só a versão global (`/api/whatsapp/status`), e o hook da tela tinha
 * um `if (!inboxId)` que a pulava — ou seja, para caixa específica não havia
 * leitura pontual nenhuma. O modal abria mostrando o estado inicial embutido no
 * código ("Desconectado") e só corrigia quando o primeiro evento do SSE
 * chegasse, o que leva alguns segundos. Quem abria o modal de um número já
 * conectado via "Desconectado" por um instante; quem clicava em conectar via a
 * mesma coisa e achava que o clique não tinha feito nada.
 *
 * Mesma proteção da rota global: exige sessão, confere que a caixa é da conta e
 * só entrega o QR para a conta dona — o QR é uma credencial, quem o lê pareia o
 * WhatsApp da empresa no próprio aparelho.
 */
export async function GET(_request: Request, props: { params: Promise<{ inboxId: string }> }) {
  const { inboxId } = await props.params;

  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }

  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, accountId: session.account.id },
    select: { id: true },
  });
  if (!inbox) {
    return NextResponse.json(
      { ok: false, error: 'Caixa de entrada não encontrada para esta conta.' },
      { status: 404 },
    );
  }

  const channel = await getWhatsAppChannel();
  const status = await channel.getStatus(session.account.id, inboxId);

  const owner = status.owner;
  const visible = !owner || owner.accountId === session.account.id;

  return NextResponse.json({
    ok: true,
    engine: channel.engine,
    // O QR vira imagem só aqui, na borda — ver `qr-image.ts`.
    status: visible ? { ...status, qr: await qrImage(status.qr) } : { ...status, qr: undefined },
  });
}
