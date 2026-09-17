import {
  loadCloudConnectionByWebhookKey,
  verifyTokenMatches,
} from '@/infrastructure/whatsapp/cloud/cloud-connection';
import {
  ingestCloudEvents,
  MAX_WEBHOOK_BYTES,
} from '@/infrastructure/whatsapp/cloud/cloud-webhook-ingest';
import { isValidMetaSignature } from '@/infrastructure/whatsapp/cloud/cloud-webhook-parse';

export const dynamic = 'force-dynamic';

/**
 * Webhook da API oficial no **modo manual**: um endereço por conexão.
 *
 * A empresa usa o próprio app da Meta, e cada app assina o corpo com o próprio
 * app secret. Por isso a URL identifica a conexão (`webhookKey`, aleatório, e não
 * o id da caixa) e a assinatura é conferida com o secret dela.
 *
 * Sem sessão de propósito: quem chama é a Meta. A autenticação é a assinatura.
 */

type Params = { params: Promise<{ webhookKey: string }> };

/** Verificação do endereço, feita pela Meta ao salvar o webhook no painel do app. */
export async function GET(request: Request, props: Params) {
  const { webhookKey } = await props.params;
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') ?? '';
  const challenge = url.searchParams.get('hub.challenge') ?? '';

  const conexao = await loadCloudConnectionByWebhookKey(webhookKey).catch(() => null);
  if (!conexao || mode !== 'subscribe' || !verifyTokenMatches(token, conexao.verifyTokenHash)) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: Request, props: Params) {
  const { webhookKey } = await props.params;
  const tamanho = Number(request.headers.get('content-length') ?? '0');
  if (tamanho > MAX_WEBHOOK_BYTES) return new Response('Payload too large', { status: 413 });

  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return new Response('Payload too large', { status: 413 });

  const conexao = await loadCloudConnectionByWebhookKey(webhookKey).catch(() => null);
  if (!conexao) return new Response('Not found', { status: 404 });
  if (
    !conexao.appSecret ||
    !isValidMetaSignature(raw, request.headers.get('x-hub-signature-256'), conexao.appSecret)
  ) {
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
      const doNumero = evento.phoneNumberId === conexao.phoneNumberId;
      const daConta = evento.phoneNumberId.startsWith('waba:') && evento.wabaId === conexao.wabaId;
      return doNumero || daConta
        ? [
            {
              inboxId: conexao.inboxId,
              accountId: conexao.accountId,
              phoneNumberId: conexao.phoneNumberId,
              wabaId: conexao.wabaId,
            },
          ]
        : [];
    });
  } catch (error) {
    // Falha de banco: 500 faz a Meta tentar de novo, que é o que se quer.
    console.error('[cloud-webhook] Falha ao gravar eventos:', error);
    return new Response('Retry later', { status: 500 });
  }

  return new Response('EVENT_RECEIVED', { status: 200 });
}
