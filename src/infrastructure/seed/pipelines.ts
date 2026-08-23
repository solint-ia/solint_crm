import type { Deal, Pipeline } from '@/core/domain/pipeline';
import { ACCOUNT_ID } from './workspace';

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString();

export const PIPELINES: readonly Pipeline[] = [
  {
    id: 'pl-comercial',
    accountId: ACCOUNT_ID,
    name: 'Comercial',
    stages: [
      { id: 'st-novo', pipelineId: 'pl-comercial', name: 'Novo Lead', order: 1, color: '#94A3B8', isWon: false, isLost: false },
      { id: 'st-qualificacao', pipelineId: 'pl-comercial', name: 'Qualificação', order: 2, color: 'var(--color-blue-text)', isWon: false, isLost: false },
      { id: 'st-proposta', pipelineId: 'pl-comercial', name: 'Proposta Enviada', order: 3, color: 'var(--color-violet-text)', isWon: false, isLost: false },
      { id: 'st-negociacao', pipelineId: 'pl-comercial', name: 'Negociação', order: 4, color: 'var(--color-brand-amber)', isWon: false, isLost: false },
      { id: 'st-ganho', pipelineId: 'pl-comercial', name: 'Fechado Ganho', order: 5, color: 'var(--color-status-open)', isWon: true, isLost: false },
      { id: 'st-perdido', pipelineId: 'pl-comercial', name: 'Fechado Perdido', order: 6, color: 'var(--color-slate-text)', isWon: false, isLost: true },
    ],
  },
  {
    id: 'pl-suporte',
    accountId: ACCOUNT_ID,
    name: 'Pós-venda',
    stages: [
      { id: 'st-onb', pipelineId: 'pl-suporte', name: 'Onboarding', order: 1, color: '#94A3B8', isWon: false, isLost: false },
      { id: 'st-ativo', pipelineId: 'pl-suporte', name: 'Cliente ativo', order: 2, color: 'var(--color-status-open)', isWon: true, isLost: false },
      { id: 'st-churn', pipelineId: 'pl-suporte', name: 'Risco de churn', order: 3, color: 'var(--color-status-danger)', isWon: false, isLost: true },
    ],
  },
];

export const DEALS: readonly Deal[] = [
  {
    id: 'dl-1', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-novo',
    contactId: 'ct-mariana', contactName: 'Mariana Costa', company: 'Estudio MC Fotografia',
    amountInCents: 320_000, ownerName: 'Rafael Souza', priority: 'media',
    enteredStageAt: daysAgo(1), stageAgeLabel: 'ha 1 dia',
    nextAction: 'Ligar para apresentar catalogo', conversationId: 'cv-mariana',
    history: [{ text: 'Oportunidade criada a partir da conversa', date: '19 ago, 09:14' }],
  },
  {
    id: 'dl-2', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-novo',
    contactId: 'ct-pedro', contactName: 'Pedro Henrique',
    amountInCents: 80_000, ownerName: 'Camila Reis', priority: 'baixa',
    enteredStageAt: daysAgo(0), stageAgeLabel: 'ha 3 horas',
    nextAction: 'Enviar catalogo de produtos', conversationId: 'cv-pedro',
    history: [{ text: 'Lead recebido via Instagram', date: '20 ago, 11:05' }],
  },
  {
    id: 'dl-3', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-qualificacao',
    contactId: 'ct-roberta', contactName: 'Roberta Dias', company: 'Dias Consultoria',
    amountInCents: 540_000, ownerName: 'Rafael Souza', priority: 'media',
    enteredStageAt: daysAgo(2), stageAgeLabel: 'ha 2 dias',
    nextAction: 'Aguardar retorno sobre orcamento', conversationId: 'cv-roberta',
    history: [
      { text: 'Proposta enviada por e-mail', date: '18 ago, 15:40' },
      { text: 'Reuniao de descoberta realizada', date: '16 ago, 10:00' },
    ],
  },
  {
    id: 'dl-4', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-qualificacao',
    contactName: 'Studio Bella', company: 'Bella Estetica',
    amountInCents: 210_000, ownerName: 'Camila Reis', priority: 'baixa',
    enteredStageAt: daysAgo(6), stageAgeLabel: 'ha 6 dias',
    nextAction: 'Follow-up de qualificação',
    history: [{ text: 'Sem resposta desde o primeiro contato', date: '14 ago, 09:00' }],
  },
  {
    id: 'dl-5', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-proposta',
    contactId: 'ct-carlos', contactName: 'Carlos Eduardo Nunes', company: 'Nunes Engenharia',
    amountInCents: 1_250_000, ownerName: 'Rafael Souza', priority: 'alta',
    enteredStageAt: daysAgo(1), stageAgeLabel: 'ha 1 dia',
    nextAction: 'Confirmar aprovação do orçamento', conversationId: 'cv-carlos',
    history: [
      { text: 'Orcamento com desconto enviado', date: '19 ago, 16:02' },
      { text: 'Reuniao comercial realizada', date: '15 ago, 14:00' },
    ],
  },
  {
    id: 'dl-6', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-proposta',
    contactId: 'ct-joao', contactName: 'Joao Pedro Silva', company: 'JP Distribuidora',
    amountInCents: 890_000, ownerName: 'Camila Reis', priority: 'urgente',
    enteredStageAt: daysAgo(9), stageAgeLabel: 'ha 9 dias',
    nextAction: 'Reenviar proposta e cobrar retorno', conversationId: 'cv-joao',
    history: [{ text: 'Proposta enviada, aguardando aprovação financeira', date: '11 ago, 10:30' }],
  },
  {
    id: 'dl-7', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-negociacao',
    contactId: 'ct-fernanda', contactName: 'Fernanda Lopes', company: 'Fernanda Lopes Studio',
    amountInCents: 430_000, ownerName: 'Rafael Souza', priority: 'alta',
    enteredStageAt: daysAgo(2), stageAgeLabel: 'ha 2 dias',
    nextAction: 'Negociar prazo de pagamento', conversationId: 'cv-fernanda',
    history: [{ text: 'Cliente pediu desconto de 10%', date: '18 ago, 13:20' }],
  },
  {
    id: 'dl-8', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-ganho',
    contactId: 'ct-ana', contactName: 'Ana Beatriz Rocha',
    amountInCents: 160_000, ownerName: 'Camila Reis', priority: 'baixa',
    enteredStageAt: daysAgo(4), stageAgeLabel: 'ha 4 dias',
    nextAction: 'Enviar contrato assinado ao financeiro', conversationId: 'cv-ana',
    history: [{ text: 'Negociação encerrada com sucesso', date: '16 ago, 17:42' }],
  },
  {
    id: 'dl-9', accountId: ACCOUNT_ID, pipelineId: 'pl-comercial', stageId: 'st-perdido',
    contactId: 'ct-marcos', contactName: 'Marcos Vinicius', company: 'MV Transportes',
    amountInCents: 670_000, ownerName: 'Rafael Souza', priority: 'media',
    enteredStageAt: daysAgo(12), stageAgeLabel: 'ha 12 dias',
    nextAction: '—',
    history: [{ text: 'Perdido: cliente optou por concorrente', date: '8 ago, 09:00' }],
  },
];
