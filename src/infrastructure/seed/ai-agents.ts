import type { AiAgent } from '@/core/domain/ai-agent';
import { ACCOUNT_ID } from './workspace';

export const AI_AGENTS: readonly AiAgent[] = [
  {
    id: 'ai-comercial',
    accountId: ACCOUNT_ID,
    name: 'Assistente Comercial',
    scope: 'WhatsApp · Vendas',
    active: true,
    persona: 'Consultivo e direto, foco em qualificar leads e agendar demonstrações.',
    systemPrompt:
      'Você é o assistente comercial da Solint. Responda dúvidas sobre planos, colete o nome da empresa e o principal canal usado hoje, e ofereça agendar uma demonstração quando o cliente demonstrar interesse real.',
    model: 'Claude Sonnet 4.5',
    handledCount: 412,
    transferRate: '18%',
    knowledgeBase: [
      { id: 'kb-1', name: 'Tabela de Planos 2026.pdf', updatedLabel: 'Atualizado há 4 dias' },
      { id: 'kb-2', name: 'FAQ Comercial.docx', updatedLabel: 'Atualizado há 2 semanas' },
    ],
    transferRules: [
      {
        id: 'tr-1',
        type: 'palavra_chave',
        condition: 'falar com humano, atendente, gerente',
        enabled: true,
      },
      {
        id: 'tr-2',
        type: 'intencao',
        condition: 'Cliente relata problema técnico urgente',
        enabled: true,
      },
      {
        id: 'tr-3',
        type: 'horario',
        condition: 'Fora do horário comercial (após 18h)',
        enabled: false,
      },
    ],
    flow: [
      {
        id: 'fb-c1',
        type: 'inicio',
        title: 'Nova conversa no WhatsApp',
        branches: [{ label: 'Seguir', targetId: 'fb-c2' }],
      },
      {
        id: 'fb-c2',
        type: 'mensagem',
        title: 'Saudação e apresentação',
        detail: 'Oi! Sou o assistente da Solint. Posso te ajudar com planos e demonstração.',
        branches: [{ label: 'Seguir', targetId: 'fb-c3' }],
      },
      {
        id: 'fb-c3',
        type: 'pergunta',
        title: 'Qual o principal canal que você usa hoje?',
        detail: 'Guarda a resposta no atributo canal_atual.',
        branches: [{ label: 'Respondeu', targetId: 'fb-c4' }],
      },
      {
        id: 'fb-c4',
        type: 'condicao',
        title: 'É lead qualificado?',
        detail: 'Empresa com mais de 3 atendentes ou volume acima de 500 conversas/mês.',
        branches: [
          { label: 'Sim', targetId: 'fb-c5' },
          { label: 'Não', targetId: 'fb-c6' },
        ],
      },
      {
        id: 'fb-c5',
        type: 'transferir',
        title: 'Passar para consultor comercial',
        detail: 'Fila Comercial, prioridade alta.',
        branches: [],
      },
      {
        id: 'fb-c6',
        type: 'consultar_base',
        title: 'Responder com a base de planos',
        branches: [{ label: 'Respondido', targetId: 'fb-c7' }],
      },
      { id: 'fb-c7', type: 'encerrar', title: 'Encerrar e registrar o lead', branches: [] },
    ],
    logs: [
      { id: 'lg-1', contactName: 'Mariana Costa', date: 'Hoje, 09:05', result: 'concluido_ia' },
      {
        id: 'lg-2',
        contactName: 'Lucas Andrade',
        date: 'Ontem, 17:20',
        result: 'transferido_humano',
      },
      { id: 'lg-3', contactName: 'Bianca Ferreira', date: '18 ago, 11:40', result: 'concluido_ia' },
    ],
  },
  {
    id: 'ai-suporte',
    accountId: ACCOUNT_ID,
    name: 'Suporte N1',
    scope: 'WhatsApp · Suporte',
    active: true,
    persona: 'Objetivo e empático, resolve dúvidas frequentes antes de escalar.',
    systemPrompt:
      'Você é o assistente de suporte de primeiro nível da Solint. Use a base de conhecimento para responder dúvidas sobre garantia, trocas e uso do produto. Se não encontrar a resposta ou o cliente insistir, transfira para um humano.',
    model: 'Claude Sonnet 4.5',
    handledCount: 687,
    transferRate: '9%',
    knowledgeBase: [
      { id: 'kb-3', name: 'Política de Garantia.pdf', updatedLabel: 'Atualizado há 1 mês' },
      { id: 'kb-4', name: 'Manual do Produto.pdf', updatedLabel: 'Atualizado há 1 mês' },
      { id: 'kb-5', name: 'FAQ Suporte.txt', updatedLabel: 'Atualizado há 3 dias' },
    ],
    transferRules: [
      {
        id: 'tr-4',
        type: 'palavra_chave',
        condition: 'reembolso, cancelar, reclamação',
        enabled: true,
      },
      {
        id: 'tr-5',
        type: 'solicitacao_explicita',
        condition: 'Cliente pede para falar com atendente',
        enabled: true,
      },
    ],
    flow: [
      {
        id: 'fb-s1',
        type: 'inicio',
        title: 'Mensagem recebida no suporte',
        branches: [{ label: 'Seguir', targetId: 'fb-s2' }],
      },
      {
        id: 'fb-s2',
        type: 'consultar_base',
        title: 'Procurar na base de conhecimento',
        detail: 'Busca semântica nos artigos publicados.',
        branches: [{ label: 'Seguir', targetId: 'fb-s3' }],
      },
      {
        id: 'fb-s3',
        type: 'condicao',
        title: 'Encontrou resposta com confiança alta?',
        branches: [
          { label: 'Sim', targetId: 'fb-s4' },
          { label: 'Não', targetId: 'fb-s6' },
        ],
      },
      {
        id: 'fb-s4',
        type: 'mensagem',
        title: 'Responder e oferecer o artigo',
        branches: [{ label: 'Seguir', targetId: 'fb-s5' }],
      },
      {
        id: 'fb-s5',
        type: 'pergunta',
        title: 'Isso resolveu seu problema?',
        branches: [
          { label: 'Sim', targetId: 'fb-s7' },
          { label: 'Não', targetId: 'fb-s6' },
        ],
      },
      { id: 'fb-s6', type: 'transferir', title: 'Transferir para atendente N2', branches: [] },
      { id: 'fb-s7', type: 'encerrar', title: 'Encerrar e enviar pesquisa CSAT', branches: [] },
    ],
    logs: [
      { id: 'lg-4', contactName: 'Fernanda Lopes', date: 'Hoje, 12:40', result: 'concluido_ia' },
      { id: 'lg-5', contactName: 'Diego Martins', date: 'Hoje, 08:10', result: 'concluido_ia' },
    ],
  },
  {
    id: 'ai-cobranca',
    accountId: ACCOUNT_ID,
    name: 'Cobrança automática',
    scope: 'WhatsApp · Financeiro',
    active: false,
    persona: 'Formal e cordial, foco em lembrar vencimentos sem soar agressivo.',
    systemPrompt:
      'Você envia lembretes de fatura e responde dúvidas simples sobre pagamento. Nunca negocie descontos: sempre transfira para o time financeiro nesses casos.',
    model: 'Claude Haiku 4.5',
    handledCount: 0,
    transferRate: '—',
    knowledgeBase: [
      { id: 'kb-6', name: 'Regras de Cobrança.pdf', updatedLabel: 'Atualizado há 2 meses' },
    ],
    transferRules: [
      {
        id: 'tr-6',
        type: 'palavra_chave',
        condition: 'desconto, negociar, não vou pagar',
        enabled: true,
      },
    ],
    flow: [
      {
        id: 'fb-b1',
        type: 'inicio',
        title: 'Fatura vence em 3 dias',
        branches: [{ label: 'Seguir', targetId: 'fb-b2' }],
      },
      {
        id: 'fb-b2',
        type: 'mensagem',
        title: 'Enviar lembrete com o boleto',
        branches: [{ label: 'Seguir', targetId: 'fb-b3' }],
      },
      {
        id: 'fb-b3',
        type: 'condicao',
        title: 'Cliente pediu desconto ou negociação?',
        branches: [
          { label: 'Sim', targetId: 'fb-b4' },
          { label: 'Não', targetId: 'fb-b5' },
        ],
      },
      { id: 'fb-b4', type: 'transferir', title: 'Transferir para o Financeiro', branches: [] },
      { id: 'fb-b5', type: 'encerrar', title: 'Encerrar o lembrete', branches: [] },
    ],
    logs: [],
  },
];
