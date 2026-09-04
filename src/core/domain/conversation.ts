import type { Channel } from './channel';
import type { Contact } from './contact';
import type { Label } from './label';
import type { Message, TimelineItem } from './message';
import type { Id, IsoDateTime } from './shared';
import type { InboxAccess } from './user';

export const CONVERSATION_STATUSES = ['aberta', 'pendente', 'resolvida', 'espera'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * Teto de tamanho do id de uma conversa, nas validações de entrada.
 *
 * Não é um limite de banco — `Conversation.id` é `TEXT` — é o guarda que
 * impede um payload absurdo de chegar ao Prisma. Precisa de um número, e o
 * número precisa ser grande o bastante para o pior id que o próprio sistema
 * constrói. A conta:
 *
 *   `cv-wa-`                                        6
 *   `inboxId` (`ibx-` + UUID, o gerador mais longo)  40
 *   `-g-`                                            3
 *   identificador do grupo (`<criador>-<carimbo>`)  ~30
 *   ------------------------------------------------ 79
 *
 * Estava em 64, e o efeito era invisível até alguém abrir um grupo numa caixa
 * criada por Configurações: `cv-wa-ibx-<uuid>-g-<grupo>` dá 67 a 79
 * caracteres, e **toda** ação sobre aquela conversa — enviar, resolver,
 * transferir, etiquetar — era recusada com "dados inválidos", sem dizer qual
 * dado. Nas caixas do cadastro (`ibx-acc-...`, 16 caracteres) o mesmo grupo dá
 * 43-46 e passava, o que fazia o problema parecer um capricho da caixa.
 *
 * 128 e não 79: o teto existe para barrar o absurdo, não para ficar rente ao
 * pior caso de hoje — o WhatsApp já mudou o formato de JID mais de uma vez, e
 * um teto justo voltaria a quebrar em silêncio na próxima mudança.
 */
export const CONVERSATION_ID_MAX_LENGTH = 128;

export const PRIORITIES = ['baixa', 'media', 'alta', 'urgente'] as const;
export type Priority = (typeof PRIORITIES)[number];

export type ProtocolStatus = 'Resolvido' | 'Pendente' | 'Em andamento';

/**
 * Número de atendimento — o código que o cliente cita ao voltar.
 *
 * Uma conversa acumula vários: um por ciclo de atendimento. O de cima da pilha
 * é o corrente enquanto não estiver `'Resolvido'`; resolver a conversa fecha o
 * aberto, e a primeira mensagem depois disso abre outro.
 */
export interface Protocol {
  readonly code: string;
  /** Rótulo curto para a tela ("27 ago."). Nunca use para ordenar. */
  readonly date: string;
  readonly status: ProtocolStatus;
  /**
   * Instante da abertura, em ISO.
   *
   * Opcional porque os protocolos gravados antes desta coluna não o têm, e um
   * `date` como "27 ago." não dá para converter de volta sem inventar o ano.
   */
  readonly openedAt?: IsoDateTime;
}

/**
 * O protocolo em aberto, ou o mais recente quando todos já foram fechados.
 *
 * É o que `{{protocolo}}` resolve. A busca vai do fim para o começo porque o
 * último da lista é sempre o mais novo — é assim que `abrirProtocolo` os
 * empilha.
 */
export const currentProtocol = (protocols: readonly Protocol[]): Protocol | undefined => {
  for (let i = protocols.length - 1; i >= 0; i -= 1) {
    const protocolo = protocols[i];
    if (protocolo && protocolo.status !== 'Resolvido') return protocolo;
  }
  return protocols[protocols.length - 1];
};

/**
 * O código no formato do produto: `#AT-26-000431`.
 *
 * Ano com dois dígitos mais um sequencial de seis, zero à esquerda. O ano entra
 * para o número não crescer para sempre e para a leitura ("é de 2026") ser
 * imediata; o sequencial é por conta, então duas empresas podem ter o mesmo
 * código sem que isso signifique nada — o protocolo só é citado dentro de uma
 * conversa, que já pertence a uma conta.
 */
export const formatProtocolCode = (sequencial: number, quando: Date = new Date()): string => {
  const ano = String(quando.getFullYear()).slice(-2);
  return `#AT-${ano}-${String(sequencial).padStart(6, '0')}`;
};

export interface Conversation {
  readonly id: Id;
  readonly accountId: Id;
  readonly contact: Contact;
  readonly channel: Channel;
  readonly inboxId: Id;
  readonly queue: string;
  readonly status: ConversationStatus;
  readonly statusLabel: string;
  readonly priority: Priority;
  readonly assigneeId?: Id;
  readonly assigneeName?: string;
  readonly unreadCount: number;
  readonly lastMessagePreview: string;
  /** Rotulo de exibicao (ex.: "14:32"). Nunca use para ordenar — use lastActivityAt. */
  readonly lastMessageAt: string;
  /** Instante real da última atividade — unica fonte de ordenacao cronologica. */
  readonly lastActivityAt?: IsoDateTime;
  readonly labels: readonly Label[];
  readonly protocols: readonly Protocol[];
  readonly timeline: readonly TimelineItem[];
  readonly slaDeadlineAt?: IsoDateTime;
  readonly slaLabel?: string;
  readonly slaBreached?: boolean;
  readonly isTyping?: boolean;
  /** Outro agente está com a conversa aberta (prevenção de colisão). */
  readonly collisionAgent?: string;
  /** Última mensagem recebida do contato — base da janela HSM de 24h. */
  readonly lastInboundAt?: IsoDateTime;
  readonly channelOffline?: boolean;
  /**
   * Identificador da thread no provedor do canal (JID do WhatsApp, por exemplo).
   * E o destino canonico de envio: sem ele, responder um grupo ou um contato
   * enderecado por LID quebraria.
   */
  readonly channelThreadId?: string;
  /**
   * Quando a pausa vence sozinha. Ausente na pausa que não vence.
   *
   * Quem diz se o agente está calado é `aiPausedReason`, não este campo: a
   * pausa do botão dura até alguém desfazê-la, e só a que o sistema deduziu
   * sozinho carrega prazo. Ninguém compara a data à mão — `isAiPaused` decide
   * num lugar só, para a tela, o despachante e a rota de envio nunca
   * divergirem.
   */
  readonly aiPausedUntil?: IsoDateTime;
  /** Nome de quem pausou. Ausente quando a pausa foi automática. */
  readonly aiPausedByName?: string;
  readonly aiPausedReason?: AiPauseReason;
}

/**
 * Por que o agente está calado.
 *
 * `manual` é decisão de alguém: clicou em "assumir conversa". Ela não vence —
 * quem assumiu devolve quando terminar. Já `resposta_no_celular` é dedução do
 * sistema: o atendente respondeu pelo app do WhatsApp, onde não existe botão
 * nenhum para clicar, e por isso ela precisa expirar sozinha.
 *
 * É essa diferença que decide se há prazo: pausa que alguém pediu só termina
 * quando alguém disser; pausa que o sistema deduziu não pode durar para sempre
 * por falta de quem a desfaça.
 */
export type AiPauseReason = 'manual' | 'resposta_no_celular';

/**
 * O agente de IA está pausado nesta conversa?
 *
 * A pausa é uma data no futuro, e não um sinalizador: comparar aqui, e não em
 * cada chamador, é o que impede a tela dizer "pausado" enquanto o despachante
 * já voltou a mandar evento — os dois leem a mesma linha, com relógios de
 * processos diferentes.
 */
export const isAiPaused = (
  conversation: Pick<Conversation, 'aiPausedReason' | 'aiPausedUntil'>,
  now: Date = new Date(),
): boolean => {
  if (!conversation.aiPausedReason) return false;
  // Sem prazo é pausa que não vence: alguém clicou em assumir, e só um clique
  // desfaz. Dar validade a ela devolveria o agente à conversa no meio de um
  // atendimento humano, sem ninguém ter pedido — e sem nada avisando.
  if (!conversation.aiPausedUntil) return true;
  return Date.parse(conversation.aiPausedUntil) > now.getTime();
};

/** Ordenacao cronologica confiavel: cai para 0 quando a conversa não tem atividade. */
export const activityTimeOf = (conversation: Pick<Conversation, 'lastActivityAt'>): number =>
  conversation.lastActivityAt ? Date.parse(conversation.lastActivityAt) : 0;

export const HSM_WINDOW_HOURS = 24;

/**
 * Janela de 24h do WhatsApp:
 * No WhatsApp Direto (via Baileys / QR Code), não há restrição de 24h da Meta Cloud API.
 * O atendente pode conversar livremente a qualquer momento.
 */
export const isHsmWindowOpen = (
  _conversation: Pick<Conversation, 'channel' | 'lastInboundAt'>,
  _now: Date = new Date(),
): boolean => true;


/** Filtro rápido da lista de conversas. */
export type InboxScope = 'minhas' | 'nao_atribuidas' | 'todas';

export interface ConversationFilter {
  /**
   * Caixas que quem consulta alcança.
   *
   * **Obrigatório de propósito.** Poderia ser opcional com padrão `'todas'`, e
   * aí bastaria uma chamada distraída para a lista voltar sem restrição — uma
   * falha que não quebra nada, não aparece em teste de uma equipe só, e vaza
   * conversa de outro setor. Sendo obrigatório, o compilador cobra a decisão em
   * cada ponto de leitura.
   */
  readonly inboxAccess: InboxAccess;
  readonly scope: InboxScope;
  readonly status?: ConversationStatus | 'todas';
  readonly search?: string;
  readonly channel?: Channel;
  readonly priority?: Priority;
  readonly labelId?: Id;
  readonly sort?: 'recentes' | 'antigas' | 'prioridade';
}

export const PRIORITY_WEIGHT: Readonly<Record<Priority, number>> = {
  urgente: 4,
  alta: 3,
  media: 2,
  baixa: 1,
};

/** Regras de visibilidade da lista, isoladas do componente (SRP + testabilidade). */
export const matchesScope = (
  conversation: Pick<Conversation, 'assigneeId'>,
  scope: InboxScope,
  currentUserId: Id,
): boolean => {
  if (scope === 'minhas') return conversation.assigneeId === currentUserId;
  if (scope === 'nao_atribuidas') return !conversation.assigneeId;
  return true;
};

export const lastMessageOf = (conversation: Conversation): Message | undefined => {
  for (let index = conversation.timeline.length - 1; index >= 0; index -= 1) {
    const item = conversation.timeline[index];
    if (item && item.kind === 'message') return item.message;
  }
  return undefined;
};
