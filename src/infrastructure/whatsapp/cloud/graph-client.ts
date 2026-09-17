/**
 * Cliente mínimo da Graph API da Meta, usado pela API oficial do WhatsApp.
 *
 * Sem SDK de propósito: a superfície que o CRM usa são meia dúzia de rotas, e um
 * pacote a mais seria mais uma coisa a manter atualizada junto com a versão da
 * API, que muda duas vezes por ano.
 *
 * O token chega por parâmetro em toda chamada, nunca de uma variável global:
 * cada caixa tem o seu, e um token "padrão" à mão é como uma mensagem sai pelo
 * número de outro cliente.
 */

const DEFAULT_GRAPH_VERSION = 'v25.0';
const TIMEOUT_MS = 10_000;

export const graphVersion = (): string => {
  const configured = process.env.META_GRAPH_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_VERSION;
};

export const graphBaseUrl = (): string => `https://graph.facebook.com/${graphVersion()}`;

/**
 * Mensagem em português para os erros que alguém do atendimento vai ler.
 *
 * `retentavel` só é verdadeiro quando a Meta garante que a mensagem **não**
 * saiu. Um timeout não entra: a resposta pode ter se perdido depois do envio, e
 * a Cloud API não tem chave de idempotência — repetir duplicaria a mensagem no
 * aparelho do cliente.
 */
const ERROS_CONHECIDOS: Readonly<Record<number, { mensagem: string; retentavel: boolean }>> = {
  131047: {
    mensagem:
      'Janela de 24 h encerrada: o cliente não escreve há mais de um dia. Envie um template aprovado.',
    retentavel: false,
  },
  131026: {
    mensagem:
      'Mensagem não entregue: o número não tem WhatsApp, bloqueou a empresa ou usa uma versão antiga.',
    retentavel: false,
  },
  131049: {
    mensagem: 'A Meta segurou esta mensagem de marketing para não sobrecarregar o cliente.',
    retentavel: false,
  },
  131056: {
    mensagem: 'Muitas mensagens seguidas para o mesmo contato. Aguarde alguns segundos.',
    retentavel: true,
  },
  130429: { mensagem: 'Limite de envio do número atingido. Tente em instantes.', retentavel: true },
  131051: { mensagem: 'Tipo de mensagem não suportado pela API oficial.', retentavel: false },
  131052: { mensagem: 'Não foi possível baixar a mídia enviada pelo cliente.', retentavel: true },
  131053: {
    mensagem: 'A Meta recusou o arquivo (formato ou tamanho fora do permitido).',
    retentavel: false,
  },
  131042: {
    mensagem:
      'Problema de pagamento na conta da Meta. Confira a forma de pagamento no WhatsApp Manager.',
    retentavel: false,
  },
  131031: { mensagem: 'A conta do WhatsApp Business foi bloqueada pela Meta.', retentavel: false },
  131045: { mensagem: 'Número não registrado na API oficial.', retentavel: false },
  133010: { mensagem: 'Número não registrado na API oficial.', retentavel: false },
  190: {
    mensagem: 'Token de acesso inválido ou expirado. Reconecte a API oficial desta caixa.',
    retentavel: false,
  },
  200: {
    mensagem:
      'O token não tem permissão para este número. Confira as permissões do usuário do sistema.',
    retentavel: false,
  },
  368: {
    mensagem: 'Número bloqueado temporariamente pela Meta por violação de política.',
    retentavel: false,
  },
  132000: {
    mensagem: 'Os valores do template não batem com as variáveis aprovadas.',
    retentavel: false,
  },
  132001: {
    mensagem: 'Template não encontrado na Meta para este idioma.',
    retentavel: false,
  },
  132015: { mensagem: 'Template pausado pela Meta por baixa qualidade.', retentavel: false },
  132016: { mensagem: 'Template desativado pela Meta por baixa qualidade.', retentavel: false },
  4: { mensagem: 'Limite de chamadas da Meta atingido. Tente em instantes.', retentavel: true },
  80007: { mensagem: 'Limite de chamadas da Meta atingido. Tente em instantes.', retentavel: true },
};

export class CloudApiError extends Error {
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly httpStatus: number | undefined;
  readonly retentavel: boolean;

  constructor(input: {
    readonly message: string;
    readonly code?: number;
    readonly subcode?: number;
    readonly httpStatus?: number;
    readonly retentavel?: boolean;
  }) {
    super(input.message);
    this.name = 'CloudApiError';
    this.code = input.code;
    this.subcode = input.subcode;
    this.httpStatus = input.httpStatus;
    this.retentavel = input.retentavel ?? false;
  }

  /** O token não presta mais: a caixa precisa ser reconectada. */
  get tokenInvalido(): boolean {
    return this.code === 190;
  }
}

interface GraphErrorBody {
  readonly error?: {
    readonly message?: string;
    readonly code?: number;
    readonly error_subcode?: number;
    readonly error_data?: { readonly details?: string };
  };
}

/** Tokens nunca aparecem em log, nem dentro de uma mensagem de erro repassada. */
export const redactSecrets = (texto: string): string =>
  texto
    .replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA…')
    .replace(/access_token=[^&\s"]+/gi, 'access_token=…')
    .replace(/client_secret=[^&\s"]+/gi, 'client_secret=…');

/** Traduz o corpo de erro da Graph API. Pura, para poder ser testada. */
export const cloudApiErrorFrom = (httpStatus: number, body: unknown): CloudApiError => {
  const erro = (body as GraphErrorBody | null)?.error;
  const code = typeof erro?.code === 'number' ? erro.code : undefined;
  const conhecido = code !== undefined ? ERROS_CONHECIDOS[code] : undefined;
  const detalhe = erro?.error_data?.details ?? erro?.message ?? `HTTP ${httpStatus}`;
  return new CloudApiError({
    message: conhecido?.mensagem ?? `A Meta recusou a operação: ${redactSecrets(detalhe)}`,
    ...(code !== undefined ? { code } : {}),
    ...(typeof erro?.error_subcode === 'number' ? { subcode: erro.error_subcode } : {}),
    httpStatus,
    retentavel: conhecido?.retentavel ?? httpStatus >= 500,
  });
};

/** Mensagem de erro de um `errors[]` de status de entrega (webhook). */
export const deliveryErrorMessage = (
  errors:
    | readonly { readonly code?: number; readonly title?: string; readonly message?: string }[]
    | undefined,
): string => {
  const primeiro = errors?.[0];
  if (!primeiro) return 'A Meta não conseguiu entregar a mensagem.';
  const conhecido = primeiro.code !== undefined ? ERROS_CONHECIDOS[primeiro.code] : undefined;
  return (
    conhecido?.mensagem ??
    `Não entregue: ${primeiro.title ?? primeiro.message ?? `erro ${primeiro.code ?? 'desconhecido'}`}`
  );
};

export interface GraphRequest {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  /** Caminho depois da versão, com ou sem barra inicial. Ou URL absoluta. */
  readonly path: string;
  readonly token?: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly json?: unknown;
  readonly form?: FormData;
  readonly timeoutMs?: number;
}

/**
 * Uma chamada à Graph API. Lança `CloudApiError` em qualquer recusa.
 *
 * `fetch` é lido na hora da chamada, e não capturado no carregamento: é o que
 * permite ao teste trocar a Meta por um servidor falso sem mexer neste arquivo.
 */
export const graphRequest = async <T = unknown>(request: GraphRequest): Promise<T> => {
  const base = process.env.META_GRAPH_BASE_URL?.trim() || graphBaseUrl();
  const url = new URL(
    /^https?:\/\//.test(request.path)
      ? request.path
      : `${base.replace(/\/$/, '')}/${request.path.replace(/^\//, '')}`,
  );
  for (const [chave, valor] of Object.entries(request.query ?? {})) {
    if (valor !== undefined) url.searchParams.set(chave, String(valor));
  }

  const headers: Record<string, string> = {};
  if (request.token) headers['Authorization'] = `Bearer ${request.token}`;
  let body: BodyInit | undefined;
  if (request.form) {
    body = request.form;
  } else if (request.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(request.json);
  }

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: request.method ?? (body ? 'POST' : 'GET'),
      headers,
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(request.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'falha de rede';
    throw new CloudApiError({
      message: `Sem resposta da Meta (${redactSecrets(motivo)}).`,
      retentavel: false,
    });
  }

  const texto = await resposta.text();
  let dados: unknown = undefined;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = undefined;
    }
  }

  if (!resposta.ok) throw cloudApiErrorFrom(resposta.status, dados);
  return dados as T;
};

/** Baixa bytes de uma URL da Meta (mídia), que exige o mesmo token. */
export const graphDownload = async (
  url: string,
  token: string,
  maxBytes: number,
): Promise<{ readonly bytes: Buffer; readonly mimeType: string | undefined }> => {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new CloudApiError({
      message: `Falha ao baixar a mídia da Meta (${error instanceof Error ? error.message : 'rede'}).`,
      retentavel: true,
    });
  }
  if (!resposta.ok) {
    throw new CloudApiError({
      message: `A Meta recusou o download da mídia (HTTP ${resposta.status}).`,
      httpStatus: resposta.status,
      retentavel: resposta.status >= 500,
    });
  }
  const declarado = Number(resposta.headers.get('content-length') ?? '0');
  if (declarado > maxBytes) {
    throw new CloudApiError({ message: 'Mídia maior que o limite aceito.', retentavel: false });
  }
  const bytes = Buffer.from(await resposta.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new CloudApiError({ message: 'Mídia maior que o limite aceito.', retentavel: false });
  }
  return { bytes, mimeType: resposta.headers.get('content-type') ?? undefined };
};
