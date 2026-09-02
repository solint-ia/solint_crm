'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CHANNELS } from '@/core/domain/channel';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import {
  foldText,
  highestClassification,
  normalizeImportedPhone,
} from '@/core/domain/contact-import';
import type { ContactPartner, ContactPartnerPhone } from '@/core/domain/contact';
import { postgresPubSub, CHANNELS as DB_CHANNELS } from '@/infrastructure/db/postgres-pubsub';
import { WA_ENGINE } from '@/infrastructure/whatsapp/channel';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';

export interface ActionResult<T = unknown> {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: T;
}

const assertCanWrite = async () => {
  const session = await container.session.getCurrentSession();
  if (!can(session, 'contatos:escrever')) {
    throw new Error('Seu papel não permite gerenciar contatos.');
  }
  return session;
};

const failureOf = <T = unknown>(error: unknown, fallback: string): ActionResult<T> => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const createContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().optional().or(z.literal('')),
  company: z.string().trim().max(100).optional().or(z.literal('')),
  channel: z.enum(CHANNELS).default('whatsapp'),
  notes: z.string().trim().max(2000).optional(),
});

export async function createContactAction(input: unknown): Promise<ActionResult> {
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const contact = await container.contacts.create(session.account.id, {
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email || undefined,
      company: parsed.data.company || undefined,
      channel: parsed.data.channel,
      avatarTone: 'blue',
      notes: parsed.data.notes,
      customFields: [],
      labels: [],
    });
    return { ok: true, data: contact };
  } catch (error) {
    return failureOf(error, 'Erro ao criar contato.');
  }
}

const updateContactSchema = z.object({
  contactId: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  company: z.string().trim().max(100).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
});

export async function updateContactAction(input: unknown): Promise<ActionResult> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const contact = await container.contacts.update(session.account.id, parsed.data.contactId, {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
      email: parsed.data.email || undefined,
      company: parsed.data.company || undefined,
      notes: parsed.data.notes,
    });
    return { ok: true, data: contact };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar contato.');
  }
}

const deleteContactSchema = z.object({
  contactId: z.string().min(1),
});

export async function deleteContactAction(
  input: unknown,
): Promise<ActionResult<{ destino: 'apagado' | 'arquivado' }>> {
  const parsed = deleteContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Contato inválido.' };

  try {
    const session = await assertCanWrite();
    const destino = await container.contacts.delete(session.account.id, parsed.data.contactId);
    await writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.excluidos',
      targetType: 'contato',
      targetId: parsed.data.contactId,
      metadata: {
        detalhe: destino === 'arquivado' ? '1 contato (histórico mantido)' : '1 contato',
        count: 1,
        destino,
      },
    });
    return { ok: true, data: { destino } };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir contato.');
  }
}

/**
 * A mesma regra da exclusão individual, em lote.
 *
 * Uma consulta separa os dois grupos antes de escrever: quem tem conversa é
 * arquivado, quem não tem é apagado. Era um `deleteMany` só, e nele cada
 * contato com histórico levava as conversas e as mensagens dele embora —
 * cinquenta de uma vez, com um clique e sem volta.
 */
export async function deleteContactsAction(
  input: unknown,
): Promise<ActionResult<{ count: number; arquivados: number }>> {
  const parsed = z
    .object({ contactIds: z.array(z.string().min(1)).min(1).max(500) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Contatos inválidos.' };
  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;
    const ids = parsed.data.contactIds;

    const comHistorico = await prisma.contact.findMany({
      where: { accountId, id: { in: ids }, conversations: { some: {} } },
      select: { id: true },
    });
    const arquivar = new Set(comHistorico.map((row) => row.id));
    const apagar = ids.filter((id) => !arquivar.has(id));

    const [arquivados, apagados] = await Promise.all([
      arquivar.size > 0
        ? prisma.contact.updateMany({
            where: { accountId, id: { in: [...arquivar] }, deletedAt: null },
            data: { deletedAt: new Date() },
          })
        : Promise.resolve({ count: 0 }),
      apagar.length > 0
        ? prisma.contact.deleteMany({ where: { accountId, id: { in: apagar } } })
        : Promise.resolve({ count: 0 }),
    ]);

    const count = arquivados.count + apagados.count;
    await writeAuditLog({
      accountId,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.excluidos',
      targetType: 'contato',
      metadata: {
        detalhe:
          arquivados.count > 0
            ? `${count} contatos (${arquivados.count} com histórico mantido)`
            : `${count} contatos`,
        count,
        arquivados: arquivados.count,
      },
    });
    return { ok: true, data: { count, arquivados: arquivados.count } };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir contatos.');
  }
}

const mergeContactsSchema = z.object({
  primaryId: z.string().min(1),
  duplicateId: z.string().min(1),
});

export async function mergeContactsAction(input: unknown): Promise<ActionResult> {
  const parsed = mergeContactsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificadores inválidos.' };

  try {
    const session = await assertCanWrite();
    const contact = await container.contacts.merge(
      session.account.id,
      parsed.data.primaryId,
      parsed.data.duplicateId,
    );
    return { ok: true, data: contact };
  } catch (error) {
    return failureOf(error, 'Erro ao mesclar contatos.');
  }
}

const saveSegmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
  filters: z.array(z.record(z.unknown())),
  contactCount: z.number().int().nonnegative().default(0),
});

export async function saveSegmentAction(input: unknown): Promise<ActionResult> {
  const parsed = saveSegmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados do segmento inválidos.' };

  try {
    const session = await assertCanWrite();
    const segment = await prisma.segment.create({
      data: {
        accountId: session.account.id,
        name: parsed.data.name,
        description: parsed.data.description,
        filters: asJson(parsed.data.filters),
        contactCount: parsed.data.contactCount,
      },
    });
    return { ok: true, data: segment };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar segmento.');
  }
}

/**
 * O schema é deliberadamente tolerante com e-mail, empresa e notas.
 *
 * Antes, `email` era `.email()` obrigatório-se-presente e `notes` tinha teto de
 * 2000 — e o Zod recusa o **payload inteiro** quando uma linha desrespeita
 * qualquer regra. Numa planilha de prospecção com milhares de linhas, um único
 * e-mail malformado (ou uma célula com dezesseis e-mails separados por ponto e
 * vírgula, que é o formato real dessas exportações) derrubava a importação toda
 * sem dizer qual linha era a culpada. Agora a tela já normaliza esses campos
 * (ver `contact-import.ts`) e o que chega aqui é cortado, não recusado: o
 * telefone é o único campo cuja invalidez descarta a linha, e ela é relatada
 * uma a uma no resultado.
 */
const importContactsCsvSchema = z.object({
  batchName: z.string().trim().min(2, 'Informe um nome para a lista.').max(120),
  contacts: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Nome é obrigatório.'),
        company: z.string().trim().max(200).optional().or(z.literal('')),
        cnpj: z.string().trim().max(32).optional().or(z.literal('')),
        companyAddress: z.string().trim().max(500).optional().or(z.literal('')),
        companyPhone: z.string().trim().max(30).optional().or(z.literal('')),
        partnerPhone: z.string().trim().max(30).optional().or(z.literal('')),
        // Defesa em profundidade: a tela já descarta essas linhas, mas a
        // Server Action também recusa payloads que tentem contornar a regra.
        whatsappFlag: z.literal('Sim'),
        classification: z.string().trim().max(120).optional().or(z.literal('')),
        /**
         * Os sócios e os telefones de cada um.
         *
         * Os tetos são generosos mas existem: sem eles, um payload manipulado
         * poderia gravar um JSON arbitrariamente grande numa coluna que toda
         * leitura de contato carrega.
         */
        partners: z
          .array(
            z.object({
              name: z.string().trim().max(200),
              phones: z
                .array(
                  z.object({
                    phone: z.string().trim().max(30),
                    classification: z.string().trim().max(120).optional().or(z.literal('')),
                  }),
                )
                .max(50),
            }),
          )
          .max(50)
          .optional(),
      }),
    )
    .min(1, 'Nenhum contato enviado para importação.')
    .max(5000, 'Importe no máximo 5000 contatos por vez.'),
});

/** Sócios já gravados neste contato, tolerando coluna nula ou lixo antigo. */
const readSocios = (bruto: unknown): readonly ContactPartner[] => {
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(
    (item): item is ContactPartner =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as ContactPartner).name === 'string' &&
      Array.isArray((item as ContactPartner).phones),
  );
};

/**
 * Junta a lista de sócios que chegou à que já existia.
 *
 * **Some, não substitui.** Uma planilha nova costuma trazer um recorte — só os
 * sócios de um estado, só quem tem WhatsApp confirmado — e sobrescrever faria a
 * segunda importação apagar o que a primeira descobriu. O mesmo raciocínio dos
 * números logo acima, um nível abaixo.
 *
 * A chave é o nome dobrado, e o telefone é o desempate dentro do sócio: um
 * número que já estava lá não é duplicado. Se a classificação mudou, fica a
 * mais alta conhecida para esse mesmo telefone.
 */
const fundirSocios = (
  atuais: readonly ContactPartner[],
  novos: readonly ContactPartner[],
): ContactPartner[] => {
  const porNome = new Map<string, { name: string; phones: Map<string, ContactPartnerPhone> }>();

  for (const socio of [...atuais, ...novos]) {
    const chave = foldText(socio.name);
    const entrada = porNome.get(chave) ?? { name: socio.name, phones: new Map() };
    for (const telefone of socio.phones) {
      const existente = entrada.phones.get(telefone.phone);
      const classificacaoMaisAlta = highestClassification([
        existente?.classification ?? '',
        telefone.classification ?? '',
      ]);
      entrada.phones.set(telefone.phone, {
        phone: telefone.phone,
        ...(classificacaoMaisAlta ? { classification: classificacaoMaisAlta } : {}),
      });
    }
    porNome.set(chave, entrada);
  }

  return [...porNome.values()].map((socio) => ({
    name: socio.name,
    phones: [...socio.phones.values()],
  }));
};

export interface ImportCsvResult {
  readonly batchId: string;
  readonly batchName: string;
  readonly importedCount: number;
  readonly updatedCount: number;
  readonly errorCount: number;
  readonly errors: readonly {
    readonly line: number;
    readonly name: string;
    readonly error: string;
  }[];
}

export async function auditContactsExportAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ count: z.number().int().min(0).max(1_000_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Quantidade inválida.' };
  try {
    const session = await container.session.getCurrentSession();
    if (!can(session, 'contatos:exportar')) return { ok: false, error: 'Sem permissão.' };
    await writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'dados.exportados',
      targetType: 'contato',
      targetName: 'Contatos',
      metadata: { detalhe: `${parsed.data.count} contatos`, count: parsed.data.count, format: 'csv' },
    });
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao registrar a exportação.');
  }
}

export async function importContactsCsvAction(
  input: unknown,
): Promise<ActionResult<ImportCsvResult>> {
  const parsed = importContactsCsvSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Dados de importação inválidos.',
    };
  }

  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    const batch = await prisma.contactImportBatch.create({
      data: { accountId, name: parsed.data.batchName },
      select: { id: true, name: true },
    });

    let importedCount = 0;
    let updatedCount = 0;
    const errors: { line: number; name: string; error: string }[] = [];
    const batchContacts = new Map<string, number>();

    for (let i = 0; i < parsed.data.contacts.length; i++) {
      const item = parsed.data.contacts[i]!;
      const lineNumber = i + 1;

      /**
       * A normalização é a mesma da tela, e vem do domínio.
       *
       * Antes havia uma cópia aqui — `replace(/\D/g)`, `if length === 10 || 11
       * prefixa 55` — e a tela tinha outra. Duas cópias da mesma regra é uma
       * divergência esperando data: a tela dizia "3 contatos, 5 números" e o
       * banco recebia outra coisa.
       */
      /**
       * Os dois números da linha, já em E.164 e em variáveis próprias.
       *
       * Eles não servem só para montar `numeros`: as colunas `companyPhone` e
       * `partnerPhone` também são gravadas, e antes recebiam `item.*` — o texto
       * como veio. Hoje a tela normaliza antes de enviar, então na prática
       * chegava E.164; mas a Server Action é uma porta de entrada por si só, e
       * depender de o chamador ter normalizado deixava as duas metades do
       * cadastro livres para discordar: `phone` em `+5524998296234` e
       * `companyPhone` em `(24) 99829-6234`. Quando isso acontece, a tabela da
       * lista importada mostra o número deformado e o seletor de destinatário
       * — que compara o telefone escolhido com estes campos para rotular
       * "Empresa" ou "Sócio" — nunca casa, e o rótulo some.
       */
      const telefoneEmpresa = normalizeImportedPhone(item.companyPhone ?? '');
      const telefoneSocio =
        item.whatsappFlag === 'Sim' ? normalizeImportedPhone(item.partnerPhone ?? '') : null;

      /**
       * Os sócios, com cada telefone normalizado aqui também.
       *
       * A estrutura é gravada como veio, mas os números dela passam pela mesma
       * normalização de `phone` e `extraPhones` — é o que garante que o
       * telefone escolhido no seletor case com a lista contra a qual o envio o
       * valida. Um sócio cujos números todos se perderam na normalização sai
       * fora: um nome sem telefone nenhum não é um destinatário possível.
       */
      const socios = (item.partners ?? [])
        .map((socio) => ({
          name: socio.name,
          phones: socio.phones
            .map((telefone) => ({
              phone: normalizeImportedPhone(telefone.phone),
              classification: telefone.classification ?? '',
            }))
            .filter(
              (telefone): telefone is { phone: string; classification: string } =>
                telefone.phone !== null,
            ),
        }))
        .filter((socio) => socio.phones.length > 0);

      const classificacaoDosSocios = highestClassification(
        socios.flatMap((socio) => socio.phones.map((telefone) => telefone.classification ?? '')),
      );

      /**
       * **Todos** os números da empresa, e não só os dois primeiros.
       *
       * Aqui estava o defeito que esvaziava o modelo: `numeros` saía de
       * `companyPhone` mais um único `partnerPhone`, então uma empresa com dois
       * sócios e cinco telefones era gravada com dois. Os outros três nunca
       * chegavam a `extraPhones` — e como é contra `extraPhones` que o envio
       * valida o destinatário, escolher um deles seria recusado como "telefone
       * que não pertence a este contato".
       *
       * A ordem importa: o primeiro da lista vira `phone`, o principal.
       */
      const numeros = [
        ...new Set(
          [
            telefoneEmpresa,
            telefoneSocio,
            ...socios.flatMap((socio) => socio.phones.map((telefone) => telefone.phone)),
          ].filter((numero): numero is string => numero !== null),
        ),
      ];

      if (numeros.length === 0) {
        errors.push({
          line: lineNumber,
          name: item.name,
          error: 'Nenhum telefone da empresa ou do sócio com WhatsApp válido.',
        });
        continue;
      }

      const [principal, ...extras] = numeros as [string, ...string[]];

      /**
       * O contato já existente é procurado por **qualquer** um dos números.
       *
       * Só pelo principal, reimportar a mesma planilha depois de o comercial
       * ter trocado a ordem das linhas criaria um segundo contato da mesma
       * pessoa — o número que virou principal na segunda passada estava na
       * lista de extras da primeira, e ninguém encontraria o outro.
       */
      const existing = await prisma.contact.findFirst({
        where: {
          accountId,
          OR: [
            ...(item.cnpj ? [{ cnpj: item.cnpj }] : []),
            { phone: { in: numeros } },
            { extraPhones: { hasSome: numeros } },
          ],
        },
      });

      let contactId: string;
      if (existing) {
        // Os números se somam, não se substituem: a planilha nova pode trazer
        // um celular a mais sem que isso apague o que já se sabia da pessoa.
        const jaConhecidos = new Set([existing.phone, ...existing.extraPhones]);
        const novosExtras = [...existing.extraPhones];
        for (const numero of numeros) {
          if (!jaConhecidos.has(numero)) {
            novosExtras.push(numero);
            jaConhecidos.add(numero);
          }
        }

        const sociosFundidos = fundirSocios(readSocios(existing.partners), socios);
        const classificacaoMaisAlta = highestClassification([
          existing.classification ?? '',
          item.classification ?? '',
          classificacaoDosSocios,
          ...sociosFundidos.flatMap((socio) =>
            socio.phones.map((telefone) => telefone.classification ?? ''),
          ),
        ]);
        const telefonesSociosFundidos = sociosFundidos.flatMap((socio) => socio.phones);
        const telefoneDaClassificacaoMaisAlta = telefonesSociosFundidos.find(
          (telefone) =>
            telefone.classification?.trim().toUpperCase() ===
            classificacaoMaisAlta.trim().toUpperCase(),
        )?.phone;

        await prisma.contact.update({
          where: { id: existing.id, accountId },
          data: {
            name: existing.name || item.name,
            extraPhones: novosExtras,
            company: existing.company || (item.company ? item.company : undefined),
            cnpj: existing.cnpj || item.cnpj || undefined,
            companyAddress: existing.companyAddress || item.companyAddress || undefined,
            companyPhone: telefoneEmpresa ?? existing.companyPhone ?? undefined,
            /**
             * Nunca apagado por uma reimportação.
             *
             * Aqui estava escrito `: null` no ramo em que a coluna `WhatsApp`
             * não dizia "Sim" — e isso não deixava o campo de fora, **apagava**
             * o que já estava lá. Bastava a mesma empresa reaparecer numa lista
             * nova sem o celular do sócio para o número, importado corretamente
             * semanas antes, sumir do cadastro.
             *
             * A regra do "somente se WhatsApp = Sim" vale para o que se
             * importa, e ela continua valendo: sem autorização, `telefoneSocio`
             * é nulo e nada novo é gravado. Ela nunca foi uma ordem para
             * destruir o que já se sabia — e o comentário logo acima já diz que
             * nesta importação os números se somam, não se substituem.
             */
            partnerPhone:
              telefoneDaClassificacaoMaisAlta ??
              existing.partnerPhone ??
              telefoneSocio ??
              undefined,
            classification: classificacaoMaisAlta || undefined,
            // Mesma regra dos números: a lista nova se soma à conhecida em vez
            // de substituí-la. Uma planilha que só traz um dos sócios não pode
            // apagar os outros, que foram importados corretamente antes.
            ...(socios.length > 0 ? { partners: asJson(sociosFundidos) } : {}),
            origin: 'csv',
          },
        });
        contactId = existing.id;
        updatedCount += 1;
      } else {
        const telefonesDosSocios = socios.flatMap((socio) => socio.phones);
        const telefoneDaClassificacaoMaisAlta = telefonesDosSocios.find(
          (telefone) =>
            telefone.classification?.trim().toUpperCase() ===
            classificacaoDosSocios.trim().toUpperCase(),
        )?.phone;
        contactId = `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        await prisma.contact.create({
          data: {
            id: contactId,
            accountId,
            name: item.name,
            phone: principal,
            extraPhones: extras,
            company: item.company || null,
            cnpj: item.cnpj || null,
            companyAddress: item.companyAddress || null,
            companyPhone: telefoneEmpresa,
            partnerPhone: telefoneDaClassificacaoMaisAlta ?? telefoneSocio,
            classification: classificacaoDosSocios || item.classification || null,
            partners: socios.length > 0 ? asJson(socios) : undefined,
            origin: 'csv',
            channel: 'whatsapp',
            avatarTone: 'blue',
            kind: 'pessoa',
            customFields: asJson([]),
            timeline: asJson([]),
          },
        });
        importedCount += 1;
      }

      if (!batchContacts.has(contactId)) batchContacts.set(contactId, lineNumber);
    }

    if (batchContacts.size === 0) {
      // A conta entra no filtro mesmo sendo redundante — o lote foi criado
      // nesta mesma requisição, com este `accountId`. É a regra da casa: nenhuma
      // escrita sai daqui sem escopo, para que nenhuma refatoração futura possa
      // transformar este `id` num identificador vindo de fora.
      await prisma.contactImportBatch.delete({ where: { id: batch.id, accountId } });
      return { ok: false, error: 'Nenhum contato válido foi encontrado para esta lista.' };
    }

    await prisma.contactImportBatchContact.createMany({
      data: [...batchContacts].map(([contactId, rowNumber]) => ({
        batchId: batch.id,
        contactId,
        rowNumber,
      })),
      skipDuplicates: true,
    });

    await writeAuditLog({
      accountId,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.importados',
      targetType: 'contato',
      targetId: batch.id,
      targetName: batch.name,
      metadata: { importedCount, updatedCount, errorCount: errors.length },
    });

    return {
      ok: true,
      data: {
        batchId: batch.id,
        batchName: batch.name,
        importedCount,
        updatedCount,
        errorCount: errors.length,
        errors,
      },
    };
  } catch (error) {
    return failureOf(error, 'Erro ao processar importação de contatos.');
  }
}

/* ==========================================================================
   Listas importadas — apagar a lista, ou tirar uma empresa dela.
   ========================================================================== */

const batchSchema = z.object({ batchId: z.string().min(1).max(64) });

/**
 * Apaga a lista, e só a lista.
 *
 * O lote é um agrupamento — "a prospecção de setembro" —, não o dono dos
 * contatos. Apagá-lo junto com os contatos destruiria gente que a essa altura
 * já pode ter conversa aberta, e que talvez tenha entrado na base por outro
 * caminho antes desta importação. Some a etiqueta do agrupamento; os contatos
 * seguem na aba individual, de onde podem ser excluídos um a um se for o caso.
 *
 * O `accountId` no `where` não é redundante: `batchId` chega do navegador, e
 * sem ele bastaria um id de outra empresa para apagar a lista dela.
 */
export async function deleteImportBatchAction(
  input: unknown,
): Promise<ActionResult<{ name: string }>> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Lista inválida.' };

  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    const lote = await prisma.contactImportBatch.findFirst({
      where: { id: parsed.data.batchId, accountId },
      select: { id: true, name: true, _count: { select: { contacts: true } } },
    });
    if (!lote) return { ok: false, error: 'Lista não encontrada.' };

    // O vínculo cai por cascata (`ContactImportBatchContact.batch`), os
    // contatos não têm relação de posse com o lote e ficam onde estão.
    await prisma.contactImportBatch.delete({ where: { id: lote.id, accountId } });

    await writeAuditLog({
      accountId,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'configuracao.alterada',
      targetType: 'contato',
      targetId: lote.id,
      targetName: lote.name,
      metadata: {
        detalhe: `lista importada excluída (${lote._count.contacts} empresas, contatos mantidos)`,
      },
    });

    revalidatePath('/contatos');
    return { ok: true, data: { name: lote.name } };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir a lista.');
  }
}

const batchContactSchema = batchSchema.extend({
  contactId: z.string().min(1).max(64),
});

/**
 * Tira uma empresa da lista sem excluí-la do CRM.
 *
 * É desvincular, não apagar: a linha some da tabela daquela lista e o contato
 * continua na aba individual, com as conversas dele. Quem quiser mesmo apagá-lo
 * faz isso de lá, onde a ação diz o que é.
 */
export async function removeContactFromBatchAction(input: unknown): Promise<ActionResult> {
  const parsed = batchContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    // A conta entra pelo lote: `ContactImportBatchContact` não tem `accountId`
    // próprio, e é o pai que diz de quem ele é. Ver `check:tenant`.
    const removidos = await prisma.contactImportBatchContact.deleteMany({
      where: {
        batchId: parsed.data.batchId,
        contactId: parsed.data.contactId,
        batch: { accountId },
      },
    });
    if (removidos.count === 0) {
      return { ok: false, error: 'Esta empresa não está nesta lista.' };
    }

    revalidatePath('/contatos');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao remover a empresa da lista.');
  }
}

/**
 * Espera o worker concluir o comando, dentro de um teto.
 *
 * O teto era de 2,5 segundos, e não dava. Sincronizar contatos agora repuxa a
 * agenda inteira do WhatsApp (ver `pullAddressBook` em `worker/session.ts`) —
 * uma ida ao servidor mais a gravação de centenas de linhas. A Server Action
 * respondia antes de qualquer coisa chegar, o contador vinha igual ao anterior
 * e a tela dizia "0 novos" enquanto o worker ainda estava trabalhando.
 *
 * Vinte segundos cobrem uma agenda grande sem transformar a espera numa tela
 * travada. Estourado o teto a função devolve mesmo assim: o trabalho continua
 * no worker, e a lista mostra o resultado no próximo carregamento.
 */
const ESPERA_MAX_MS = 20_000;
/** Intervalo mínimo entre duas sincronizações completas da mesma caixa. */
const INTERVALO_SINCRONIZACAO_CONTATOS_MS = 15 * 60 * 1000;

const aguardarComando = async (commandId: string): Promise<'concluido' | 'em_andamento'> => {
  const inicio = Date.now();
  while (Date.now() - inicio < ESPERA_MAX_MS) {
    await new Promise((r) => setTimeout(r, 400));
    const atual = await prisma.whatsAppCommand.findUnique({
      where: { id: commandId },
      select: { status: true },
    });
    if (atual?.status === 'completed' || atual?.status === 'failed') return 'concluido';
  }
  return 'em_andamento';
};

export async function syncWhatsAppContactsAction(): Promise<
  ActionResult<{ syncedCount: number; newCount: number }>
> {
  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    // Busca exclusivamente conversas 1:1 privadas ativas no WhatsApp desta conta
    const conversations = await prisma.conversation.findMany({
      where: {
        accountId,
        channel: 'whatsapp',
        channelThreadId: { not: { endsWith: '@g.us' } },
      },
      include: { contact: true },
    });

    // 1. Normaliza contatos com conversas 1:1 diretas existentes se necessário
    for (const conv of conversations) {
      const contact = conv.contact;
      if (!contact || contact.kind === 'grupo' || !contact.phone) continue;

      let digits = contact.phone.replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 11) {
        digits = `55${digits}`;
      }
      const normalized = `+${digits}`;
      if (/^\+[1-9]\d{7,14}$/.test(normalized) && normalized !== contact.phone) {
        await prisma.contact.update({
          where: { id: contact.id, accountId },
          data: { phone: normalized },
        });
      }
    }

    const previousContacts = await prisma.contact.count({
      where: { accountId, kind: { not: 'grupo' } },
    });

    const inboxes = await prisma.inbox.findMany({
      where: { accountId, channel: 'whatsapp' },
      include: { waConnection: true },
      orderBy: { id: 'asc' },
    });

    const conectada = inboxes.find(
      (i) => i.waConnection?.status === 'conectado' || Boolean(i.waConnection?.lockOwner),
    );
    const pareada = inboxes.find((i) => Boolean(i.waConnection?.credsCipher));
    const targetInbox = conectada ?? pareada ?? inboxes[0];

    if (!targetInbox) {
      return { ok: false, error: 'Nenhuma caixa de WhatsApp foi configurada nesta conta.' };
    }

    /**
     * Reserva a sincronização de forma atômica.
     *
     * Desabilitar só o botão não basta: duas abas, dois usuários ou uma chamada
     * direta à Server Action ainda poderiam iniciar dois app-state syncs. A
     * coluna no banco torna a proteção comum a todas as instâncias do site.
     */
    const agora = new Date();
    const limite = new Date(agora.getTime() - INTERVALO_SINCRONIZACAO_CONTATOS_MS);
    const reserva = await prisma.whatsAppConnection.updateMany({
      where: {
        inboxId: targetInbox.id,
        OR: [{ lastContactsSyncAt: null }, { lastContactsSyncAt: { lte: limite } }],
      },
      data: { lastContactsSyncAt: agora },
    });

    if (reserva.count === 0) {
      const ultima = await prisma.whatsAppConnection.findUnique({
        where: { inboxId: targetInbox.id },
        select: { lastContactsSyncAt: true },
      });
      const proxima = ultima?.lastContactsSyncAt
        ? new Date(
            ultima.lastContactsSyncAt.getTime() + INTERVALO_SINCRONIZACAO_CONTATOS_MS,
          ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : undefined;
      return {
        ok: false,
        error: proxima
          ? `A agenda foi sincronizada recentemente. Tente novamente após ${proxima}.`
          : 'Já existe uma sincronização recente desta agenda.',
      };
    }

    if (WA_ENGINE === 'inprocess') {
      /**
       * Sem worker não há fila, e sem fila o comando ficaria pendente para
       * sempre.
       *
       * O caminho abaixo enfileirava um `sync_contacts` **em qualquer
       * motor** — mas quem consome essa fila é o worker. Com o motor
       * in-process (o padrão de `npm run dev`), o botão sempre terminava
       * dizendo "sincronizado" sem ter sincronizado nada: o comando ficava
       * `pending` no banco e o contador voltava igual.
       */
      const { whatsappService } = await import('@/infrastructure/whatsapp/whatsapp-service');
      await whatsappService.syncAllStoredContacts(accountId);
    } else {
      const cmd = await prisma.whatsAppCommand.create({
        data: {
          inboxId: targetInbox.id,
          kind: 'sync_contacts',
          payload: { accountId },
          status: 'pending',
        },
      });

      await postgresPubSub.publish(DB_CHANNELS.COMMANDS, {
        inboxId: targetInbox.id,
        kind: 'sync_contacts',
        id: cmd.id,
      });

      await aguardarComando(cmd.id);
    }

    const currentContacts = await prisma.contact.count({
      where: { accountId, kind: { not: 'grupo' } },
    });

    return {
      ok: true,
      data: {
        syncedCount: currentContacts,
        newCount: Math.max(0, currentContacts - previousContacts),
      },
    };
  } catch (error) {
    return failureOf(error, 'Falha ao sincronizar contatos do WhatsApp.');
  }
}

const toggleGroupChatSchema = z.object({
  contactId: z.string().min(1),
  allowed: z.boolean(),
});

export async function toggleGroupChatAction(
  input: unknown,
): Promise<ActionResult<{ contactId: string; allowed: boolean }>> {
  const parsed = toggleGroupChatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;
    const { contactId, allowed } = parsed.data;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, accountId },
    });
    if (!contact) return { ok: false, error: 'Grupo não encontrado.' };

    const currentFields = Array.isArray(contact.customFields)
      ? (contact.customFields as { label: string; value: string }[])
      : [];

    const filtered = currentFields.filter(
      (f) => f.label !== 'group_chat_enabled' && f.label !== 'Permitido no Chat',
    );
    filtered.push({ label: 'group_chat_enabled', value: allowed ? 'true' : 'false' });

    await prisma.contact.update({
      where: { id: contact.id, accountId },
      data: {
        customFields: asJson(filtered),
      },
    });

    return { ok: true, data: { contactId, allowed } };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar permissão do grupo.');
  }
}

export async function syncWhatsAppGroupsAction(): Promise<
  ActionResult<{ syncedCount: number; newCount: number }>
> {
  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    // Busca as conexões de WhatsApp da conta
    const inboxes = await prisma.inbox.findMany({
      where: { accountId, channel: 'whatsapp' },
      include: { waConnection: true },
      orderBy: { id: 'asc' },
    });

    const conectada = inboxes.find(
      (i) => i.waConnection?.status === 'conectado' || Boolean(i.waConnection?.lockOwner),
    );
    const pareada = inboxes.find((i) => Boolean(i.waConnection?.credsCipher));
    const targetInbox = conectada ?? pareada ?? inboxes[0];

    if (!targetInbox) {
      return { ok: false, error: 'Nenhuma conexão de WhatsApp encontrada para esta conta.' };
    }

    const previousCount = await prisma.contact.count({
      where: { accountId, kind: 'grupo' },
    });

    // Mesma razão do lado dos contatos: sem worker, a fila não tem consumidor.
    if (WA_ENGINE === 'inprocess') {
      const { whatsappService } = await import('@/infrastructure/whatsapp/whatsapp-service');
      await whatsappService.syncAllGroups(accountId);

      const semWorker = await prisma.contact.count({ where: { accountId, kind: 'grupo' } });
      return {
        ok: true,
        data: {
          syncedCount: semWorker,
          newCount: Math.max(0, semWorker - previousCount),
        },
      };
    }

    /**
     * Todas as caixas pareadas, não só a primeira.
     *
     * Participar de um grupo é do número. Sincronizando de uma caixa só, os
     * grupos das outras nunca apareciam — e os que apareciam ficavam marcados
     * como pertencentes apenas àquela, que é o que fazia o envio pelas demais
     * ser recusado pelo WhatsApp com `not-authorized`.
     *
     * `groupFetchAllParticipating` devolve só os grupos do número que pergunta,
     * então cada caixa contribui com os seus e se registra neles.
     */
    const pareadas = inboxes.filter((inbox) => Boolean(inbox.waConnection?.credsCipher));
    const alvos = pareadas.length > 0 ? pareadas : [targetInbox];

    for (const inbox of alvos) {
      const command = await prisma.whatsAppCommand.create({
        data: {
          inboxId: inbox.id,
          kind: 'sync_groups',
          payload: { accountId },
          status: 'pending',
        },
      });

      await postgresPubSub.publish(DB_CHANNELS.COMMANDS, {
        inboxId: inbox.id,
        kind: 'sync_groups',
        id: command.id,
      });

      // Em série: cada caixa lê e reescreve `group_inbox_ids` do mesmo contato,
      // e duas sincronizações simultâneas perderiam uma das escritas.
      await aguardarComando(command.id);
    }

    const currentCount = await prisma.contact.count({
      where: { accountId, kind: 'grupo' },
    });

    return {
      ok: true,
      data: {
        syncedCount: currentCount,
        newCount: Math.max(0, currentCount - previousCount),
      },
    };
  } catch (error) {
    return failureOf(error, 'Falha ao sincronizar grupos do WhatsApp.');
  }
}
