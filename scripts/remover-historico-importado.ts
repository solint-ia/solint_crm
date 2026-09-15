/**
 * Remove somente dados criados pela importação de histórico do WhatsApp.
 *
 * Uso (dry-run): npx tsx scripts/remover-historico-importado.ts --account acc_...
 * Aplicar:        npx tsx scripts/remover-historico-importado.ts --account acc_... --apply
 * Caixa única:    acrescente --inbox ibx_...
 */
import { prisma } from '../src/infrastructure/db/prisma';

const args = process.argv.slice(2);
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const accountId = valueAfter('--account');
const inboxId = valueAfter('--inbox');
const apply = args.includes('--apply');

if (!accountId || accountId.startsWith('--')) {
  throw new Error('Informe explicitamente --account <id>.');
}
if (args.includes('--inbox') && (!inboxId || inboxId.startsWith('--'))) {
  throw new Error('Informe um valor válido depois de --inbox.');
}

const conversationScope = {
  accountId,
  ...(inboxId ? { inboxId } : {}),
};

const main = async () => {
  const [messages, emptyImportedConversations] = await Promise.all([
    prisma.message.count({
      where: { origin: 'historico', conversation: conversationScope },
    }),
    prisma.conversation.count({
      where: {
        ...conversationScope,
        importedAt: { not: null },
        messages: { none: { origin: { not: 'historico' } } },
      },
    }),
  ]);

  console.log(
    `${apply ? 'APLICAR' : 'DRY-RUN'}: ${messages} mensagem(ns) histórica(s) e ` +
      `${emptyImportedConversations} conversa(s) importada(s) ficarão vazias.`,
  );

  if (apply) {
    const result = await prisma.$transaction(async (tx) => {
      const deletedMessages = await tx.message.deleteMany({
        where: { origin: 'historico', conversation: conversationScope },
      });
      const deletedConversations = await tx.conversation.deleteMany({
        where: { ...conversationScope, importedAt: { not: null }, messages: { none: {} } },
      });
      return { deletedMessages, deletedConversations };
    });
    console.log(
      `Removidas ${result.deletedMessages.count} mensagem(ns) e ` +
        `${result.deletedConversations.count} conversa(s). Contatos e objetos de mídia foram preservados.`,
    );
  }

  await prisma.$disconnect();
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
