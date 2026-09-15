import { prisma } from '@/infrastructure/db/prisma';
import { nomeUtilizavel } from './wa-format';

/**
 * Nomes salvos na agenda do celular pareado, guardados fora da memória.
 *
 * A agenda chega uma única vez por pareamento (e em alterações feitas no
 * celular) e morava só num `Map` da sessão. Cada reinício do worker a apagava,
 * e até alguém clicar em "sincronizar contatos" nenhuma conversa tinha o nome
 * salvo para mostrar: o nome do perfil, que vem em toda mensagem, vencia
 * sozinho. Esta tabela é o que devolve a agenda à memória quando a sessão sobe.
 *
 * **Não é o cadastro de contatos.** Nada aqui cria nem altera `Contact`: gravar
 * contatos a partir dos eventos de agenda transformaria cada pareamento numa
 * sincronização automática do CRM, e essa decisão continua sendo do botão.
 *
 * A agenda é do **número**, não da caixa. Parear outro número na mesma caixa
 * não pode herdar os nomes que o anterior tinha salvos, então toda leitura e
 * escrita leva `ownerJid`.
 */

export interface AddressBookScope {
  readonly accountId: string;
  readonly inboxId: string;
  /** Número pareado, normalizado (`5511...@s.whatsapp.net`). */
  readonly ownerJid: string;
}

export interface AddressBookEntry {
  /** Contato, normalizado como a sessão guarda na memória. */
  readonly jid: string;
  readonly name: string;
}

/** Espera para juntar a rajada de eventos de agenda numa gravação só. */
export const ADDRESS_BOOK_FLUSH_MS = 1_500;
/** Nova tentativa quando o número pareado ainda não é conhecido. */
export const ADDRESS_BOOK_RETRY_MS = 5_000;

/**
 * Tamanho do lote.
 *
 * O pareamento entrega agendas de milhares de contatos. Um `IN` com todos de
 * uma vez vira uma consulta enorme; um contato por vez ocuparia o pool que as
 * mensagens usam.
 */
const LOTE = 500;

/**
 * Grava os nomes, criando os novos e trocando só os que mudaram.
 *
 * Nome que não identifica ninguém (número, número mascarado) não é gravado:
 * guardá-lo faria um número passar por nome salvo. Dentro do mesmo lote, o
 * último nome de um contato vence, que é a ordem em que o celular os mandou.
 */
export const saveAddressBookNames = async (
  scope: AddressBookScope,
  entries: readonly AddressBookEntry[],
): Promise<{ readonly created: number; readonly updated: number }> => {
  const porJid = new Map<string, string>();
  for (const entry of entries) {
    const jid = entry.jid.trim();
    const name = nomeUtilizavel(entry.name);
    if (jid && name) porJid.set(jid, name);
  }

  const { accountId, inboxId, ownerJid } = scope;
  const todos = [...porJid.entries()];
  let created = 0;
  let updated = 0;

  for (let inicio = 0; inicio < todos.length; inicio += LOTE) {
    const lote = todos.slice(inicio, inicio + LOTE);
    const existentes = await prisma.whatsAppAddressBookName.findMany({
      where: { accountId, inboxId, ownerJid, jid: { in: lote.map(([jid]) => jid) } },
      select: { jid: true, name: true },
    });
    const atual = new Map(existentes.map((row) => [row.jid, row.name]));

    const novos = lote.filter(([jid]) => !atual.has(jid));
    if (novos.length > 0) {
      // `skipDuplicates` cobre a gravação concorrente do mesmo contato (duas
      // rajadas de eventos se sobrepondo): quem perde a corrida não falha.
      const resultado = await prisma.whatsAppAddressBookName.createMany({
        data: novos.map(([jid, name]) => ({ accountId, inboxId, ownerJid, jid, name })),
        skipDuplicates: true,
      });
      created += resultado.count;
    }

    // Troca de nome é rara (alguém editou o contato no celular), então uma
    // atualização por linha não pesa.
    for (const [jid, name] of lote) {
      const anterior = atual.get(jid);
      if (anterior === undefined || anterior === name) continue;
      const resultado = await prisma.whatsAppAddressBookName.updateMany({
        where: { accountId, inboxId, ownerJid, jid },
        data: { name },
      });
      updated += resultado.count;
    }
  }

  return { created, updated };
};

/** Os nomes gravados para o número pareado nesta caixa. */
export const loadAddressBookNames = (
  scope: AddressBookScope,
): Promise<readonly AddressBookEntry[]> =>
  prisma.whatsAppAddressBookName.findMany({
    where: { accountId: scope.accountId, inboxId: scope.inboxId, ownerJid: scope.ownerJid },
    select: { jid: true, name: true },
  });
