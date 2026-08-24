import type { Campaign, Segment, WhatsAppTemplate } from '@/core/domain/campaign';
import { ACCOUNT_ID } from './workspace';

export const CAMPAIGNS: readonly Campaign[] = [
  {
    id: 'cp-reativacao',
    accountId: ACCOUNT_ID,
    name: 'Reativação Agosto',
    status: 'em_andamento',
    segmentName: 'Clientes inativos 60+ dias',
    templateName: 'reativacao_desconto_v2',
    scheduledLabel: 'Hoje, 08:00',
    metrics: { recipients: 2000, sent: 1482, delivered: 1393, read: 861, failed: 27 },
  },
  {
    id: 'cp-pro',
    accountId: ACCOUNT_ID,
    name: 'Lançamento Plano Pro',
    status: 'concluida',
    segmentName: 'Clientes VIP',
    templateName: 'lancamento_plano_pro',
    scheduledLabel: '12 ago, 10:00',
    metrics: { recipients: 184, sent: 184, delivered: 178, read: 118, failed: 6 },
  },
  {
    id: 'cp-nps',
    accountId: ACCOUNT_ID,
    name: 'Pesquisa NPS Q3',
    status: 'agendada',
    segmentName: 'Clientes ativos',
    templateName: 'pesquisa_nps_padrao',
    scheduledLabel: '25 ago, 09:00',
    metrics: { recipients: 640, sent: 0, delivered: 0, read: 0, failed: 0 },
  },
  {
    id: 'cp-black',
    accountId: ACCOUNT_ID,
    name: 'Black Week · aquecimento',
    status: 'rascunho',
    segmentName: '—',
    templateName: '—',
    scheduledLabel: '—',
    metrics: { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
  },
  {
    id: 'cp-cobranca',
    accountId: ACCOUNT_ID,
    name: 'Cobrança fatura julho',
    status: 'pausada',
    segmentName: 'Faturas em aberto',
    templateName: 'lembrete_fatura',
    scheduledLabel: '30 jul, 14:00',
    metrics: { recipients: 310, sent: 214, delivered: 189, read: 102, failed: 25 },
  },
];

export const SEGMENTS: readonly Segment[] = [
  {
    id: 'sg-inativos',
    accountId: ACCOUNT_ID,
    name: 'Clientes inativos 60+ dias',
    description: 'Sem conversa nos últimos 60 dias',
    contactCount: 2000,
  },
  {
    id: 'sg-vip',
    accountId: ACCOUNT_ID,
    name: 'Clientes VIP',
    description: 'Etiqueta VIP aplicada',
    contactCount: 184,
  },
  {
    id: 'sg-leads',
    accountId: ACCOUNT_ID,
    name: 'Leads em negociação',
    description: 'Cards ativos no funil Comercial',
    contactCount: 96,
  },
];

export const TEMPLATES: readonly WhatsAppTemplate[] = [
  {
    id: 'tp-reativacao',
    accountId: ACCOUNT_ID,
    name: 'reativacao_desconto_v2',
    body: 'Olá {{1}}! Sentimos sua falta. Preparamos uma condição especial pra você: {{2}}. Quer saber mais?',
    approval: 'aprovado',
    variables: ['Nome do contato', 'Oferta'],
  },
  {
    id: 'tp-nps',
    accountId: ACCOUNT_ID,
    name: 'pesquisa_nps_padrao',
    body: 'Oi {{1}}, tudo bem? De 0 a 10, qual a chance de você indicar a gente para um amigo?',
    approval: 'aprovado',
    variables: ['Nome do contato'],
  },
  {
    id: 'tp-fatura',
    accountId: ACCOUNT_ID,
    name: 'lembrete_fatura',
    body: 'Olá {{1}}, sua fatura de {{2}} vence em {{3}}. Precisa da segunda via?',
    approval: 'em_analise',
    variables: ['Nome do contato', 'Referência', 'Vencimento'],
  },
];
