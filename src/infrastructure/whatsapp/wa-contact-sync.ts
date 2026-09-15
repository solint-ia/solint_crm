import { PhoneNumber } from '@/core/domain/contact';
import { asJson, prisma } from '@/infrastructure/db/prisma';
import { waLog } from './wa-log';

/**
 * Aplica a agenda do celular ao cadastro de contatos do CRM.
 *
 * Separado da sessão para ficar longe do Baileys e poder ser testado contra o
 * banco: é aqui que mora a regra de "quem é contato" e "qual cadastro é o
 * dessa pessoa". A sessão só traduz a memória do socket em entradas por
 * telefone; ver `syncAllStoredContacts` em `worker/session.ts`.
 */

export interface EntradaDaAgenda {
  /** Telefone em dígitos, com DDI, sem `+`. */
  readonly phoneDigits: string;
  /** Nome salvo na agenda do celular pareado (`Contact.name` do Baileys). */
  readonly addressBookName?: string;
  /** Nome que a pessoa publica (`notify`). Só usado para criar quem não tem nome salvo. */
  readonly pushName?: string;
  readonly avatarUrl?: string;
}

export interface ResultadoDaAgenda {
  /** Entradas que eram contato (agenda ou conversa direta) e foram conferidas. */
  readonly synced: number;
  readonly created: number;
  /** Cadastros que tiveram o nome trocado pelo nome salvo na agenda. */
  readonly renamed: number;
  /** Entradas que falharam por outro motivo que não uma corrida de criação. */
  readonly failed: number;
}

/**
 * O telefone com e sem o nono dígito brasileiro.
 *
 * O mesmo número aparece nas duas formas: o WhatsApp manteve muitos JIDs
 * antigos sem o 9, e o cadastro do CRM pode ter vindo de uma importação ou de
 * digitação com ele. Comparar só a forma exata deixava o nome salvo na agenda
 * sem cadastro para aplicar, com a sincronização terminando "com sucesso".
 */
export const variantesDoTelefone = (digits: string): readonly string[] => {
  const variantes = new Set([digits]);
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    variantes.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    variantes.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  }
  return [...variantes];
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

export const aplicarAgendaNosContatos = async (
  accountId: string,
  entradas: readonly EntradaDaAgenda[],
  /** Dígitos dos telefones com conversa direta nesta caixa. */
  conversasDiretas: ReadonlySet<string>,
): Promise<ResultadoDaAgenda> => {
  let synced = 0;
  let created = 0;
  let renamed = 0;
  let failed = 0;

  for (const entrada of entradas) {
    const variantes = variantesDoTelefone(entrada.phoneDigits);

    /**
     * O que separa a agenda de quem só passou pelo caminho.
     *
     * A memória da sessão não é a agenda: é tudo o que ela já viu, incluindo
     * cada participante de cada grupo. Foi assim que 500 contatos viraram
     * 2000. O nome salvo (`name`) só existe para quem está na agenda do
     * aparelho, que é o critério da tela de "nova conversa" do WhatsApp. Quem
     * já tem conversa direta entra junto, porque quem foi atendido é contato
     * por definição.
     */
    const temConversa = variantes.some((digitos) => conversasDiretas.has(digitos));
    if (!entrada.addressBookName && !temConversa) continue;

    try {
      const existentes = await prisma.contact.findMany({
        where: {
          accountId,
          kind: { not: 'grupo' },
          OR: [
            { phone: { in: variantes.map((digitos) => `+${digitos}`) } },
            {
              id: {
                in: variantes.flatMap((digitos) => [
                  `ct-wa-${digitos}`,
                  `ct-wa-${accountId}-${digitos}`,
                ]),
              },
            },
          ],
        },
        select: { id: true },
      });
      synced += 1;

      if (existentes.length > 0) {
        const ids = existentes.map((contato) => contato.id);
        // Todos os cadastros do telefone, não só o primeiro encontrado. Com um
        // duplicado, o nome ia para uma linha e a conversa mostrava a outra.
        if (entrada.addressBookName) {
          const resultado = await prisma.contact.updateMany({
            where: { accountId, id: { in: ids }, name: { not: entrada.addressBookName } },
            data: { name: entrada.addressBookName },
          });
          renamed += resultado.count;
        }
        if (entrada.avatarUrl) {
          await prisma.contact.updateMany({
            where: { accountId, id: { in: ids }, avatarUrl: null },
            data: { avatarUrl: entrada.avatarUrl },
          });
        }
        continue;
      }

      const phone = `+${entrada.phoneDigits}`;
      await prisma.contact.create({
        data: {
          id: `ct-wa-${accountId}-${entrada.phoneDigits}`,
          accountId,
          // Um contato salvo sem etiqueta continua sendo contato: o nome pode
          // ser só o número formatado.
          name: entrada.addressBookName || entrada.pushName || PhoneNumber.format(phone) || phone,
          phone,
          channel: 'whatsapp',
          avatarTone: 'blue',
          kind: 'pessoa',
          avatarUrl: entrada.avatarUrl ?? null,
          customFields: asJson([]),
          timeline: asJson([]),
        },
      });
      created += 1;
    } catch (error) {
      // Duas sincronizações criando o mesmo contato: quem perdeu a corrida não
      // tem nada a fazer. Qualquer outra falha era engolida junto com esta, e a
      // sincronização terminava "concluída" sem ter aplicado nada.
      if (isUniqueViolation(error)) continue;
      failed += 1;
      waLog.warn(`[agenda] Contato ${entrada.phoneDigits} não sincronizado:`, error);
    }
  }

  return { synced, created, renamed, failed };
};
