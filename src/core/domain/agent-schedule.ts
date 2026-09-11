import {
  isWithinBusinessHours,
  normalizeBusinessHours,
  type BusinessHours,
} from './business-hours';

/**
 * Quando o agente de IA atende uma caixa de entrada.
 *
 * É separado do horário de atendimento de propósito: o agente costuma cobrir
 * justamente o que a equipe não cobre — a madrugada, o fim de semana —, e as
 * duas grades raramente coincidem. O formato da grade é o mesmo, e por isso a
 * tela reaproveita a mesma tabela semanal.
 *
 * Fora do horário, o webhook da caixa não é disparado: o agente não recebe a
 * mensagem, não responde, e ela também não entra na memória dele.
 */
export interface AgentSchedule {
  /** `false`: o agente atende a qualquer hora, e o webhook sai sempre. */
  readonly enabled: boolean;
  readonly hours: BusinessHours;
}

/**
 * Devolve uma agenda utilizável a partir do que está gravado.
 *
 * Coluna vazia é a caixa que nunca configurou: agenda desligada, com a grade do
 * horário de atendimento como ponto de partida — é o que a tela mostra ao ligar
 * o horário do agente pela primeira vez, em vez de uma grade inventada.
 */
export const normalizeAgentSchedule = (value: unknown, fallback: BusinessHours): AgentSchedule => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    hours:
      raw.hours && typeof raw.hours === 'object' ? normalizeBusinessHours(raw.hours) : fallback,
  };
};

/** O agente atende neste instante? `now` por parâmetro, como no expediente. */
export const agentWorksAt = (schedule: AgentSchedule, now: Date): boolean =>
  !schedule.enabled || isWithinBusinessHours(schedule.hours, now);
