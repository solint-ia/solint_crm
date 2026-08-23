import type { Id } from '@/core/domain/shared';
import type { AiAgentSandbox } from '@/core/ports/ai-agent-repository';

/**
 * Sandbox de teste do agente.
 * Nunca grava em conversas reais e nunca chama um provedor externo aqui:
 * a chamada ao modelo deve acontecer no backend, com a chave fora do browser.
 */
export class EchoAiAgentSandbox implements AiAgentSandbox {
  async reply(_agentId: Id, prompt: string): Promise<string> {
    if (/plano|preco|valor/i.test(prompt)) {
      return 'Temos os planos Starter, Pro e Enterprise. Qual o tamanho da sua equipe de atendimento?';
    }
    if (/humano|atendente/i.test(prompt)) {
      return 'Claro! Vou transferir você para um atendente humano agora mesmo.';
    }
    return 'Entendido! Deixa eu verificar isso para você e te retorno em seguida.';
  }
}
