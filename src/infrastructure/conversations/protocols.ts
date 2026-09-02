import type { Protocol } from '@/core/domain/conversation';
import { formatProtocolCode } from '@/core/domain/conversation';
import { asJson, prisma, readJson } from '@/infrastructure/db/prisma';
import { dataCurtaLabel } from '@/lib/datetime';

/**
 * Abertura e fechamento do número de atendimento, num lugar só.
 *
 * O protocolo nascia em dois pontos de `wa-store` com `Math.random()` de cinco
 * dígitos, nunca era atualizado depois, e conversa criada por qualquer outro
 * caminho nascia sem protocolo nenhum — então `{{protocolo}}` não teria valor
 * para oferecer. Três defeitos que só se resolvem tendo um dono para a regra.
 */

/**
 * O próximo número da conta.
 *
 * `UPDATE ... RETURNING` é atômico no Postgres: duas conversas nascendo no
 * mesmo instante recebem números diferentes sem transação explícita e sem
 * trava. Um `SELECT` seguido de `UPDATE` teria a janela entre os dois, que é
 * exatamente a corrida que o formato aleatório anterior sofria por outra via.
 */
const proximoSequencial = async (accountId: string): Promise<number> => {
  const linhas = await prisma.$queryRaw<{ protocolSeq: number }[]>`
    UPDATE "Account"
       SET "protocolSeq" = "protocolSeq" + 1
     WHERE "id" = ${accountId}
    RETURNING "protocolSeq"
  `;
  return linhas[0]?.protocolSeq ?? 1;
};

/** Um protocolo novo, já no formato do produto. */
export const novoProtocolo = async (accountId: string, quando = new Date()): Promise<Protocol> => ({
  code: formatProtocolCode(await proximoSequencial(accountId), quando),
  date: dataCurtaLabel(quando),
  status: 'Em andamento',
  openedAt: quando.toISOString(),
});

/**
 * Abre um protocolo na conversa, se ela não tiver nenhum em aberto.
 *
 * Idempotente de propósito: é chamada tanto no nascimento da conversa quanto na
 * reabertura, e chamá-la duas vezes não pode gerar dois números. Devolve o
 * protocolo corrente — o que acabou de abrir, ou o que já estava lá.
 */
export const abrirProtocolo = async (
  accountId: string,
  conversationId: string,
  quando = new Date(),
): Promise<Protocol | undefined> => {
  const conversa = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: { protocols: true },
  });
  if (!conversa) return undefined;

  const atuais = readJson<readonly Protocol[]>(conversa.protocols, []);
  const emAberto = atuais.find((p) => p.status !== 'Resolvido');
  if (emAberto) return emAberto;

  const protocolo = await novoProtocolo(accountId, quando);
  await prisma.conversation.updateMany({
    where: { id: conversationId, accountId },
    data: { protocols: asJson([...atuais, protocolo]) },
  });
  return protocolo;
};

/**
 * Fecha o protocolo em aberto quando o atendimento é resolvido.
 *
 * Marca só o que está aberto: os anteriores já foram fechados nos seus próprios
 * ciclos, e reescrevê-los apagaria a data em que cada um terminou.
 */
export const fecharProtocolo = async (accountId: string, conversationId: string): Promise<void> => {
  const conversa = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: { protocols: true },
  });
  if (!conversa) return;

  const atuais = readJson<readonly Protocol[]>(conversa.protocols, []);
  if (!atuais.some((p) => p.status !== 'Resolvido')) return;

  await prisma.conversation.updateMany({
    where: { id: conversationId, accountId },
    data: {
      protocols: asJson(
        atuais.map((p) => (p.status === 'Resolvido' ? p : { ...p, status: 'Resolvido' })),
      ),
    },
  });
};
