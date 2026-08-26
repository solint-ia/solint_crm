import type {
  Automation,
  AutomationAction,
  AutomationContext,
  AutomationTrigger,
} from '../domain/automation';
import { automationsFor } from '../domain/automation';
import type { Conversation, Priority } from '../domain/conversation';
import { PRIORITIES } from '../domain/conversation';
import type { Label } from '../domain/label';
import type { Id } from '../domain/shared';

/**
 * Execução das automações configuradas.
 *
 * As regras existiam, eram salvas, listadas e até tinham detecção de conflito —
 * e nunca rodavam. Não havia nada entre a tabela `Automation` e o que acontece
 * numa conversa: este arquivo é essa ponte.
 *
 * O motor não conhece Prisma nem Baileys. Recebe o que precisa por portas e
 * devolve o relato do que fez, para quem chamou registrar ou anunciar.
 */

/** O que o motor precisa poder fazer. Uma porta por ação executável. */
export interface AutomationEffects {
  setPriority(accountId: Id, conversationId: Id, priority: Priority): Promise<unknown>;
  assignToAgent(accountId: Id, conversationId: Id, agentName: string): Promise<unknown>;
  assignToTeam(accountId: Id, conversationId: Id, teamName: string): Promise<unknown>;
  addLabel(accountId: Id, conversationId: Id, labelName: string): Promise<unknown>;
  resolve(accountId: Id, conversationId: Id): Promise<unknown>;
  sendMessage(accountId: Id, conversationId: Id, text: string): Promise<unknown>;
  notify(accountId: Id, conversationId: Id, text: string): Promise<unknown>;
  /** Move o card ligado à conversa para a etapa de nome informado. */
  moveDealToStage(accountId: Id, conversationId: Id, stageName: string): Promise<unknown>;
}

export interface RunAutomationsInput {
  readonly accountId: Id;
  readonly trigger: AutomationTrigger;
  readonly conversation: Conversation;
  /** Texto da mensagem que disparou, quando o gatilho veio de uma. */
  readonly messageText?: string;
  readonly withinBusinessHours?: boolean;
}

export interface AutomationOutcome {
  readonly automationId: Id;
  readonly automationName: string;
  readonly action: AutomationAction['type'];
  readonly ok: boolean;
  readonly error?: string;
}

const isPriority = (value: string): value is Priority =>
  (PRIORITIES as readonly string[]).includes(value);

const contextOf = (
  conversation: Conversation,
  messageText: string | undefined,
  withinBusinessHours: boolean | undefined,
): AutomationContext => ({
  canal: conversation.channel,
  fila: conversation.queue,
  prioridade: conversation.priority,
  etiquetas: conversation.labels.map((label: Label) => label.name),
  ...(messageText ? { texto: messageText } : {}),
  ...(withinBusinessHours === undefined ? {} : { dentroDoHorario: withinBusinessHours }),
});

export const createRunAutomations =
  (
    listAutomations: (accountId: Id) => Promise<readonly Automation[]>,
    effects: AutomationEffects,
  ) =>
  async ({
    accountId,
    trigger,
    conversation,
    messageText,
    withinBusinessHours,
  }: RunAutomationsInput): Promise<readonly AutomationOutcome[]> => {
    const automations = await listAutomations(accountId);
    const aplicaveis = automationsFor(
      automations,
      trigger,
      contextOf(conversation, messageText, withinBusinessHours),
    );
    if (aplicaveis.length === 0) return [];

    const outcomes: AutomationOutcome[] = [];

    for (const automation of aplicaveis) {
      for (const action of automation.actions) {
        try {
          await execute(effects, accountId, conversation.id, action);
          outcomes.push({
            automationId: automation.id,
            automationName: automation.name,
            action: action.type,
            ok: true,
          });
        } catch (error) {
          // Uma ação que falha não cancela as demais: as regras são
          // independentes entre si, e abortar a fila por causa de uma etiqueta
          // inexistente deixaria de aplicar a transferência que vinha depois.
          outcomes.push({
            automationId: automation.id,
            automationName: automation.name,
            action: action.type,
            ok: false,
            error: error instanceof Error ? error.message : 'Falha ao executar a ação.',
          });
        }
      }
    }

    return outcomes;
  };

const execute = async (
  effects: AutomationEffects,
  accountId: Id,
  conversationId: Id,
  action: AutomationAction,
): Promise<void> => {
  const value = action.value.trim();

  switch (action.type) {
    case 'definir_prioridade': {
      if (!isPriority(value)) {
        throw new Error(`Prioridade "${value}" não existe.`);
      }
      await effects.setPriority(accountId, conversationId, value);
      return;
    }
    case 'atribuir_agente':
      await effects.assignToAgent(accountId, conversationId, value);
      return;
    case 'atribuir_equipe':
      await effects.assignToTeam(accountId, conversationId, value);
      return;
    case 'aplicar_etiqueta':
      await effects.addLabel(accountId, conversationId, value);
      return;
    case 'resolver':
      await effects.resolve(accountId, conversationId);
      return;
    case 'enviar_mensagem':
      if (!value) throw new Error('Ação de enviar mensagem sem texto.');
      await effects.sendMessage(accountId, conversationId, value);
      return;
    case 'notificar':
      await effects.notify(accountId, conversationId, value);
      return;
    case 'mover_etapa_kanban':
      if (!value) throw new Error('Ação de mover sem etapa de destino.');
      await effects.moveDealToStage(accountId, conversationId, value);
      return;
    default: {
      // Exaustividade: uma ação nova sem tratamento vira erro de compilação,
      // não uma regra que silenciosamente não faz nada.
      const exhaustive: never = action.type;
      throw new Error(`Ação não suportada: ${String(exhaustive)}`);
    }
  }
};
