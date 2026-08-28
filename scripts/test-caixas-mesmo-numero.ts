/**
 * Duas caixas da mesma conta recebendo do mesmo número.
 *
 * O defeito que este teste tranca: o id da conversa era derivado de
 * **conta + telefone**, sem a caixa. Um cliente que escrevesse para os dois
 * números da mesma empresa tinha a segunda mensagem anexada à conversa da
 * primeira caixa — a caixa que recebeu ficava vazia, os dois assuntos viravam
 * uma timeline só, e a resposta saía pelo número errado, porque o envio usa a
 * caixa **da conversa**. Nada falhava: a mensagem só sumia de onde entrou.
 *
 * Roda contra o banco de verdade porque é lá que o defeito morava — a chave
 * primária. Um teste com repositório de mentira não teria chave primária
 * nenhuma e passaria com o código quebrado.
 *
 * Tudo acontece dentro de uma conta descartável, apagada no final. O
 * `onDelete: Cascade` de `Account` leva junto caixas, contatos, conversas e
 * mensagens, então não sobra nada mesmo se o teste falhar no meio.
 *
 *   npx tsx scripts/test-caixas-mesmo-numero.ts
 */
import { randomUUID } from 'node:crypto';
import type { Contact } from '../src/core/domain/contact';
import { prisma, asJson } from '../src/infrastructure/db/prisma';
import { defaultBusinessHours } from '../src/core/domain/business-hours';
import { commitMessage, resolveStoredIds } from '../src/infrastructure/whatsapp/wa-store';
import type { ChatIdentity } from '../src/infrastructure/whatsapp/wa-identity';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

const sufixo = randomUUID().slice(0, 8);
const ACCOUNT_ID = `acc-teste-${sufixo}`;
const INBOX_A = `ibx-teste-a-${sufixo}`;
const INBOX_B = `ibx-teste-b-${sufixo}`;
/** Um número improvável de existir de verdade, para não cruzar com dado real. */
const TELEFONE = '5599900000001';
const JID = `${TELEFONE}@s.whatsapp.net`;

const criarCaixa = (id: string, nome: string) =>
  prisma.inbox.create({
    data: {
      id,
      accountId: ACCOUNT_ID,
      name: nome,
      channel: 'whatsapp',
      identifier: nome,
      status: 'conectado',
      provider: 'baileys',
      businessHours: asJson(defaultBusinessHours()),
      awayMessage: asJson({ enabled: false, message: '' }),
      greeting: asJson({ enabled: false, message: '' }),
    },
  });

/**
 * A identidade como `identityFromKey` a produz para uma caixa.
 *
 * Reproduzida aqui em vez de importada porque a função é privada do módulo — e
 * é justamente o formato dela que este teste precisa poder afirmar. Se o
 * formato mudar lá e não aqui, a asserção de ids distintos avisa.
 */
const identidade = (inboxId: string): ChatIdentity => ({
  jid: JID,
  isGroup: false,
  phone: `+${TELEFONE}`,
  key: TELEFONE,
  contactId: `ct-wa-${ACCOUNT_ID}-${TELEFONE}`,
  conversationId: `cv-wa-${inboxId}-${TELEFONE}`,
});

const contato = (id: string): Contact => ({
  id,
  accountId: ACCOUNT_ID,
  name: 'Cliente de Teste',
  phone: `+${TELEFONE}`,
  channel: 'whatsapp',
  avatarTone: 'var(--color-brand)',
  labels: [],
  customFields: [],
});

/** Entrega uma mensagem pela caixa indicada, como o worker faria. */
const receber = async (inboxId: string, texto: string, messageId: string) => {
  const chat = await resolveStoredIds(ACCOUNT_ID, inboxId, identidade(inboxId));

  await commitMessage({
    accountId: ACCOUNT_ID,
    inboxId,
    chat,
    contact: contato(chat.contactId),
    message: {
      id: messageId,
      externalId: messageId,
      conversationId: chat.conversationId,
      author: 'contact',
      content: { type: 'text', text: texto },
      time: '12:00',
      isPrivate: false,
    },
    preview: texto,
    at: new Date(),
    fromMe: false,
    silent: true,
  });

  return chat;
};

const main = async () => {
  console.log('\nDuas caixas, um número\n');

  await prisma.account.create({
    data: { id: ACCOUNT_ID, name: `Teste ${sufixo}`, plan: 'starter' },
  });
  await criarCaixa(INBOX_A, 'Caixa A');
  await criarCaixa(INBOX_B, 'Caixa B');

  try {
    // O mesmo número escreve para os dois números da empresa.
    const chatA = await receber(INBOX_A, 'oi, quero agendar', `msg-a-${sufixo}`);
    const chatB = await receber(INBOX_B, 'oi, sobre a fatura', `msg-b-${sufixo}`);

    check(
      'cada caixa deriva um id de conversa próprio',
      chatA.conversationId !== chatB.conversationId,
      `${chatA.conversationId} / ${chatB.conversationId}`,
    );

    const conversas = await prisma.conversation.findMany({
      where: { accountId: ACCOUNT_ID },
      select: { id: true, inboxId: true, lastMessagePreview: true, contactId: true },
      orderBy: { inboxId: 'asc' },
    });

    check('duas conversas gravadas', conversas.length === 2, `${conversas.length} encontrada(s)`);

    const daA = conversas.find((c) => c.inboxId === INBOX_A);
    const daB = conversas.find((c) => c.inboxId === INBOX_B);

    check('a conversa da Caixa A ficou na Caixa A', daA !== undefined);
    check('a conversa da Caixa B ficou na Caixa B', daB !== undefined);
    check(
      'cada conversa guarda a mensagem que entrou por ela',
      daA?.lastMessagePreview === 'oi, quero agendar' &&
        daB?.lastMessagePreview === 'oi, sobre a fatura',
      `A="${daA?.lastMessagePreview}" B="${daB?.lastMessagePreview}"`,
    );

    // O contato é da conta, não da caixa: é a mesma pessoa falando por dois
    // canais, e duplicá-la partiria o histórico do cliente em dois cadastros.
    const contatos = await prisma.contact.findMany({
      where: { accountId: ACCOUNT_ID },
      select: { id: true },
    });
    check('um contato só para as duas conversas', contatos.length === 1, `${contatos.length}`);
    check(
      'as duas conversas apontam para o mesmo contato',
      daA?.contactId === daB?.contactId && daA?.contactId === contatos[0]?.id,
    );

    // Reentrega na mesma caixa não pode abrir uma terceira conversa.
    await receber(INBOX_A, 'esqueci de dizer', `msg-a2-${sufixo}`);
    const depois = await prisma.conversation.count({ where: { accountId: ACCOUNT_ID } });
    check('mensagem seguinte reaproveita a conversa da caixa', depois === 2, `${depois}`);

    const mensagensA = await prisma.message.count({ where: { conversationId: daA?.id ?? '' } });
    check('as duas mensagens da Caixa A ficaram juntas', mensagensA === 2, `${mensagensA}`);
  } finally {
    await prisma.account.delete({ where: { id: ACCOUNT_ID } }).catch(() => {
      console.error(`\n  Atenção: a conta de teste ${ACCOUNT_ID} não pôde ser removida.`);
    });
    await prisma.$disconnect();
  }

  if (falhas.length > 0) {
    console.error(`\n${falhas.length} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  console.log('\nTudo certo: caixas distintas, conversas distintas, um contato só.\n');

  // Saída explícita: gravar uma conversa publica um `NOTIFY`, e o publicador
  // do Postgres deixa uma conexão aberta que segura o event loop. Sem isto o
  // teste passa e o processo fica pendurado para sempre.
  process.exit(0);
};

void main();
