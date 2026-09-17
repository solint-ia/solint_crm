import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { whatsappProviderOf, type WhatsAppProvider } from '@/core/domain/whatsapp-provider';
import { prisma } from '@/infrastructure/db/prisma';
import { open, seal, type SealedData } from '../auth/crypto';
import type { WhatsAppStatusPayload } from '../whatsapp-events';

/**
 * A conexão de uma caixa com a API oficial, já com os segredos decifrados.
 *
 * Só existe em memória do servidor. Nada daqui vai para a tela, para log ou para
 * auditoria: quem precisa mostrar a conexão usa `cloudStatusPayload`.
 */
export interface CloudConnection {
  readonly inboxId: string;
  readonly accountId: string;
  readonly mode: 'manual' | 'embedded_signup';
  readonly coexistence: boolean;
  readonly businessId?: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly displayPhoneNumber: string;
  readonly verifiedName?: string;
  readonly status: string;
  readonly token: string;
  readonly appSecret?: string;
  readonly webhookKey: string;
}

/** O AAD amarra o dado cifrado à caixa: um token copiado para outra linha não abre. */
const aadDe = (inboxId: string, campo: 'token' | 'app_secret' | 'pin'): string =>
  `wa-cloud:${inboxId}:${campo}`;

export const sealCloudSecret = (
  inboxId: string,
  campo: 'token' | 'app_secret' | 'pin',
  valor: string,
): SealedData => seal(Buffer.from(valor, 'utf8'), aadDe(inboxId, campo));

const openCloudSecret = (
  inboxId: string,
  campo: 'token' | 'app_secret' | 'pin',
  cipher: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  keyId: string | null,
): string =>
  open(Buffer.from(cipher), Buffer.from(iv), Buffer.from(tag), {
    aad: aadDe(inboxId, campo),
    keyId,
  }).toString('utf8');

export const hashVerifyToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const verifyTokenMatches = (token: string, hash: string): boolean => {
  const a = Buffer.from(hashVerifyToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Segmento aleatório da URL do webhook. Nunca o id da caixa, que é enumerável. */
export const newWebhookKey = (): string => randomBytes(24).toString('base64url');

/** Verify token que a empresa cola no painel da Meta. */
export const newVerifyToken = (): string => `solint_${randomBytes(18).toString('base64url')}`;

export const cloudWebhookUrl = (webhookKey?: string): string | undefined => {
  const base = process.env.SOLINT_APP_URL?.trim().replace(/\/+$/, '');
  if (!base) return undefined;
  return webhookKey
    ? `${base}/api/whatsapp/cloud/webhook/${webhookKey}`
    : `${base}/api/whatsapp/cloud/webhook`;
};

const CACHE_MS = 30_000;
const connectionCache = new Map<string, { at: number; value: CloudConnection | null }>();
const providerCache = new Map<string, { at: number; value: WhatsAppProvider }>();

/** Esquece o que este processo sabe da caixa. Chamado a cada conexão e desconexão. */
export const invalidateCloudCaches = (inboxId: string): void => {
  connectionCache.delete(inboxId);
  providerCache.delete(inboxId);
};

/**
 * O provedor da caixa, com cache curto.
 *
 * Todo envio passa por aqui, e ler a caixa a cada mensagem seria uma consulta a
 * mais no caminho mais quente do sistema. Quinze segundos é o atraso máximo
 * entre trocar o provedor e outro processo perceber; quem troca invalida o
 * próprio cache na hora.
 */
export const providerOfInbox = async (inboxId: string): Promise<WhatsAppProvider> => {
  const cached = providerCache.get(inboxId);
  if (cached && Date.now() - cached.at < 15_000) return cached.value;
  // tenant-ok: o chamador já conferiu a caixa contra a conta; aqui só se lê o provedor.
  const inbox = await prisma.inbox.findUnique({
    where: { id: inboxId },
    select: { provider: true },
  });
  const value = whatsappProviderOf(inbox?.provider);
  providerCache.set(inboxId, { at: Date.now(), value });
  return value;
};

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof findRow>>>;

const findRow = (where: { inboxId: string } | { phoneNumberId: string } | { webhookKey: string }) =>
  prisma.whatsAppCloudConnection.findFirst({ where });

const toConnection = (row: ConnectionRow): CloudConnection => ({
  inboxId: row.inboxId,
  accountId: row.accountId,
  mode: row.mode === 'embedded_signup' ? 'embedded_signup' : 'manual',
  coexistence: row.coexistence,
  ...(row.businessId ? { businessId: row.businessId } : {}),
  wabaId: row.wabaId,
  phoneNumberId: row.phoneNumberId,
  displayPhoneNumber: row.displayPhoneNumber,
  ...(row.verifiedName ? { verifiedName: row.verifiedName } : {}),
  status: row.status,
  token: openCloudSecret(
    row.inboxId,
    'token',
    row.tokenCipher,
    row.tokenIv,
    row.tokenTag,
    row.tokenKeyId,
  ),
  ...(row.appSecretCipher && row.appSecretIv && row.appSecretTag
    ? {
        appSecret: openCloudSecret(
          row.inboxId,
          'app_secret',
          row.appSecretCipher,
          row.appSecretIv,
          row.appSecretTag,
          row.appSecretKeyId,
        ),
      }
    : {}),
  webhookKey: row.webhookKey,
});

/** A conexão oficial da caixa, ou `null` se ela não tem (ou foi desconectada). */
export const loadCloudConnection = async (inboxId: string): Promise<CloudConnection | null> => {
  const cached = connectionCache.get(inboxId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const row = await findRow({ inboxId });
  const value = row && row.status !== 'desconectado' ? toConnection(row) : null;
  connectionCache.set(inboxId, { at: Date.now(), value });
  return value;
};

/** A conexão dona de um `phone_number_id`, como ele chega no webhook. */
export const loadCloudConnectionByPhoneNumberId = async (
  phoneNumberId: string,
): Promise<CloudConnection | null> => {
  const row = await findRow({ phoneNumberId });
  return row && row.status !== 'desconectado' ? toConnection(row) : null;
};

export const loadCloudConnectionByWebhookKey = async (
  webhookKey: string,
): Promise<(CloudConnection & { readonly verifyTokenHash: string }) | null> => {
  const row = await findRow({ webhookKey });
  if (!row || row.status === 'desconectado') return null;
  return { ...toConnection(row), verifyTokenHash: row.verifyTokenHash };
};

/** Estado da caixa oficial no mesmo formato do QR, para a tela não ter dois modelos. */
export const cloudStatusPayload = async (
  accountId: string,
  inboxId: string,
): Promise<WhatsAppStatusPayload | null> => {
  const row = await prisma.whatsAppCloudConnection.findFirst({
    where: { inboxId, accountId },
    select: {
      mode: true,
      status: true,
      lastError: true,
      wabaId: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      verifiedName: true,
      qualityRating: true,
      messagingLimit: true,
      coexistence: true,
      webhookKey: true,
      lastWebhookAt: true,
      updatedAt: true,
      createdAt: true,
      connectedByUserId: true,
    },
  });
  if (!row) return null;

  const status: WhatsAppStatusPayload['status'] =
    row.status === 'conectado'
      ? 'conectado'
      : row.status === 'conectando' || row.status === 'pendente_registro'
        ? 'conectando'
        : 'desconectado';

  return {
    inboxId,
    provider: 'cloud_api',
    status,
    phone: row.displayPhoneNumber,
    ...(row.verifiedName ? { name: row.verifiedName } : {}),
    ...(row.lastError && row.status !== 'conectado' ? { error: row.lastError } : {}),
    ...(row.status === 'conectado' ? { connectedAt: row.createdAt.toISOString() } : {}),
    paired: row.status !== 'desconectado',
    cloud: {
      mode: row.mode === 'embedded_signup' ? 'embedded_signup' : 'manual',
      connectionStatus: row.status,
      wabaId: row.wabaId,
      phoneNumberId: row.phoneNumberId,
      ...(row.verifiedName ? { verifiedName: row.verifiedName } : {}),
      ...(row.qualityRating ? { qualityRating: row.qualityRating } : {}),
      ...(row.messagingLimit ? { messagingLimit: row.messagingLimit } : {}),
      coexistence: row.coexistence,
      ...(row.mode === 'embedded_signup'
        ? {}
        : (() => {
            const url = cloudWebhookUrl(row.webhookKey);
            return url ? { webhookUrl: url } : {};
          })()),
      ...(row.lastWebhookAt ? { lastWebhookAt: row.lastWebhookAt.toISOString() } : {}),
    },
    updatedAt: row.updatedAt.toISOString(),
  };
};

/**
 * Registra um problema da conexão (token inválido, conta bloqueada).
 *
 * Só erros que pedem ação de alguém mudam o status. Um contato que bloqueou a
 * empresa não é defeito da caixa.
 */
export const markCloudConnectionError = async (
  inboxId: string,
  message: string,
  options: { readonly status?: 'erro' | 'pendente_registro' } = {},
): Promise<void> => {
  await prisma.whatsAppCloudConnection
    .updateMany({
      where: { inboxId, status: { not: 'desconectado' } },
      data: {
        lastError: message.slice(0, 500),
        ...(options.status ? { status: options.status } : {}),
      },
    })
    .catch(() => undefined);
  if (options.status) {
    await prisma.inbox
      .updateMany({
        where: { id: inboxId },
        data: { status: 'desconectado' },
      })
      .catch(() => undefined);
    invalidateCloudCaches(inboxId);
  }
};
