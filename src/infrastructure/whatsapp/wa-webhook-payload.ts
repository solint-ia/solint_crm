import {
  getContentType,
  getDevice,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
} from '@whiskeysockets/baileys';

import type {
  SolintRefs,
  WebhookPayloadEmMontagem,
} from '@/infrastructure/webhooks/webhook-dispatch';

/**
 * Tradução da mensagem crua do WhatsApp para o corpo entregue aos webhooks.
 *
 * **Por que a mensagem crua, e não o modelo do domínio.** O corpo entregue
 * antes era montado a partir de `Message` — o modelo que as telas usam — e por
 * isso só sabia dizer o que as telas mostram: um tipo, um texto, um caminho de
 * mídia. Tudo que o WhatsApp manda junto e que uma automação precisa (a citação
 * respondida, o anúncio que originou a conversa, o `ptt` que distingue áudio
 * gravado de arquivo de áudio, o aparelho de origem) se perdia na tradução,
 * porque o modelo do domínio não tem onde guardar.
 *
 * A `WAMessage` do Baileys **já é** a estrutura que quem integra espera. O
 * trabalho aqui não é remontá-la campo a campo — é repassá-la limpa. É o que
 * faz áudio, resposta citada, figurinha, localização, enquete e o próximo tipo
 * que o WhatsApp inventar chegarem do outro lado sem ninguém ter enumerado cada
 * um.
 *
 * **Este módulo importa o Baileys; o despachante não.** `webhook-dispatch` é
 * alcançado por código do site (via `wa-store`), e arrastar o Baileys para lá o
 * colocaria no pacote do Next. Daí a fronteira: aqui se conhece o protocolo,
 * lá se conhece só o corpo já pronto.
 */

/**
 * Nomes de `proto.WebMessageInfo.Status`, na ordem do enum.
 *
 * O número cru não diz nada a quem monta um fluxo; `DELIVERY_ACK` diz. Um
 * índice fora da faixa devolve `undefined` e o campo simplesmente não vai —
 * melhor ausente do que um nome inventado.
 */
const NOMES_DE_STATUS = [
  'ERROR',
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'PLAYED',
] as const;

export const statusNameOf = (status: number | null | undefined): string | undefined =>
  typeof status === 'number' ? NOMES_DE_STATUS[status] : undefined;

/**
 * Campos descartados pelo nome, e não pela forma.
 *
 * São blocos inteiros de protocolo — chaves de aparelho, segredo da mensagem, o
 * blob de conversão do anúncio. Nada dentro deles serve a uma automação, e
 * todos são grandes. A varredura genérica abaixo também os esvaziaria, mas
 * descartar pelo nome poupa percorrer centenas de bytes um a um em cada
 * mensagem que chega.
 */
const DESCARTADOS = new Set(['messageContextInfo', 'deviceListMetadata', 'conversionData']);

/**
 * Teto de profundidade da varredura.
 *
 * Uma citação de citação aninha de verdade (`quotedMessage` dentro de
 * `contextInfo` dentro de `quotedMessage`), mas nunca perto disto. O limite
 * existe para que um ciclo — que protobuf não deveria produzir, e que custaria
 * o processo inteiro se produzisse — termine em vez de girar.
 */
const PROFUNDIDADE_MAXIMA = 24;

const INDICE = /^\d+$/;

/**
 * O objeto é um Buffer que virou `{"0":80,"1":180,...}`?
 *
 * Esta é a forma que a miniatura, a chave de mídia e os hashes assumem depois
 * de passar por uma serialização. São os "montantes de números" que enchiam o
 * corpo entregue: uma única miniatura de anúncio passa de mil entradas.
 */
const ehSacoDeBytes = (valor: Record<string, unknown>): boolean => {
  const chaves = Object.keys(valor);
  return chaves.length > 0 && chaves.every((chave) => INDICE.test(chave));
};

const ehLong = (
  valor: Record<string, unknown>,
): valor is { low: number; high: number; unsigned?: boolean } =>
  typeof valor.low === 'number' && typeof valor.high === 'number';

/**
 * `Long` do protobuf vira texto, não número.
 *
 * `fileLength` e `mediaKeyTimestamp` passam de 2^53 com folga em arquivo
 * grande, e um `Number` ali perderia dígitos em silêncio.
 */
const longParaTexto = (valor: { low: number; high: number; unsigned?: boolean }): string => {
  const alto = valor.unsigned ? BigInt(valor.high >>> 0) : BigInt(valor.high | 0);
  const baixo = BigInt(valor.low >>> 0);
  return ((alto << 32n) | baixo).toString();
};

/**
 * Varredura recursiva que devolve o valor sem nada que não seja legível.
 *
 * A regra é genérica de propósito. Uma lista fixa de campos binários
 * (`jpegThumbnail`, `mediaKey`, `fileSha256`...) resolveria o que se conhece
 * hoje e perderia em silêncio o próximo que o WhatsApp acrescentar — e o
 * sintoma seria um corpo de webhook inchado que ninguém relaciona com a causa.
 * Reconhecer a **forma** (view tipada, objeto de índices numéricos) cobre os
 * que ainda não existem.
 *
 * `undefined` significa "descarte este campo": nulo e ausente somem em vez de
 * virar `null`, que é como o próprio protobuf serializa quando o campo não veio.
 */
const limpar = (valor: unknown, profundidade = 0): unknown => {
  if (valor === null || valor === undefined) return undefined;
  if (profundidade > PROFUNDIDADE_MAXIMA) return undefined;

  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'function') return undefined;
  if (typeof valor !== 'object') return valor;

  // Buffer, Uint8Array e afins: o "montante de números" na origem.
  if (ArrayBuffer.isView(valor) || valor instanceof ArrayBuffer) return undefined;
  if (valor instanceof Date) return valor.toISOString();

  if (Array.isArray(valor)) {
    return valor.map((item) => limpar(item, profundidade + 1)).filter((item) => item !== undefined);
  }

  const objeto = valor as Record<string, unknown>;
  if (ehLong(objeto)) return longParaTexto(objeto);
  if (ehSacoDeBytes(objeto)) return undefined;

  const saida: Record<string, unknown> = {};
  for (const [chave, bruto] of Object.entries(objeto)) {
    if (DESCARTADOS.has(chave)) continue;
    const limpo = limpar(bruto, profundidade + 1);
    if (limpo !== undefined) saida[chave] = limpo;
  }
  return saida;
};

/** Conteúdo da mensagem sem nenhum campo binário. Exportado para o teste. */
export const sanitizeWaMessage = (
  message: WAMessageContent | null | undefined,
): Record<string, unknown> => (limpar(message) as Record<string, unknown> | undefined) ?? {};

/**
 * O `contextInfo` do conteúdo, elevado para o primeiro nível de `data`.
 *
 * É onde moram a citação respondida (`quotedMessage`), as menções e o anúncio
 * de origem (`externalAdReply`). A busca varre os valores do conteúdo em vez de
 * olhar um tipo específico porque `contextInfo` existe em todo tipo que aceita
 * legenda — procurar só no texto perderia o anúncio de quem clicou e mandou
 * foto.
 *
 * O bloco continua também no lugar original, dentro de `message`: elevar aqui é
 * conveniência, não mudança de endereço.
 */
export const contextInfoOf = (
  message: WAMessageContent | null | undefined,
): Record<string, unknown> | null => {
  if (!message) return null;

  for (const conteudo of Object.values(message)) {
    const contexto = (conteudo as { contextInfo?: unknown } | null | undefined)?.contextInfo;
    if (!contexto || typeof contexto !== 'object') continue;
    const limpo = limpar(contexto);
    if (limpo && typeof limpo === 'object') return limpo as Record<string, unknown>;
  }

  return null;
};

/** Nome do tipo de conteúdo (`conversation`, `audioMessage`, ...). */
export const messageTypeOf = (message: WAMessageContent | null | undefined): string =>
  (message ? getContentType(message) : undefined) ?? 'unknown';

/**
 * O carimbo de tempo em segundos, seja qual for a forma em que ele chegou.
 *
 * `Number()` sozinho não basta. O Baileys entrega um `Long` de verdade, que
 * sabe virar texto e por isso atravessa `Number()` intacto — mas o mesmo valor,
 * depois de qualquer ida e volta por JSON, vira `{low, high, unsigned}` sem
 * método nenhum, e ali `Number()` devolve `NaN`. `NaN` serializa como `null`, e
 * o campo chegaria vazio do outro lado sem nada falhar no meio do caminho.
 */
const segundosDe = (valor: unknown): number => {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'bigint') return Number(valor);
  if (typeof valor === 'string') return Number(valor) || 0;

  if (valor && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    if (ehLong(objeto)) return Number(longParaTexto(objeto)) || 0;
    const convertido = Number(valor);
    if (Number.isFinite(convertido)) return convertido;
  }

  return 0;
};

/** De qual aparelho a mensagem saiu. Id malformado não derruba a entrega. */
const origemDe = (id: string | null | undefined): string => {
  if (!id) return 'unknown';
  try {
    return getDevice(id);
  } catch {
    return 'unknown';
  }
};

/**
 * Teto do que vira base64 dentro do corpo.
 *
 * Um áudio de recado cabe folgado; um vídeo de dois minutos não. O corte existe
 * porque o corpo é entregue com prazo de 5 segundos (`TIMEOUT_MS` no
 * despachante) e um anexo de dezenas de megabytes estoura o prazo antes de o
 * destino ver a primeira linha — e aí a entrega falha inteira, inclusive o
 * texto. Acima do teto vai `data.mediaUrl` no lugar.
 *
 * Base64 cresce ~4/3 sobre o original: 5 MB de arquivo viram ~6,7 MB de corpo.
 */
export const MAX_BASE64_BYTES = Number(
  process.env.WEBHOOK_MEDIA_BASE64_MAX_BYTES ?? 5 * 1024 * 1024,
);

/** A mídia em base64, ou `undefined` quando passou do teto. */
export const base64ParaWebhook = (bytes: Buffer | undefined): string | undefined =>
  bytes && bytes.length > 0 && bytes.length <= MAX_BASE64_BYTES
    ? bytes.toString('base64')
    : undefined;

/**
 * O caminho relativo da mídia virado URL absoluta.
 *
 * `/api/whatsapp/media/<id>` não serve a quem está fora: um fluxo do n8n não
 * tem a origem para completar. Sem `SOLINT_APP_URL` configurada não há como
 * saber qual é o endereço público desta instalação, e devolver um caminho
 * relativo seria pior do que não devolver nada — o destino tentaria baixar de
 * si mesmo. A rota exige `Authorization: Bearer <token da conta>`.
 */
export const mediaUrlAbsoluta = (caminho: string | undefined): string | undefined => {
  const base = process.env.SOLINT_APP_URL?.trim().replace(/\/+$/, '');
  if (!base || !caminho) return undefined;
  return caminho.startsWith('http') ? caminho : `${base}${caminho}`;
};

export interface UpsertPayloadInput {
  readonly raw: WAMessage;
  /** Nome da caixa de entrada — o equivalente da instância. */
  readonly instance: string;
  readonly instanceId: string;
  /** JID do número conectado nesta caixa. */
  readonly sender: string;
  readonly solint: SolintRefs;
  /** Mídia já decifrada, quando coube no teto. */
  readonly base64?: string;
  /** Alternativa absoluta quando o base64 não coube. */
  readonly mediaUrl?: string;
}

/**
 * Monta o corpo do evento, menos o `destination` — que só o despachante sabe,
 * porque é a URL de cada destino inscrito.
 */
export const buildUpsertPayload = (
  entrada: UpsertPayloadInput,
): WebhookPayloadEmMontagem => {
  const { raw } = entrada;

  // Desembrulha `ephemeralMessage`/`viewOnceMessage` pela mesma razão de
  // `decodeWaMessage`: num chat com mensagens temporárias o conteúdo real chega
  // aninhado, e entregá-lo embrulhado faria `data.message.conversation` sumir
  // exatamente nas conversas em que o recurso está ligado.
  const conteudo = normalizeMessageContent(raw.message);

  const message = sanitizeWaMessage(conteudo);
  if (entrada.base64) message.base64 = entrada.base64;

  const status = statusNameOf(raw.status);
  const chave = (limpar(raw.key) as Record<string, unknown> | undefined) ?? {};

  return {
    event: 'messages.upsert',
    instance: entrada.instance,
    data: {
      key: {
        ...chave,
        // Os dois normalizados porque a ausência quebra uma condição do outro
        // lado: `fromMe` ausente é falsy do mesmo jeito que `false`, mas um
        // `Switch` que compare com `false` não casaria.
        fromMe: Boolean(raw.key.fromMe),
        participant: raw.key.participant ?? '',
      },
      ...(raw.pushName ? { pushName: raw.pushName } : {}),
      ...(status ? { status } : {}),
      message,
      contextInfo: contextInfoOf(conteudo),
      messageType: messageTypeOf(conteudo),
      messageTimestamp: segundosDe(raw.messageTimestamp),
      instanceId: entrada.instanceId,
      source: origemDe(raw.key.id),
      ...(entrada.mediaUrl ? { mediaUrl: entrada.mediaUrl } : {}),
    },
    date_time: new Date().toISOString(),
    sender: entrada.sender,
    solint: entrada.solint,
  };
};
