import type { Conversation } from '@/core/domain/conversation';
import type { Message, TimelineItem } from '@/core/domain/message';
import { contactById } from './contacts';
import { ACCOUNT_ID, LABEL } from './workspace';

const hoursAgo = (hours: number): string =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

let messageSequence = 0;
const nextMessageId = (): string => {
  messageSequence += 1;
  return `msg-seed-${messageSequence}`;
};

const divider = (label: string): TimelineItem => ({ kind: 'divider', label });

const message = (
  conversationId: string,
  partial: Omit<Message, 'id' | 'conversationId' | 'isPrivate'> & { isPrivate?: boolean },
): TimelineItem => ({
  kind: 'message',
  message: {
    id: nextMessageId(),
    conversationId,
    isPrivate: false,
    ...partial,
  },
});

export const CONVERSATIONS: readonly Conversation[] = [
  {
    id: 'cv-mariana',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-mariana'),
    channel: 'whatsapp',
    inboxId: 'ibx-wa-oficial',
    queue: 'Comercial',
    status: 'aberta',
    statusLabel: 'Em andamento',
    priority: 'media',
    assigneeId: 'user-rafael',
    assigneeName: 'Rafael Souza',
    unreadCount: 0,
    lastMessagePreview: 'Perfeito, pode confirmar o horário de entrega?',
    lastMessageAt: '09:20',
    labels: [LABEL.vip, LABEL.recorrente],
    protocols: [
      { code: '#AT-84920', date: '12 jul 2026', status: 'Resolvido' },
      { code: '#AT-83410', date: '02 jun 2026', status: 'Resolvido' },
    ],
    isTyping: true,
    collisionAgent: 'Camila Reis',
    lastInboundAt: hoursAgo(2),
    timeline: [
      divider('Hoje'),
      message('cv-mariana', {
        author: 'contact',
        content: {
          type: 'text',
          text: 'Oi, bom dia! Fiz um pedido ontem e queria saber o status da entrega.',
        },
        time: '09:14',
      }),
      message('cv-mariana', {
        author: 'agent',
        authorName: 'Rafael Souza',
        content: { type: 'text', text: 'Bom dia, Mariana! Deixa eu verificar aqui pra você.' },
        time: '09:16',
        deliveryStatus: 'lido',
      }),
      message('cv-mariana', {
        author: 'agent',
        authorName: 'Rafael Souza',
        content: {
          type: 'audio',
          duration: '0:42',
          transcript:
            'Confirmado, seu pedido saiu do centro de distribuição hoje de manhã e chega até quinta-feira.',
        },
        time: '09:17',
        deliveryStatus: 'entregue',
      }),
      message('cv-mariana', {
        author: 'contact',
        content: { type: 'text', text: 'Perfeito, pode confirmar o horário de entrega?' },
        time: '09:20',
      }),
    ],
  },
  {
    id: 'cv-joao',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-joao'),
    channel: 'whatsapp',
    inboxId: 'ibx-wa-oficial',
    queue: 'Financeiro',
    status: 'espera',
    statusLabel: 'Em espera',
    priority: 'alta',
    unreadCount: 2,
    lastMessagePreview: 'Alguém pode me ajudar?',
    lastMessageAt: '13:40',
    labels: [LABEL.urgente],
    protocols: [{ code: '#AT-85102', date: 'ontem', status: 'Pendente' }],
    slaLabel: 'SLA estourado',
    slaBreached: true,
    lastInboundAt: hoursAgo(5),
    timeline: [
      divider('Hoje'),
      message('cv-joao', {
        author: 'contact',
        content: { type: 'text', text: 'Ainda não recebi o boleto da minha compra, pode reenviar?' },
        time: '08:02',
      }),
      message('cv-joao', {
        author: 'agent',
        authorName: 'Rafael Souza',
        isPrivate: true,
        content: {
          type: 'text',
          text: 'Cliente já pagou via Pix ontem às 19h. Conferir com o financeiro antes de reenviar o boleto para não cobrar em duplicidade.',
        },
        time: '08:05',
      }),
      message('cv-joao', {
        author: 'contact',
        content: { type: 'text', text: 'Alguem pode me ajudar?' },
        time: '13:40',
      }),
    ],
  },
  {
    id: 'cv-fernanda',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-fernanda'),
    channel: 'webchat',
    inboxId: 'ibx-webchat',
    queue: 'Suporte N1',
    status: 'resolvida',
    statusLabel: 'Encerrada pelo Agente IA',
    priority: 'baixa',
    unreadCount: 0,
    lastMessagePreview: 'Não, só isso. Obrigada!',
    lastMessageAt: '12:40',
    labels: [LABEL.novo],
    protocols: [{ code: '#AT-85220', date: 'hoje', status: 'Resolvido' }],
    lastInboundAt: hoursAgo(3),
    timeline: [
      divider('Hoje'),
      message('cv-fernanda', {
        author: 'contact',
        content: { type: 'text', text: 'Qual o prazo de garantia do produto?' },
        time: '12:38',
      }),
      message('cv-fernanda', {
        author: 'ai',
        authorName: 'Agente IA · Suporte N1',
        content: {
          type: 'text',
          text: 'Olá! Nossos produtos têm garantia de 12 meses contra defeitos de fabricação. Posso ajudar com mais alguma coisa?',
        },
        time: '12:38',
        deliveryStatus: 'lido',
      }),
      message('cv-fernanda', {
        author: 'contact',
        content: { type: 'text', text: 'Não, só isso. Obrigada!' },
        time: '12:40',
      }),
      message('cv-fernanda', {
        author: 'system',
        content: { type: 'system', text: 'Conversa encerrada automaticamente pelo Agente IA' },
        time: '12:41',
      }),
    ],
  },
  {
    id: 'cv-carlos',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-carlos'),
    channel: 'whatsapp',
    inboxId: 'ibx-wa-oficial',
    queue: 'Comercial',
    status: 'resolvida',
    statusLabel: 'Encerrada',
    priority: 'baixa',
    assigneeId: 'user-rafael',
    assigneeName: 'Rafael Souza',
    unreadCount: 0,
    lastMessagePreview: 'Aprovado! Muito obrigado pela agilidade.',
    lastMessageAt: 'Ontem',
    labels: [LABEL.recorrente],
    protocols: [
      { code: '#AT-81004', date: '20 mai 2026', status: 'Resolvido' },
      { code: '#AT-79930', date: '03 abr 2026', status: 'Resolvido' },
    ],
    lastInboundAt: hoursAgo(30),
    timeline: [
      divider('Ontem'),
      message('cv-carlos', {
        author: 'agent',
        authorName: 'Rafael Souza',
        content: {
          type: 'text',
          text: 'Fechamos o orcamento com o desconto combinado, pode confirmar por aqui quando aprovar.',
        },
        time: '16:02',
        deliveryStatus: 'lido',
      }),
      message('cv-carlos', {
        author: 'contact',
        content: { type: 'text', text: 'Aprovado! Muito obrigado pela agilidade.' },
        time: '16:10',
      }),
    ],
  },
  {
    id: 'cv-pedro',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-pedro'),
    channel: 'instagram',
    inboxId: 'ibx-instagram',
    queue: 'Comercial',
    status: 'aberta',
    statusLabel: 'Em andamento',
    priority: 'urgente',
    unreadCount: 1,
    lastMessagePreview: 'Temos sim! Posso separar uma unidade pra você',
    lastMessageAt: '11:08',
    labels: [],
    protocols: [],
    channelOffline: true,
    lastInboundAt: hoursAgo(4),
    timeline: [
      divider('Hoje'),
      message('cv-pedro', {
        author: 'contact',
        content: { type: 'text', text: 'Vi o produto no feed, ainda tem em estoque?' },
        time: '11:05',
      }),
      message('cv-pedro', {
        author: 'agent',
        authorName: 'Camila Reis',
        content: { type: 'text', text: 'Temos sim! Posso separar uma unidade pra você.' },
        time: '11:08',
        deliveryStatus: 'falha',
      }),
    ],
  },
  {
    id: 'cv-ana',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-ana'),
    channel: 'whatsapp',
    inboxId: 'ibx-wa-oficial',
    queue: 'Suporte N1',
    status: 'resolvida',
    statusLabel: 'Encerrada',
    priority: 'baixa',
    assigneeId: 'user-rafael',
    assigneeName: 'Rafael Souza',
    unreadCount: 0,
    lastMessagePreview: 'Obrigada!',
    lastMessageAt: 'Ontem',
    labels: [],
    protocols: [{ code: '#AT-84711', date: 'ontem', status: 'Resolvido' }],
    lastInboundAt: hoursAgo(28),
    timeline: [
      divider('Ontem'),
      message('cv-ana', {
        author: 'agent',
        authorName: 'Rafael Souza',
        content: { type: 'text', text: 'Qualquer coisa é só chamar!' },
        time: '17:40',
        deliveryStatus: 'lido',
      }),
      message('cv-ana', {
        author: 'contact',
        content: { type: 'text', text: 'Obrigada!' },
        time: '17:42',
      }),
    ],
  },
  {
    id: 'cv-roberta',
    accountId: ACCOUNT_ID,
    contact: contactById('ct-roberta'),
    channel: 'webchat',
    inboxId: 'ibx-webchat',
    queue: 'Comercial',
    status: 'pendente',
    statusLabel: 'Aguardando retorno',
    priority: 'media',
    unreadCount: 1,
    lastMessagePreview: 'Recebi a proposta, vou avaliar com o financeiro.',
    lastMessageAt: '10:12',
    labels: [LABEL.proposta],
    protocols: [],
    slaLabel: 'SLA em 42 min',
    lastInboundAt: hoursAgo(6),
    timeline: [
      divider('Hoje'),
      message('cv-roberta', {
        author: 'contact',
        content: {
          type: 'text',
          text: 'Recebi a proposta, vou avaliar com o financeiro e retorno até sexta.',
        },
        time: '10:12',
      }),
    ],
  },
];
