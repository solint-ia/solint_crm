/**
 * Teste do horário de funcionamento do agente de IA.
 *
 * O que ele prova, em ordem de importância:
 *
 *  1. fora do horário **o webhook é entregue com agentePausado: true** e
 *     `agenteNoHorario: false` para que o n8n/Redis alimente a memória do contato
 *     sem gerar resposta automática;
 *  2. dentro do horário, o webhook é entregue com `agentePausado: false` e
 *     `agenteNoHorario: true`;
 *  3. o que decide é o instante **da mensagem**, e não o do disparo: uma fila
 *     represada que chega às 9h não acorda o agente pelo que entrou às 23h;
 *  4. a grade é lida no fuso dela, e a caixa que nunca configurou nada segue
 *     como antes (agente sempre ligado).
 *
 * Cria a própria conta e apaga tudo no fim. Os webhooks apontam para uma porta
 * fechada: o teste lê a outbox, nunca entrega.
 *
 *   npx tsx scripts/test-horario-do-agente.ts
 */
import { randomUUID } from 'node:crypto';

import {
  agentWorksAt,
  normalizeAgentSchedule,
  type AgentSchedule,
} from '../src/core/domain/agent-schedule';
import {
  defaultBusinessHours,
  WEEKDAYS,
  type BusinessHours,
} from '../src/core/domain/business-hours';
import type { Contact } from '../src/core/domain/contact';
import { container } from '../src/infrastructure/container';
import { prisma } from '../src/infrastructure/db/prisma';
import {
  agenteAtendeEm,
  dispararWebhooks,
  type WebhookEvent,
  type WebhookPayloadEmMontagem,
} from '../src/infrastructure/webhooks/webhook-dispatch';
import { commitMessage, resolveStoredIds } from '../src/infrastructure/whatsapp/wa-store';
import type { ChatIdentity } from '../src/infrastructure/whatsapp/wa-identity';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};
const info = (label: string, detalhe: string) => console.log(`  INFO  ${label} — ${detalhe}`);

const FUSO = 'America/Sao_Paulo';

/** Instante a partir da hora de Brasília (UTC-3, sem horário de verão desde 2019). */
const emBrasilia = (dataHora: string): Date => new Date(`${dataHora}:00-03:00`);

// Datas passadas de propósito: nada aqui deve parecer mensagem do futuro.
const SEG_MEIO_DIA = emBrasilia('2026-09-07T12:00');
const SEG_0859 = emBrasilia('2026-09-07T08:59');
const SEG_0900 = emBrasilia('2026-09-07T09:00');
const SEG_1730 = emBrasilia('2026-09-07T17:30');
const SEG_1800 = emBrasilia('2026-09-07T18:00');
const SEG_2300 = emBrasilia('2026-09-07T23:00');
const TER_MEIO_DIA = emBrasilia('2026-09-08T12:00');
const TER_0100 = emBrasilia('2026-09-08T01:00');
const SEG_0100 = emBrasilia('2026-09-07T01:00');

const diaNoFuso = (instante: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(instante);

/** Grade com só os dias pedidos ligados, todos no mesmo horário. */
const grade = (dias: readonly string[], abre: string, fecha: string): BusinessHours => ({
  timezone: FUSO,
  days: WEEKDAYS.map((day) => ({
    day,
    enabled: dias.includes(day),
    opensAt: abre,
    closesAt: fecha,
  })),
});

const SO_SEGUNDA: AgentSchedule = { enabled: true, hours: grade(['seg'], '09:00', '18:00') };
const NENHUM_DIA: AgentSchedule = { enabled: true, hours: grade([], '09:00', '18:00') };

const sufixo = randomUUID().slice(0, 8);
const CONTA = `acc-agenda-${sufixo}`;
const TELEFONE = '5599900000002';

let sequencia = 0;

const payloadDe = (
  caixaId: string,
  conversaId: string,
  contatoId: string,
  momento: Date | null,
): WebhookPayloadEmMontagem => {
  const mensagemId = `msg-${sufixo}-${++sequencia}`;
  return {
    event: 'messages.upsert',
    instance: 'Caixa do horário',
    data: {
      key: { remoteJid: `${TELEFONE}@s.whatsapp.net`, fromMe: false, id: mensagemId },
      message: { conversation: 'oi' },
      contextInfo: null,
      messageType: 'conversation',
      messageTimestamp: momento ? Math.floor(momento.getTime() / 1000) : 0,
      instanceId: caixaId,
      source: 'teste',
    },
    date_time: new Date().toISOString(),
    sender: '5579988888888@s.whatsapp.net',
    solint: {
      contaId: CONTA,
      caixaEntradaId: caixaId,
      conversaId,
      contatoId,
      mensagemId,
      conversaNova: false,
    },
  };
};

/** Quantas entregas a outbox criou para este disparo. */
const entregasDo = async (
  evento: WebhookEvent,
  payload: WebhookPayloadEmMontagem,
): Promise<number> => {
  await dispararWebhooks(evento, payload, { throwOnError: true });
  return prisma.webhookDelivery.count({
    where: { accountId: CONTA, dedupeKey: `${evento}:${payload.solint.mensagemId}` },
  });
};

const dominio = () => {
  console.log('\n1) Domínio: normalização e regra');
  const padrao = defaultBusinessHours();

  const vazia = normalizeAgentSchedule(null, padrao);
  check('coluna vazia vira agenda desligada', vazia.enabled === false);
  check('coluna vazia herda a grade de atendimento', vazia.hours === padrao);
  check(
    '"true" em texto não liga a agenda',
    normalizeAgentSchedule({ enabled: 'true' }, padrao).enabled === false,
  );

  const parcial = normalizeAgentSchedule(
    { enabled: true, hours: { days: [{ day: 'Segunda', enabled: true, opensAt: '9:00', closesAt: '1800' }] } },
    padrao,
  );
  const segunda = parcial.hours.days.find((d) => d.day === 'seg');
  check('grade parcial vira sete dias', parcial.hours.days.length === 7);
  check(
    'hora solta é normalizada',
    segunda?.opensAt === '09:00' && segunda.closesAt === '18:00',
    `${segunda?.opensAt}–${segunda?.closesAt}`,
  );
  check('fuso ausente cai no de Brasília', parcial.hours.timezone === FUSO);

  check('as datas do teste caem nos dias certos', diaNoFuso(SEG_MEIO_DIA) === 'Mon' && diaNoFuso(TER_MEIO_DIA) === 'Tue');
  check('desligada: atende a qualquer hora', agentWorksAt({ ...SO_SEGUNDA, enabled: false }, TER_0100));
  check('segunda 12h: atende', agentWorksAt(SO_SEGUNDA, SEG_MEIO_DIA));
  check('terça 12h: não atende', !agentWorksAt(SO_SEGUNDA, TER_MEIO_DIA));
  check('08:59: ainda não', !agentWorksAt(SO_SEGUNDA, SEG_0859));
  check('09:00: já atende', agentWorksAt(SO_SEGUNDA, SEG_0900));
  check('18:00: já encerrou', !agentWorksAt(SO_SEGUNDA, SEG_1800));
  // 17:30 em Brasília são 20:30 em UTC. Lida no relógio do processo (UTC em
  // produção), a grade diria "fechado".
  check('17:30 de Brasília (20:30 UTC): atende', agentWorksAt(SO_SEGUNDA, SEG_1730));
  check('nenhum dia ligado: nunca atende', !agentWorksAt(NENHUM_DIA, SEG_MEIO_DIA));

  // Faixa que atravessa a meia-noite. Não é asserção: é a semântica herdada de
  // `isWithinBusinessHours`, registrada para quem for configurar um plantão.
  const noturno: AgentSchedule = { enabled: true, hours: grade(['seg'], '22:00', '02:00') };
  info('seg 22:00–02:00, segunda 23h', agentWorksAt(noturno, SEG_2300) ? 'atende' : 'não atende');
  info('seg 22:00–02:00, terça 01h', agentWorksAt(noturno, TER_0100) ? 'atende' : 'não atende');
  info('seg 22:00–02:00, segunda 01h', agentWorksAt(noturno, SEG_0100) ? 'atende' : 'não atende');
};

const identidade = (inboxId: string): ChatIdentity => ({
  jid: `${TELEFONE}@s.whatsapp.net`,
  isGroup: false,
  phone: `+${TELEFONE}`,
  key: TELEFONE,
  contactId: `ct-wa-${CONTA}-${TELEFONE}`,
  conversationId: `cv-wa-${inboxId}-${TELEFONE}`,
});

const contato = (id: string): Contact => ({
  id,
  accountId: CONTA,
  name: 'Cliente do horário',
  phone: `+${TELEFONE}`,
  channel: 'whatsapp',
  avatarTone: 'var(--color-brand)',
  labels: [],
  customFields: [],
});

/** Entrega uma mensagem pela caixa, como o worker faria, no instante `momento`. */
const receber = async (inboxId: string, texto: string, momento: Date) => {
  const chat = await resolveStoredIds(CONTA, inboxId, identidade(inboxId));
  const messageId = `msg-${sufixo}-${++sequencia}`;
  await commitMessage({
    accountId: CONTA,
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
    at: momento,
    fromMe: false,
    silent: true,
    webhookPayload: (refs) => ({
      ...payloadDe(inboxId, refs.conversaId, refs.contatoId, momento),
      solint: refs,
    }),
  });
  const gravada = await prisma.message.count({ where: { id: messageId } });
  const fontes = await prisma.webhookEventOutbox.count({
    where: { accountId: CONTA, dedupeKey: { endsWith: `:${messageId}` } },
  });
  return { gravada, fontes };
};

const banco = async () => {
  await prisma.account.create({ data: { id: CONTA, name: `Agenda ${sufixo}`, plan: 'teste' } });

  console.log('\n2) Caixa nova e gravação pela tela');
  const criada = await container.settings.createInbox(CONTA, { name: 'Caixa do horário' });
  check('caixa nova nasce com o agente sempre ligado', criada.aiAgentSchedule.enabled === false);
  check(
    'a grade inicial do agente é a de atendimento',
    JSON.stringify(criada.aiAgentSchedule.hours) === JSON.stringify(criada.businessHours),
  );
  const cru = await prisma.inbox.findUnique({
    where: { id: criada.id },
    select: { aiAgentSchedule: true, awayMessage: true },
  });
  check('coluna do agente fica vazia até alguém configurar', cru?.aiAgentSchedule === null);
  check(
    'awayMessage não é mais escrita (fica no padrão)',
    JSON.stringify(cru?.awayMessage) === '{}',
    JSON.stringify(cru?.awayMessage),
  );

  const salva = await container.settings.updateInbox(CONTA, criada.id, {
    aiAgentSchedule: SO_SEGUNDA,
  });
  check('o horário do agente é gravado', salva.aiAgentSchedule.enabled === true);
  check(
    'e volta igual na leitura',
    JSON.stringify(salva.aiAgentSchedule.hours) === JSON.stringify(SO_SEGUNDA.hours),
  );
  const soExpediente = await container.settings.updateInbox(CONTA, criada.id, {
    businessHours: grade(['seg', 'ter', 'qua', 'qui', 'sex'], '08:00', '17:00'),
  });
  check(
    'mudar o atendimento não mexe no horário do agente',
    JSON.stringify(soExpediente.aiAgentSchedule) === JSON.stringify(salva.aiAgentSchedule),
  );

  const caixa = criada.id;
  const outraCaixa = (await container.settings.createInbox(CONTA, { name: 'Caixa sem horário' })).id;

  const contatoId = `ct-${sufixo}`;
  await prisma.contact.create({
    data: { id: contatoId, accountId: CONTA, name: 'Cliente', phone: '5579911111112', channel: 'whatsapp', avatarTone: 'slate' },
  });
  const conversa = async (id: string, inboxId: string) =>
    prisma.conversation.create({
      data: { id, accountId: CONTA, contactId: contatoId, channel: 'whatsapp', inboxId, queue: 'Atendimento', status: 'aberta', statusLabel: 'Aberta' },
      select: { id: true },
    });
  const conversaDaCaixa = (await conversa(`cv-${sufixo}-a`, caixa)).id;
  const conversaDaOutra = (await conversa(`cv-${sufixo}-b`, outraCaixa)).id;

  for (const nome of ['Agente n8n', 'Relatório']) {
    await prisma.webhook.create({
      data: {
        accountId: CONTA,
        name: nome,
        url: 'http://127.0.0.1:1/nao-usado',
        events: ['mensagem.recebida', 'conversa.criada', 'conversa.resolvida'],
        isActive: true,
        allInboxes: true,
      },
    });
  }

  console.log('\n3) A pergunta "o agente atendia?"');
  check('segunda 12h: sim', await agenteAtendeEm(CONTA, caixa, SEG_MEIO_DIA));
  check('terça 12h: não', !(await agenteAtendeEm(CONTA, caixa, TER_MEIO_DIA)));
  check('caixa sem horário: sempre sim', await agenteAtendeEm(CONTA, outraCaixa, TER_MEIO_DIA));
  check('evento sem caixa: sim, como antes', await agenteAtendeEm(CONTA, undefined, TER_MEIO_DIA));
  check('caixa de outra conta não empresta a agenda', await agenteAtendeEm('acc-outra', caixa, TER_MEIO_DIA));

  console.log('\n4) Disparo: fora do horário entrega com agentePausado: true');
  const payloadSegunda = payloadDe(caixa, conversaDaCaixa, contatoId, SEG_MEIO_DIA);
  const dentro = await entregasDo('mensagem.recebida', payloadSegunda);
  check('dentro do horário: uma entrega por webhook', dentro === 2, `${dentro}`);
  const entregaDentro = await prisma.webhookDelivery.findFirst({
    where: { accountId: CONTA, dedupeKey: `mensagem.recebida:${payloadSegunda.solint.mensagemId}` },
  });
  const corpoDentro = JSON.parse(entregaDentro?.payload as string);
  check('dentro do horário: agentePausado é false', corpoDentro.solint.agentePausado === false);
  check('dentro do horário: agenteNoHorario é true', corpoDentro.solint.agenteNoHorario === true);

  const payloadTerca = payloadDe(caixa, conversaDaCaixa, contatoId, TER_MEIO_DIA);
  const fora = await entregasDo('mensagem.recebida', payloadTerca);
  check('fora do horário: webhook É entregue para alimentar o Redis', fora === 2, `${fora}`);
  const entregaFora = await prisma.webhookDelivery.findFirst({
    where: { accountId: CONTA, dedupeKey: `mensagem.recebida:${payloadTerca.solint.mensagemId}` },
  });
  const corpoFora = JSON.parse(entregaFora?.payload as string);
  check('fora do horário: agentePausado é true', corpoFora.solint.agentePausado === true);
  check('fora do horário: agenteNoHorario é false', corpoFora.solint.agenteNoHorario === false);

  const foraCriada = await entregasDo('conversa.criada', payloadDe(caixa, conversaDaCaixa, contatoId, TER_MEIO_DIA));
  check('conversa.criada fora do horário: entrega', foraCriada === 2, `${foraCriada}`);
  const outra = await entregasDo('mensagem.recebida', payloadDe(outraCaixa, conversaDaOutra, contatoId, TER_MEIO_DIA));
  check('a outra caixa, sem horário, continua recebendo normalmente', outra === 2, `${outra}`);

  // Sem `messageTimestamp`, vale o relógio. Com nenhum dia ligado, "agora" é
  // sempre fora (agentePausado: true).
  await container.settings.updateInbox(CONTA, caixa, { aiAgentSchedule: NENHUM_DIA });
  const payloadSemHora = payloadDe(caixa, conversaDaCaixa, contatoId, null);
  const semHora = await entregasDo('mensagem.recebida', payloadSemHora);
  check('sem hora na mensagem: webhook entregue', semHora === 2, `${semHora}`);
  const entregaSemHora = await prisma.webhookDelivery.findFirst({
    where: { accountId: CONTA, dedupeKey: `mensagem.recebida:${payloadSemHora.solint.mensagemId}` },
  });
  const corpoSemHora = JSON.parse(entregaSemHora?.payload as string);
  check('sem hora na mensagem: agentePausado é true (fora)', corpoSemHora.solint.agentePausado === true);

  console.log('\n5) Mensagem gravada pelo worker (commitMessage)');
  await container.settings.updateInbox(CONTA, caixa, { aiAgentSchedule: SO_SEGUNDA });
  const foraDoHorario = await receber(caixa, 'mensagem da terça', TER_MEIO_DIA);
  check('fora do horário: a mensagem entra no CRM', foraDoHorario.gravada === 1);
  check('fora do horário: evento-fonte na outbox (para alimentar memória)', foraDoHorario.fontes === 1, `${foraDoHorario.fontes}`);
  const noHorario = await receber(caixa, 'mensagem da segunda', SEG_MEIO_DIA);
  check('no horário: a mensagem entra no CRM', noHorario.gravada === 1);
  check('no horário: evento-fonte na outbox', noHorario.fontes === 1, `${noHorario.fontes}`);
};

async function main() {
  dominio();
  try {
    await banco();
  } finally {
    // A conta leva caixas, contatos, conversas, mensagens, webhooks e entregas.
    await prisma.account.delete({ where: { id: CONTA } }).catch(() => {
      console.error(`\n  Atenção: a conta de teste ${CONTA} não pôde ser removida.`);
    });
    // O evento-fonte não tem chave estrangeira para a conta.
    await prisma.webhookEventOutbox.deleteMany({ where: { accountId: CONTA } }).catch(() => undefined);
  }
}

main()
  .then(async () => {
    console.log(
      falhas.length === 0
        ? '\nTodos os testes passaram.\n'
        : `\n${falhas.length} teste(s) falharam: ${falhas.join(', ')}\n`,
    );
    await prisma.$disconnect();
    // Gravar publica um `NOTIFY`, e a conexão do publicador segura o processo.
    process.exit(falhas.length === 0 ? 0 : 1);
  })
  .catch(async (erro) => {
    console.error('\nErro no teste:', erro);
    await prisma.$disconnect();
    process.exit(1);
  });
