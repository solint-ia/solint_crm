import { timingSafeEqual } from 'node:crypto';

import { prisma } from '@/infrastructure/db/prisma';
import {
  ingestCloudEvents,
  MAX_WEBHOOK_BYTES,
} from '@/infrastructure/whatsapp/cloud/cloud-webhook-ingest';
import { isValidMetaSignature } from '@/infrastructure/whatsapp/cloud/cloud-webhook-parse';

export const dynamic = 'force-dynamic';

/**
 * Webhook global da API oficial: o do app da Solint (Embedded Signup).
 *
 * Um endereço para todos os clientes que conectaram pelo popup da Meta. O corpo
 * é assinado com `META_APP_SECRET`, e cada evento vai para a caixa dona do
 * `phone_number_id` — ou, nos eventos da conta inteira (templates), para todas
 * as caixas daquela WABA.
 */

const iguais = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(request: Request) {
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  const url = new URL(request.url);
  const token = url.searchParams.get('hub.verify_token') ?? '';
  if (!esperado || url.searchParams.get('hub.mode') !== 'subscribe' || !iguais(token, esperado)) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(url.searchParams.get('hub.challenge') ?? '', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) return new Response('Not configured', { status: 404 });

  const tamanho = Number(request.headers.get('content-length') ?? '0');
  if (tamanho > MAX_WEBHOOK_BYTES) return new Response('Payload too large', { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return new Response('Payload too large', { status: 413 });
  if (!isValidMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  try {
    await ingestCloudEvents(body, async (evento) => {
      // tenant-ok: a conta sai da própria conexão; o id do número é único no sistema.
      const conexoes = await prisma.whatsAppCloudConnection.findMany({
        where: evento.phoneNumberId.startsWith('waba:')
          ? { wabaId: evento.wabaId, status: { not: 'desconectado' } }
          : { phoneNumberId: evento.phoneNumberId, status: { not: 'desconectado' } },
        select: { inboxId: true, accountId: true, phoneNumberId: true, wabaId: true },
      });
      return conexoes;
    });
  } catch (error) {
    console.error('[cloud-webhook] Falha ao gravar eventos:', error);
    return new Response('Retry later', { status: 500 });
  }

  return new Response('EVENT_RECEIVED', { status: 200 });
}
