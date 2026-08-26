import type { AutomationTrigger } from '@/core/domain/automation';
import type { Id } from '@/core/domain/shared';
import { createRunAutomations } from '@/core/use-cases/run-automations';
import { prisma } from '@/infrastructure/db/prisma';
import { PrismaConversationRepository } from '@/infrastructure/repositories/prisma/conversation-repository';
import { automationRow } from '@/infrastructure/repositories/prisma/mappers';
import { prismaAutomationEffects } from './automation-effects';

/**
 * Monta as dependências aqui em vez de pedir ao `container`.
 *
 * O container conhece o `CookieSessionProvider`, que importa `next/navigation`
 * — e este módulo é alcançado pelo `wa-store`, que roda **dentro do worker**,
 * um processo Node puro sem Next. Passar pelo container arrastaria o framework
 * inteiro para o pacote do worker e o quebraria no boot. As automações não
 * precisam de sessão: rodam em nome da conta.
 */
const conversations = new PrismaConversationRepository();

const runAutomations = createRunAutomations(
  /**
   * Uma consulta, não o workspace inteiro.
   *
   * A primeira versão pedia `settings.get()`, que dispara quinze consultas em
   * paralelo — papéis, artigos, tokens, auditoria — para usar exatamente um
   * campo. E isso passou a acontecer **a cada mensagem recebida**, que é o
   * caminho mais quente do sistema.
   */
  async (accountId) =>
    (
      await prisma.automation.findMany({
        where: { accountId, enabled: true },
        orderBy: { order: 'asc' },
      })
    ).map(automationRow),
  prismaAutomationEffects,
);

/**
 * Dispara as automações de um gatilho sem deixar o erro vazar para quem chamou.
 *
 * Automação é efeito colateral do que o usuário pediu, nunca a razão dele: se
 * uma regra apontar para uma equipe renomeada, quem aplicou a etiqueta ainda
 * assim aplicou a etiqueta. Por isso a falha vira log, não exceção — e por isso
 * este envelope existe em vez de cada ponto de disparo repetir o try/catch.
 *
 * O disparo é aguardado, e não solto em segundo plano. Numa Server Action o
 * processo pode encerrar a requisição antes de uma promessa órfã terminar, e a
 * automação simplesmente não rodaria de vez em quando — o tipo de defeito que
 * ninguém consegue reproduzir.
 */
export const dispararAutomacoes = async (input: {
  readonly accountId: Id;
  readonly trigger: AutomationTrigger;
  readonly conversationId: Id;
  readonly messageText?: string;
}): Promise<void> => {
  try {
    const conversation = await conversations.findById(
      input.accountId,
      input.conversationId,
      // Automação roda em nome da conta, não de quem está olhando: restringir
      // por caixa aqui faria a regra deixar de valer conforme quem disparou.
      'todas',
    );
    if (!conversation) return;

    const outcomes = await runAutomations({
      accountId: input.accountId,
      trigger: input.trigger,
      conversation,
      ...(input.messageText ? { messageText: input.messageText } : {}),
    });

    for (const outcome of outcomes) {
      if (!outcome.ok) {
        console.warn(
          `[automações] "${outcome.automationName}" falhou em ${outcome.action}: ${outcome.error}`,
        );
      }
    }
  } catch (error) {
    console.warn(`[automações] Falha ao processar o gatilho ${input.trigger}:`, error);
  }
};
