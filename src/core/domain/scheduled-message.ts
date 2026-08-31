import type { Id, IsoDateTime } from './shared';

/**
 * Uma mensagem escrita agora para sair depois.
 *
 * Não é uma `Message`, e a distinção é a razão de este arquivo existir:
 * enquanto não sai, ela não faz parte da conversa. Não aparece na timeline, não
 * conta como atividade, não entra no resumo da caixa de entrada e pode ser
 * cancelada sem deixar buraco. Só quando o horário chega é que nasce uma
 * `Message` de verdade — e é ela que segue o caminho normal de qualquer envio.
 */
export type ScheduledMessageStatus =
  | 'pending'
  /** O executor pegou a linha e está enviando. Estado de trava, não de espera. */
  | 'sending'
  | 'sent'
  | 'canceled'
  | 'failed';

export interface ScheduledMessage {
  readonly id: Id;
  readonly conversationId: Id;
  readonly text: string;
  readonly isPrivate: boolean;
  /** Instante do disparo, em ISO. A tela formata no fuso de exibição. */
  readonly scheduledFor: IsoDateTime;
  readonly status: ScheduledMessageStatus;
  /** Quem agendou — é o autor que a mensagem terá quando sair. */
  readonly authorName: string;
  readonly error?: string;
}

/**
 * Antecedência mínima.
 *
 * Abaixo de um minuto, agendar não é agendar: é um envio com um passo a mais e
 * uma corrida com o varredor, que roda a cada 20 segundos. Quem quer mandar
 * agora tem o botão de enviar do lado.
 */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

/**
 * Teto de um ano.
 *
 * Existe para o erro de digitação, não para a regra de negócio: um "2036" no
 * lugar de "2026" viraria uma linha pendente por uma década, invisível e
 * inexplicável quando finalmente disparasse.
 */
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Um agendamento ainda cancelável — os demais já saíram ou já falharam. */
export const isScheduleCancelable = (item: ScheduledMessage): boolean =>
  item.status === 'pending';
