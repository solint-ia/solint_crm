import type {
  CampaignMetrics,
  CampaignStatus,
  Segment,
  WhatsAppTemplate,
} from '@/core/domain/campaign';
import { ACCOUNT_ID } from './workspace';

/** Campanha de demonstração: só o que o seed grava. */
export interface SeedCampaign {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly templateName: string;
  readonly metrics: CampaignMetrics;
}

export const CAMPAIGNS: readonly SeedCampaign[] = [
  {
    id: 'cp-reativacao',
    accountId: ACCOUNT_ID,
    name: 'Reativação Agosto',
    status: 'em_andamento',
    templateName: 'reativacao_desconto_v2',
    metrics: {
      recipients: 2000,
      queued: 491,
      sent: 1482,
      delivered: 1393,
      read: 861,
      replied: 0,
      failed: 27,
    },
  },
  {
    id: 'cp-pro',
    accountId: ACCOUNT_ID,
    name: 'Lançamento Plano Pro',
    status: 'concluida',
    templateName: 'lancamento_plano_pro',
    metrics: {
      recipients: 184,
      queued: 0,
      sent: 184,
      delivered: 178,
      read: 118,
      replied: 0,
      failed: 6,
    },
  },
  {
    id: 'cp-nps',
    accountId: ACCOUNT_ID,
    name: 'Pesquisa NPS Q3',
    status: 'agendada',
    templateName: 'pesquisa_nps_padrao',
    metrics: {
      recipients: 640,
      queued: 640,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
    },
  },
  {
    id: 'cp-black',
    accountId: ACCOUNT_ID,
    name: 'Black Week · aquecimento',
    status: 'rascunho',
    templateName: '—',
    metrics: {
      recipients: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
    },
  },
  {
    id: 'cp-cobranca',
    accountId: ACCOUNT_ID,
    name: 'Cobrança fatura julho',
    status: 'pausada',
    templateName: 'lembrete_fatura',
    metrics: {
      recipients: 310,
      queued: 71,
      sent: 214,
      delivered: 189,
      read: 102,
      replied: 0,
      failed: 25,
    },
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
