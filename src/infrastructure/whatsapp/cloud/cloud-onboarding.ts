import { randomInt } from 'node:crypto';

import { asJson, prisma } from '@/infrastructure/db/prisma';
import {
  cloudWebhookUrl,
  hashVerifyToken,
  invalidateCloudCaches,
  loadCloudConnection,
  newVerifyToken,
  newWebhookKey,
  sealCloudSecret,
  type CloudConnection,
} from './cloud-connection';
import { CloudApiError, graphRequest } from './graph-client';

/**
 * Conectar, testar e desconectar uma caixa da API oficial.
 *
 * Tudo que fala com a Meta para **montar** a conexão mora aqui; o que fala para
 * **usar** a conexão (enviar, receber) mora em `cloud-sender` e no processador.
 */

interface PhoneNumberInfo {
  readonly id?: string;
  readonly display_phone_number?: string;
  readonly verified_name?: string;
  readonly quality_rating?: string;
  readonly platform_type?: string;
  readonly code_verification_status?: string;
  readonly whatsapp_business_manager_messaging_limit?: string;
}

const CAMPOS_DO_NUMERO =
  'id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status,whatsapp_business_manager_messaging_limit';

const lerNumero = (phoneNumberId: string, token: string) =>
  graphRequest<PhoneNumberInfo>({
    path: phoneNumberId,
    token,
    query: { fields: CAMPOS_DO_NUMERO },
  });

const soDigitos = (valor: string): string => valor.replace(/\D/g, '');

const numeroE164 = (display: string | undefined): string => {
  const digitos = soDigitos(display ?? '');
  return digitos ? `+${digitos}` : '';
};

/** O número está registrado na Cloud API? Sem isso, a Meta não entrega nem recebe. */
const estaNaCloudApi = (info: PhoneNumberInfo): boolean =>
  (info.platform_type ?? '').toUpperCase() === 'CLOUD_API';

const registrar = async (phoneNumberId: string, token: string, pin: string): Promise<void> => {
  await graphRequest({
    path: `${phoneNumberId}/register`,
    token,
    json: { messaging_product: 'whatsapp', pin },
  });
};

const inscreverApp = async (wabaId: string, token: string): Promise<void> => {
  await graphRequest({ path: `${wabaId}/subscribed_apps`, token, method: 'POST' });
};

/** Um número oficial pertence a uma caixa só, em todo o sistema. */
const conferirNumeroLivre = async (phoneNumberId: string, inboxId: string): Promise<void> => {
  // tenant-ok: a unicidade do número é global de propósito; a resposta não revela a outra conta.
  const outro = await prisma.whatsAppCloudConnection.findFirst({
    where: { phoneNumberId, inboxId: { not: inboxId }, status: { not: 'desconectado' } },
    select: { inboxId: true },
  });
  if (outro) {
    throw new CloudApiError({
      message: 'Este número oficial já está conectado a outra caixa de entrada.',
    });
  }
};

export interface ConnectResult {
  readonly displayPhoneNumber: string;
  readonly verifiedName?: string;
  /** Só na primeira conexão (ou ao gerar outro): a tela mostra uma vez. */
  readonly verifyToken?: string;
  readonly webhookUrl?: string;
  readonly registered: boolean;
}

interface SaveInput {
  readonly accountId: string;
  readonly inboxId: string;
  readonly userId: string;
  readonly mode: 'manual' | 'embedded_signup';
  readonly coexistence: boolean;
  readonly businessId?: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly info: PhoneNumberInfo;
  readonly token: string;
  readonly appId?: string;
  readonly appSecret?: string;
  readonly pin?: string;
  readonly registered: boolean;
  readonly regenerateVerifyToken?: boolean;
}

/** O Prisma pede `Uint8Array` sobre `ArrayBuffer`; o `Buffer` do Node pode não ser. */
const bytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => Uint8Array.from(buffer);

const salvarConexao = async (input: SaveInput): Promise<ConnectResult> => {
  const anterior = await prisma.whatsAppCloudConnection.findFirst({
    where: { inboxId: input.inboxId },
    select: { webhookKey: true, verifyTokenHash: true, phoneNumberId: true, status: true },
  });

  // Reconectar o mesmo número mantém a URL e o verify token que já estão no
  // painel da Meta. Trocar de número, ou pedir, gera outros.
  const reaproveita =
    anterior && anterior.phoneNumberId === input.phoneNumberId && !input.regenerateVerifyToken;
  const verifyToken = reaproveita ? undefined : newVerifyToken();
  const webhookKey = reaproveita ? anterior.webhookKey : newWebhookKey();
  const verifyTokenHash = reaproveita
    ? anterior.verifyTokenHash
    : hashVerifyToken(
        input.mode === 'embedded_signup' && process.env.META_WEBHOOK_VERIFY_TOKEN
          ? process.env.META_WEBHOOK_VERIFY_TOKEN
          : (verifyToken ?? newVerifyToken()),
      );

  const token = sealCloudSecret(input.inboxId, 'token', input.token);
  const secret = input.appSecret
    ? sealCloudSecret(input.inboxId, 'app_secret', input.appSecret)
    : null;
  const pin = input.pin ? sealCloudSecret(input.inboxId, 'pin', input.pin) : null;
  const displayPhoneNumber = numeroE164(input.info.display_phone_number) || input.phoneNumberId;
  const agora = new Date();

  const dados = {
    accountId: input.accountId,
    mode: input.mode,
    coexistence: input.coexistence,
    businessId: input.businessId ?? null,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber,
    verifiedName: input.info.verified_name ?? null,
    qualityRating: input.info.quality_rating ?? null,
    messagingLimit: input.info.whatsapp_business_manager_messaging_limit ?? null,
    status: 'conectado',
    lastError: null,
    tokenCipher: bytes(token.cipher),
    tokenIv: bytes(token.iv),
    tokenTag: bytes(token.tag),
    tokenKeyId: token.keyId,
    appId: input.appId ?? null,
    appSecretCipher: secret ? bytes(secret.cipher) : null,
    appSecretIv: secret ? bytes(secret.iv) : null,
    appSecretTag: secret ? bytes(secret.tag) : null,
    appSecretKeyId: secret?.keyId ?? null,
    ...(pin
      ? {
          pinCipher: bytes(pin.cipher),
          pinIv: bytes(pin.iv),
          pinTag: bytes(pin.tag),
          pinKeyId: pin.keyId,
        }
      : {}),
    webhookKey,
    verifyTokenHash,
    subscribedAt: agora,
    ...(input.registered ? { registeredAt: agora } : {}),
    connectedByUserId: input.userId,
  };

  await prisma.$transaction([
    prisma.whatsAppCloudConnection.upsert({
      where: { inboxId: input.inboxId },
      create: { inboxId: input.inboxId, ...dados },
      update: dados,
    }),
    prisma.inbox.updateMany({
      where: { id: input.inboxId, accountId: input.accountId },
      data: { provider: 'cloud_api', status: 'conectado', identifier: displayPhoneNumber },
    }),
  ]);
  invalidateCloudCaches(input.inboxId);

  const webhookUrl =
    input.mode === 'manual' ? cloudWebhookUrl(webhookKey) : cloudWebhookUrl(undefined);
  return {
    displayPhoneNumber,
    ...(input.info.verified_name ? { verifiedName: input.info.verified_name } : {}),
    ...(verifyToken && input.mode === 'manual' ? { verifyToken } : {}),
    ...(webhookUrl ? { webhookUrl } : {}),
    registered: input.registered,
  };
};

export interface ManualConnectInput {
  readonly accountId: string;
  readonly inboxId: string;
  readonly userId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly accessToken: string;
  readonly appSecret: string;
  readonly appId?: string;
  readonly pin?: string;
  readonly regenerateVerifyToken?: boolean;
}

/**
 * Modo manual: a empresa tem o próprio app na Meta e informa os dados dele.
 *
 * A ordem das checagens é a ordem em que um erro de digitação apareceria: o
 * token enxerga o número? o número é daquela conta do WhatsApp? está
 * registrado? Cada uma para com uma frase que diz o que corrigir.
 */
export const connectManual = async (input: ManualConnectInput): Promise<ConnectResult> => {
  const phoneNumberId = soDigitos(input.phoneNumberId);
  const wabaId = soDigitos(input.wabaId);
  if (phoneNumberId.length < 5 || wabaId.length < 5) {
    throw new CloudApiError({
      message: 'Informe o ID do número e o ID da conta do WhatsApp Business.',
    });
  }
  if (input.accessToken.trim().length < 20) {
    throw new CloudApiError({
      message: 'Informe o token de acesso permanente do usuário do sistema.',
    });
  }
  if (!/^[0-9a-f]{32}$/i.test(input.appSecret.trim())) {
    throw new CloudApiError({
      message: 'A chave secreta do app tem 32 caracteres (Configurações do app › Básico).',
    });
  }

  await conferirNumeroLivre(phoneNumberId, input.inboxId);
  const token = input.accessToken.trim();

  const info = await lerNumero(phoneNumberId, token);

  const numeros = await graphRequest<{ readonly data?: readonly { readonly id?: string }[] }>({
    path: `${wabaId}/phone_numbers`,
    token,
    query: { fields: 'id', limit: 100 },
  });
  if (!numeros.data?.some((numero) => numero.id === phoneNumberId)) {
    throw new CloudApiError({
      message: 'Este número não pertence à conta do WhatsApp Business informada.',
    });
  }

  let registered = estaNaCloudApi(info);
  const pin = input.pin?.trim();
  if (!registered) {
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw new CloudApiError({
        message:
          'O número ainda não está registrado na API oficial. Informe o PIN de 6 dígitos da verificação em duas etapas.',
      });
    }
    await registrar(phoneNumberId, token, pin);
    registered = true;
  }

  await inscreverApp(wabaId, token);

  return salvarConexao({
    accountId: input.accountId,
    inboxId: input.inboxId,
    userId: input.userId,
    mode: 'manual',
    coexistence: false,
    wabaId,
    phoneNumberId,
    info,
    token,
    appSecret: input.appSecret.trim(),
    ...(input.appId?.trim() ? { appId: input.appId.trim() } : {}),
    ...(pin ? { pin } : {}),
    registered,
    ...(input.regenerateVerifyToken ? { regenerateVerifyToken: true } : {}),
  });
};

export interface EmbeddedSignupInput {
  readonly accountId: string;
  readonly inboxId: string;
  readonly userId: string;
  readonly code: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly businessId?: string;
  readonly event: string;
}

export const embeddedSignupConfigured = (): boolean =>
  Boolean(
    process.env.META_APP_ID?.trim() &&
    process.env.META_APP_SECRET?.trim() &&
    process.env.META_ES_CONFIG_ID?.trim(),
  );

/**
 * Embedded Signup: a Solint como Tech Provider, com o popup oficial da Meta.
 *
 * O código do popup vale 30 segundos, então a troca por token é a primeira
 * coisa, sem fila. Na coexistência (o cliente continua usando o app WhatsApp
 * Business) o número já está registrado e não recebe PIN; em troca, contatos e
 * histórico precisam ser pedidos em até 24 h, uma vez só.
 */
export const connectEmbeddedSignup = async (input: EmbeddedSignupInput): Promise<ConnectResult> => {
  if (!embeddedSignupConfigured()) {
    throw new CloudApiError({ message: 'O cadastro incorporado da Meta não está configurado.' });
  }
  const phoneNumberId = soDigitos(input.phoneNumberId);
  const wabaId = soDigitos(input.wabaId);
  if (!input.code || !phoneNumberId || !wabaId) {
    throw new CloudApiError({ message: 'O cadastro da Meta não devolveu os dados do número.' });
  }
  await conferirNumeroLivre(phoneNumberId, input.inboxId);

  const troca = await graphRequest<{ readonly access_token?: string }>({
    path: 'oauth/access_token',
    query: {
      client_id: process.env.META_APP_ID?.trim(),
      client_secret: process.env.META_APP_SECRET?.trim(),
      code: input.code,
    },
  });
  const token = troca.access_token;
  if (!token) throw new CloudApiError({ message: 'A Meta não devolveu o token da empresa.' });

  const coexistence = input.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
  await inscreverApp(wabaId, token);
  const info = await lerNumero(phoneNumberId, token);

  let registered = estaNaCloudApi(info) || coexistence;
  let pin: string | undefined;
  if (!registered) {
    pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await registrar(phoneNumberId, token, pin);
    registered = true;
  }

  const resultado = await salvarConexao({
    accountId: input.accountId,
    inboxId: input.inboxId,
    userId: input.userId,
    mode: 'embedded_signup',
    coexistence,
    ...(input.businessId ? { businessId: soDigitos(input.businessId) } : {}),
    wabaId,
    phoneNumberId,
    info,
    token,
    ...(pin ? { pin } : {}),
    registered,
  });

  if (coexistence) {
    const conn = await loadCloudConnection(input.inboxId);
    if (conn) await requestCoexistenceSync(conn);
  }
  return resultado;
};

/**
 * Pede à Meta os contatos e o histórico do app (coexistência).
 *
 * A data é gravada **antes** da chamada: a Meta aceita cada pedido uma vez por
 * onboarding, e uma segunda tentativa depois de uma resposta perdida seria
 * recusada — melhor saber que já foi pedido.
 */
export const requestCoexistenceSync = async (conn: CloudConnection): Promise<void> => {
  for (const [syncType, coluna] of [
    ['smb_app_state_sync', 'contactsSyncAt'],
    ['history', 'historySyncAt'],
  ] as const) {
    const { count } = await prisma.whatsAppCloudConnection.updateMany({
      where: { inboxId: conn.inboxId, [coluna]: null },
      data: { [coluna]: new Date() },
    });
    if (count === 0) continue;
    try {
      await graphRequest({
        path: `${conn.phoneNumberId}/smb_app_data`,
        token: conn.token,
        json: { messaging_product: 'whatsapp', sync_type: syncType },
      });
    } catch (error) {
      console.warn(`[cloud] Pedido de sincronização ${syncType} recusado:`, error);
    }
  }
};

/** Testa a conexão e atualiza qualidade, limite e nome. */
export const testCloudConnection = async (
  accountId: string,
  inboxId: string,
): Promise<{
  readonly qualityRating?: string;
  readonly messagingLimit?: string;
  readonly verifiedName?: string;
}> => {
  const conn = await loadCloudConnection(inboxId);
  if (!conn || conn.accountId !== accountId) {
    throw new CloudApiError({ message: 'Esta caixa não está conectada pela API oficial.' });
  }
  const info = await lerNumero(conn.phoneNumberId, conn.token);
  await prisma.whatsAppCloudConnection.updateMany({
    where: { inboxId, accountId },
    data: {
      qualityRating: info.quality_rating ?? null,
      messagingLimit: info.whatsapp_business_manager_messaging_limit ?? null,
      verifiedName: info.verified_name ?? null,
      ...(conn.status === 'erro' ? { status: 'conectado', lastError: null } : {}),
    },
  });
  if (conn.status === 'erro') {
    await prisma.inbox.updateMany({
      where: { id: inboxId, accountId },
      data: { status: 'conectado' },
    });
  }
  invalidateCloudCaches(inboxId);
  return {
    ...(info.quality_rating ? { qualityRating: info.quality_rating } : {}),
    ...(info.whatsapp_business_manager_messaging_limit
      ? { messagingLimit: info.whatsapp_business_manager_messaging_limit }
      : {}),
    ...(info.verified_name ? { verifiedName: info.verified_name } : {}),
  };
};

/**
 * Desliga a API oficial da caixa.
 *
 * Apaga a linha — e com ela token, secret e PIN — e devolve a caixa ao QR Code.
 * Não desregistra o número na Meta: isso é irreversível para o cliente e não é
 * o que "desconectar do CRM" quer dizer.
 */
export const disconnectCloudInbox = async (accountId: string, inboxId: string): Promise<void> => {
  await prisma.$transaction([
    prisma.whatsAppCloudConnection.deleteMany({ where: { inboxId, accountId } }),
    prisma.inbox.updateMany({
      where: { id: inboxId, accountId },
      data: { provider: 'baileys', status: 'desconectado' },
    }),
  ]);
  invalidateCloudCaches(inboxId);
};

/* ------------------------------------------------------------------ templates */

interface MetaTemplateComponent {
  readonly type?: string;
  readonly format?: string;
  readonly text?: string;
  readonly buttons?: readonly Record<string, unknown>[];
}

interface MetaTemplate {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly category?: string;
  readonly language?: string;
  readonly components?: readonly MetaTemplateComponent[];
}

const STATUS_DA_META: Readonly<Record<string, string>> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
  IN_APPEAL: 'pending',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  LIMIT_EXCEEDED: 'disabled',
};

const variaveisDo = (texto: string): string[] => [
  ...new Set([...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => `Variável ${m[1]}`)),
];

/** Traz os templates da conta do WhatsApp Business para o CRM. */
export const syncCloudTemplates = async (
  accountId: string,
  inboxId: string,
): Promise<{ readonly total: number }> => {
  const conn = await loadCloudConnection(inboxId);
  if (!conn || conn.accountId !== accountId) {
    throw new CloudApiError({ message: 'Esta caixa não está conectada pela API oficial.' });
  }

  let total = 0;
  let proxima: string | undefined = `${conn.wabaId}/message_templates`;
  let primeira = true;
  // Teto de páginas: uma conta com milhares de templates não pode travar a tela.
  for (let pagina = 0; proxima && pagina < 20; pagina += 1) {
    const resposta: {
      readonly data?: readonly MetaTemplate[];
      readonly paging?: { readonly next?: string };
    } = await graphRequest({
      path: proxima,
      token: conn.token,
      ...(primeira
        ? { query: { fields: 'id,name,status,category,language,components', limit: 100 } }
        : {}),
    });
    primeira = false;

    for (const tpl of resposta.data ?? []) {
      if (!tpl.name || !tpl.language) continue;
      const corpo = tpl.components?.find((c) => c.type === 'BODY')?.text ?? '';
      const cabecalho = tpl.components?.find((c) => c.type === 'HEADER');
      const rodape = tpl.components?.find((c) => c.type === 'FOOTER')?.text;
      const botoes = tpl.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
      const dados = {
        category: (tpl.category ?? 'UTILITY').toLowerCase(),
        body: corpo,
        headerType: cabecalho?.format?.toLowerCase() ?? null,
        headerContent: cabecalho?.text ?? null,
        footer: rodape ?? null,
        buttons: asJson(botoes),
        variables: asJson(variaveisDo(corpo)),
        status: STATUS_DA_META[(tpl.status ?? '').toUpperCase()] ?? 'pending',
        externalTemplateId: tpl.id ?? null,
        wabaId: conn.wabaId,
      };
      await prisma.messageTemplate.upsert({
        where: { accountId_name_language: { accountId, name: tpl.name, language: tpl.language } },
        create: { accountId, name: tpl.name, language: tpl.language, ...dados },
        update: dados,
      });
      total += 1;
    }
    proxima = resposta.paging?.next;
  }
  return { total };
};

export interface CreateTemplateInput {
  readonly name: string;
  readonly category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  readonly language: string;
  readonly body: string;
  /** Exemplo de cada variável `{{n}}`, exigido pela Meta para aprovar. */
  readonly examples: readonly string[];
}

/** Cria o template na Meta. Ele nasce `pending` e o webhook traz a aprovação. */
export const createCloudTemplate = async (
  accountId: string,
  inboxId: string,
  input: CreateTemplateInput,
): Promise<{ readonly status: string }> => {
  const conn = await loadCloudConnection(inboxId);
  if (!conn || conn.accountId !== accountId) {
    throw new CloudApiError({ message: 'Esta caixa não está conectada pela API oficial.' });
  }
  const nome = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  const variaveis = variaveisDo(input.body);
  const body: Record<string, unknown> = { type: 'BODY', text: input.body };
  if (variaveis.length > 0) {
    body['example'] = {
      body_text: [variaveis.map((_, i) => input.examples[i] ?? `exemplo ${i + 1}`)],
    };
  }

  const resposta = await graphRequest<{ readonly id?: string; readonly status?: string }>({
    path: `${conn.wabaId}/message_templates`,
    token: conn.token,
    json: { name: nome, category: input.category, language: input.language, components: [body] },
  });
  const status = STATUS_DA_META[(resposta.status ?? '').toUpperCase()] ?? 'pending';

  const dados = {
    category: input.category.toLowerCase(),
    body: input.body,
    variables: asJson(variaveis),
    status,
    externalTemplateId: resposta.id ?? null,
    wabaId: conn.wabaId,
  };
  await prisma.messageTemplate.upsert({
    where: { accountId_name_language: { accountId, name: nome, language: input.language } },
    create: { accountId, name: nome, language: input.language, ...dados },
    update: dados,
  });
  return { status };
};

export type { CloudConnection };
