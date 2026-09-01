import type { AutoReply, BusinessHours } from './business-hours';
import type { Channel, InboxConnectionStatus } from './channel';
import type { Id } from './shared';

/**
 * Estrutura preservada para compatibilidade com os dados existentes.
 * Ações em um clique não têm ponto de entrada na interface nesta etapa.
 */
export interface Macro {
  readonly id: Id;
  readonly name: string;
  readonly steps: string;
}

export interface CannedResponse {
  readonly id: Id;
  readonly shortcut: string;
  readonly content: string;
}

/**
 * Uma caixa de entrada conectada.
 *
 * Conexão e operação moram juntas de propósito: quem abre a caixa quer saber,
 * na mesma tela, se ela está online E se está dentro do expediente. Separar as
 * duas coisas obrigaria o supervisor a cruzar telas para responder "por que o
 * cliente recebeu a mensagem de ausência às 15h?".
 */
export interface ChannelConnection {
  readonly id: Id;
  readonly name: string;
  readonly channel: Channel;
  readonly identifier: string;
  readonly status: InboxConnectionStatus;
  readonly provider: string;
  readonly businessHours: BusinessHours;
  /** Disparada quando chega mensagem fora do expediente. */
  readonly awayMessage: AutoReply;
  /** Disparada na primeira mensagem de uma conversa nova. */
  readonly greeting: AutoReply;
  /** Disparada quando o atendimento é finalizado/resolvido. */
  readonly closingMessage?: AutoReply;
  /** Disparada quando o cliente aguarda na fila. */
  readonly waitingMessage?: AutoReply;
  /**
   * Minutos de fila sem resposta antes de a mensagem de espera sair.
   *
   * O prazo é da caixa, não do produto: uma central de suporte que responde em
   * um minuto e uma loja que responde em vinte não querem avisar na mesma hora.
   */
  readonly waitingMessageDelayMinutes: number;
  /** Pergunta a nota de 1 a 5 ao cliente quando o atendimento é encerrado. */
  readonly csatEnabled: boolean;
  readonly csatQuestion?: string;
  /** Endpoint que recebe os eventos desta caixa. Vazio = sem webhook. */
  readonly webhookUrl?: string;
  /** Agentes que atendem esta caixa. */
  readonly teamName?: string;
}

export interface Webhook {
  readonly id: Id;
  readonly url: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
}

export interface ApiToken {
  readonly id: Id;
  readonly name: string;
  /** Somente os últimos caracteres são exibidos — o segredo nunca volta do servidor. */
  readonly maskedValue: string;
  readonly createdLabel: string;
  readonly lastUsedLabel: string;
}

/**
 * Equipe — a unidade que decide **quais caixas de entrada** uma pessoa alcança.
 *
 * Uma pessoa em várias equipes enxerga a união das caixas delas; uma caixa pode
 * pertencer a várias equipes (recepção e gerência veem "Atendimento"). Quando a
 * conta não tem nenhuma equipe com caixa vinculada, não há restrição — é o que
 * mantém funcionando quem usa o sistema com uma caixa só.
 */
export interface Team {
  readonly id: Id;
  readonly name: string;
  readonly color: string;
  readonly memberCount: number;
  /**
   * Ids das caixas alcançadas.
   *
   * Ids, não nomes. O campo já guardou nome — o formulário pedia texto livre
   * separado por vírgula — e nome não serve para autorizar: renomear a caixa
   * cortaria o acesso de quem dependia dela, em silêncio.
   */
  readonly inboxIds: readonly string[];
  /** Ids das pessoas na equipe. */
  readonly memberIds: readonly string[];
  readonly businessHours: string;
}

export interface CustomAttributeDefinition {
  readonly id: Id;
  readonly name: string;
  readonly key: string;
  readonly type: 'texto' | 'numero' | 'data' | 'lista' | 'booleano';
  readonly appliesTo: 'contato' | 'conversa';
}

export interface AuditLogEntry {
  readonly id: Id;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly ip: string;
  readonly at: string;
}

export interface ActiveSession {
  readonly id: Id;
  readonly device: string;
  readonly location: string;
  readonly lastActive: string;
  readonly current: boolean;
}

/**
 * Perfil da empresa dona da conta.
 *
 * `tradeName` e `document` moram em `Account` — são consultados. O resto é
 * agregado: só a tela de empresa lê e grava, sempre inteiro.
 *
 * As preferências regionais são guardadas mesmo antes de alguém consumi-las.
 * A alternativa era continuar oferecendo campos que a tela mostrava e o
 * recarregamento apagava, que foi exatamente o defeito daqui.
 */
export interface CompanyProfile {
  readonly legalName?: string;
  readonly website?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly language?: string;
  readonly timezone?: string;
  readonly currency?: string;
  readonly dateFormat?: string;
  readonly firstDayOfWeek?: string;
  readonly brandColor?: string;
  /** Servido por `/api/accounts/[accountId]/logo`. Ausente = iniciais do nome fantasia. */
  readonly logoUrl?: string;
}

export interface BillingInfo {
  readonly planName: string;
  readonly priceLabel: string;
  readonly renewalLabel: string;
  readonly usage: readonly {
    readonly label: string;
    readonly used: number;
    readonly limit: number;
  }[];
  readonly invoices: readonly {
    readonly id: Id;
    readonly reference: string;
    readonly amountLabel: string;
    readonly status: 'paga' | 'aberta' | 'vencida';
  }[];
}
