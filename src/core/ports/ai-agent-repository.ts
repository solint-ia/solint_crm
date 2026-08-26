import type { AgentFlowBlock, AiAgent } from '../domain/ai-agent';
import type { Id } from '../domain/shared';

export interface CreateAiAgentDraft {
  readonly name: string;
  readonly scope: string;
  readonly persona: string;
  readonly systemPrompt?: string;
  readonly model?: string;
}

export interface AiAgentRepository {
  list(accountId: Id): Promise<readonly AiAgent[]>;
  findById(accountId: Id, agentId: Id): Promise<AiAgent | null>;
  create(accountId: Id, draft: CreateAiAgentDraft): Promise<AiAgent>;
  setActive(accountId: Id, agentId: Id, active: boolean): Promise<AiAgent>;
  toggleTransferRule(accountId: Id, agentId: Id, ruleId: Id): Promise<AiAgent>;
  saveFlow(accountId: Id, agentId: Id, flow: readonly AgentFlowBlock[]): Promise<AiAgent>;
}

/** Porta de conversa simulada com o agente (sandbox — nunca grava em conversa real). */
export interface AiAgentSandbox {
  reply(agentId: Id, prompt: string): Promise<string>;
}
