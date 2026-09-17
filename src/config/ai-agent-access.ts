import type { Account } from '@/core/domain/user';
import { FEATURES } from './features';

/**
 * A IA existe para esta conta?
 *
 * A flag global continua sendo a chave de emergencia do produto. A coluna da
 * conta e a liberacao comercial. Uma nunca substitui a outra: as duas precisam
 * estar ligadas para qualquer interface ou action expor agentes de IA.
 */
export const hasAiAgentAccess = (account: Pick<Account, 'aiAgentAccessEnabled'>): boolean =>
  FEATURES.agentesIA && account.aiAgentAccessEnabled;
