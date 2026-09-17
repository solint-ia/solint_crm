/**
 * Como uma caixa de WhatsApp fala com o WhatsApp.
 *
 * `baileys` é a conexão por QR Code, como aparelho conectado (WhatsApp Web).
 * `cloud_api` é o número oficial cadastrado na Meta, pela Cloud API.
 *
 * O provedor é da **caixa**, não da conta: a mesma conta pode ter um número no
 * QR e outro na API oficial. Qualquer outro valor gravado em `Inbox.provider`
 * (linhas antigas com `evolution`, `nativo`) é tratado como Baileys, que é o
 * único motor que existia quando elas foram gravadas.
 */
export type WhatsAppProvider = 'baileys' | 'cloud_api';

export const whatsappProviderOf = (provider: string | null | undefined): WhatsAppProvider =>
  provider === 'cloud_api' ? 'cloud_api' : 'baileys';

export const WHATSAPP_PROVIDER_LABELS: Readonly<Record<WhatsAppProvider, string>> = {
  baileys: 'QR Code',
  cloud_api: 'API oficial',
};

/**
 * O que cada provedor sabe fazer.
 *
 * Num lugar só, e lido pela tela e pelos casos de uso. Espalhar `provider ===
 * 'cloud_api'` pelos componentes é como um botão que falha fica visível numa
 * tela e escondido na outra.
 */
export interface WhatsAppCapabilities {
  /** Texto livre só dentro da janela de 24 h desde a última mensagem do cliente. */
  readonly freeTextWindow: boolean;
  /** Envio de template aprovado pela Meta. */
  readonly templates: boolean;
  readonly groups: boolean;
  /** Apagar a mensagem também no aparelho do contato. */
  readonly deleteForEveryone: boolean;
  readonly reactions: boolean;
  readonly quotes: boolean;
  /** "Gravando áudio"; a API oficial só tem "digitando". */
  readonly recordingPresence: boolean;
  /** Teto do indicador de digitação, em milissegundos. */
  readonly typingMaxMs: number;
  readonly contactPhotos: boolean;
  /** Sincronizar grupos e agenda a pedido. */
  readonly manualSync: boolean;
}

export const WHATSAPP_CAPABILITIES: Readonly<Record<WhatsAppProvider, WhatsAppCapabilities>> = {
  baileys: {
    freeTextWindow: false,
    templates: false,
    groups: true,
    deleteForEveryone: true,
    reactions: true,
    quotes: true,
    recordingPresence: true,
    typingMaxMs: 6_000,
    contactPhotos: true,
    manualSync: true,
  },
  cloud_api: {
    freeTextWindow: true,
    templates: true,
    groups: false,
    deleteForEveryone: false,
    reactions: true,
    quotes: true,
    recordingPresence: false,
    // A Meta dispensa o indicador sozinha depois de ~25 s.
    typingMaxMs: 25_000,
    contactPhotos: false,
    manualSync: false,
  },
};

export const capabilitiesOf = (provider: string | null | undefined): WhatsAppCapabilities =>
  WHATSAPP_CAPABILITIES[whatsappProviderOf(provider)];

/** Janela de atendimento da Meta, em horas. */
export const CUSTOMER_SERVICE_WINDOW_HOURS = 24;

/**
 * A janela de atendimento da API oficial está aberta?
 *
 * Ela abre quando o **cliente** escreve e fecha 24 h depois. Sem mensagem do
 * cliente, não há janela: a conversa começada pela empresa só abre com template.
 */
export const isCustomerServiceWindowOpen = (
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!lastInboundAt) return false;
  const at = Date.parse(lastInboundAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < CUSTOMER_SERVICE_WINDOW_HOURS * 3_600_000;
};
