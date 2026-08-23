import type { BusinessHours } from '@/core/domain/business-hours';
import type { WorkspaceSettings } from '@/core/ports/settings-repository';
import { KNOWLEDGE } from './knowledge';
import { ACCOUNT_ID, LABELS, ROLES, USERS } from './workspace';

const hours = (
  opensAt: string,
  closesAt: string,
  open: readonly string[],
): BusinessHours => ({
  timezone: 'America/Sao_Paulo',
  days: (['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const).map((day) => ({
    day,
    enabled: open.includes(day),
    opensAt,
    closesAt,
  })),
});

const WEEK = ['seg', 'ter', 'qua', 'qui', 'sex'] as const;
const EVERY_DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

export const SETTINGS: WorkspaceSettings = {
  automations: [
    {
      id: 'au-1', accountId: ACCOUNT_ID, name: 'Atribuir WhatsApp ao time Comercial',
      trigger: 'conversa_criada', order: 1, enabled: true,
      conditions: [{ field: 'canal', operator: 'igual', value: 'WhatsApp' }],
      actions: [{ type: 'atribuir_equipe', value: 'Comercial' }],
    },
    {
      id: 'au-2', accountId: ACCOUNT_ID, name: 'Leads VIP vão para o Suporte N1',
      trigger: 'conversa_criada', order: 2, enabled: true,
      conditions: [
        { field: 'canal', operator: 'igual', value: 'WhatsApp' },
        { field: 'etiqueta', operator: 'igual', value: 'VIP' },
      ],
      actions: [
        { type: 'definir_prioridade', value: 'Alta' },
        { type: 'atribuir_equipe', value: 'Suporte N1' },
      ],
    },
    {
      id: 'au-3', accountId: ACCOUNT_ID, name: 'Alertar SLA estourado',
      trigger: 'conversa_pendente', order: 3, enabled: true,
      conditions: [{ field: 'horario', operator: 'igual', value: 'dentro do expediente' }],
      actions: [{ type: 'notificar', value: 'supervisor de plantão' }],
    },
    {
      id: 'au-4', accountId: ACCOUNT_ID, name: 'Etiquetar leads de campanha',
      trigger: 'conversa_criada', order: 4, enabled: false,
      conditions: [{ field: 'palavra_chave', operator: 'contem', value: 'black week' }],
      actions: [{ type: 'aplicar_etiqueta', value: 'Campanha' }],
    },
    {
      id: 'au-5', accountId: ACCOUNT_ID, name: 'Pesquisa de satisfação ao resolver',
      trigger: 'conversa_resolvida', order: 5, enabled: true,
      conditions: [],
      actions: [{ type: 'enviar_mensagem', value: 'Pesquisa CSAT' }],
    },
  ],
  macros: [
    { id: 'mc-1', name: 'Encerrar com pesquisa CSAT', steps: 'Enviar pesquisa · Aplicar etiqueta Atendido · Marcar como resolvida' },
    { id: 'mc-2', name: 'Escalar para financeiro', steps: 'Transferir para equipe Financeiro · Aplicar etiqueta Cobranca' },
    { id: 'mc-3', name: 'Follow-up de proposta', steps: 'Enviar follow-up padrão · Mover card para Negociação' },
    { id: 'mc-4', name: 'Boas-vindas novo cliente', steps: 'Enviar boas-vindas · Aplicar etiqueta Novo Cliente · Criar tarefa em 3 dias' },
  ],
  cannedResponses: [
    { id: 'cr-1', shortcut: '/ola', content: 'Olá! Aqui e a Solint, em que posso ajudar hoje?' },
    { id: 'cr-2', shortcut: '/prazo', content: 'O prazo de entrega é de 3 a 5 dias úteis após a confirmação do pagamento.' },
    { id: 'cr-3', shortcut: '/boleto', content: 'Segue a segunda via do seu boleto. Qualquer dúvida, é só chamar.' },
    { id: 'cr-4', shortcut: '/garantia', content: 'Nossos produtos têm 12 meses de garantia contra defeitos de fabricação.' },
  ],
  assignmentMethod: 'round_robin',
  connections: [
    {
      id: 'cn-1', name: 'WhatsApp · Comercial', channel: 'whatsapp', identifier: '+55 79 99887-7665',
      status: 'conectado', provider: 'API oficial (Cloud API)', teamName: 'Comercial',
      businessHours: hours('08:00', '18:00', WEEK),
      awayMessage: {
        enabled: true,
        text: 'Olá! Nosso horário de atendimento comercial é de segunda a sexta, das 8h às 18h. Deixe sua mensagem que respondemos no próximo dia útil.',
      },
      greeting: {
        enabled: true,
        text: 'Olá! Recebemos sua mensagem e um consultor vai te responder em instantes 🙂',
      },
      webhookUrl: 'https://erp.solint.com.br/hooks/whatsapp-comercial',
    },
    {
      id: 'cn-2', name: 'WhatsApp · Suporte', channel: 'whatsapp', identifier: '+55 11 98213-4470',
      status: 'pareando', provider: 'QR Code (sessão Web)', teamName: 'Suporte N1',
      businessHours: hours('08:00', '22:00', EVERY_DAY),
      awayMessage: {
        enabled: true,
        text: 'O suporte atende todos os dias das 8h às 22h. Sua mensagem entrou na fila e será respondida na abertura.',
      },
      greeting: { enabled: false, text: '' },
    },
    {
      id: 'cn-3', name: 'Instagram Direct', channel: 'instagram', identifier: '@solintcrm',
      status: 'conectado', provider: 'Meta Graph API', teamName: 'Comercial',
      businessHours: hours('09:00', '18:00', WEEK),
      awayMessage: { enabled: false, text: '' },
      greeting: {
        enabled: true,
        text: 'Oi! Obrigado por chamar a Solint no Instagram. Como podemos ajudar?',
      },
    },
    {
      id: 'cn-4', name: 'Webchat do site', channel: 'webchat', identifier: 'solint.com.br',
      status: 'desconectado', provider: 'Widget embarcado',
      businessHours: hours('00:00', '23:59', EVERY_DAY),
      awayMessage: { enabled: false, text: '' },
      greeting: {
        enabled: true,
        text: 'Bem-vindo! Digite sua dúvida que já te respondemos.',
      },
      webhookUrl: 'https://n8n.solint.com.br/webhook/webchat',
    },
    {
      id: 'cn-5', name: 'E-mail (IMAP/SMTP)', channel: 'email', identifier: 'suporte@solint.com',
      status: 'conectado', provider: 'IMAP + SMTP', teamName: 'Financeiro',
      businessHours: hours('09:00', '17:00', WEEK),
      awayMessage: {
        enabled: true,
        text: 'Recebemos seu e-mail. Nosso time responde em até 1 dia útil, das 9h às 17h.',
      },
      greeting: { enabled: false, text: '' },
    },
    {
      id: 'cn-6', name: 'Telegram', channel: 'telegram', identifier: '—',
      status: 'nao_configurado', provider: 'Bot API',
      businessHours: hours('08:00', '18:00', WEEK),
      awayMessage: { enabled: false, text: '' },
      greeting: { enabled: false, text: '' },
    },
  ],
  webhooks: [
    { id: 'wh-1', url: 'https://erp.solint.com.br/hooks/crm', events: ['conversa.criada', 'conversa.resolvida'], enabled: true },
    { id: 'wh-2', url: 'https://n8n.solint.com.br/webhook/leads', events: ['contato.criado'], enabled: false },
  ],
  apiTokens: [
    { id: 'tk-1', name: 'Integração ERP', maskedValue: 'sk_live_****9c2f', createdLabel: '02 jun 2026', lastUsedLabel: 'Hoje, 07:12' },
    { id: 'tk-2', name: 'Automação n8n', maskedValue: 'sk_live_****41ab', createdLabel: '18 jul 2026', lastUsedLabel: 'Ontem, 22:40' },
  ],
  members: USERS,
  roles: ROLES,
  labels: LABELS,
  teams: [
    { id: 'tm-1', name: 'Comercial', memberCount: 4, inboxes: ['WhatsApp · Comercial', 'Instagram Direct'], businessHours: 'Seg a Sex, 08h as 18h' },
    { id: 'tm-2', name: 'Suporte N1', memberCount: 6, inboxes: ['WhatsApp · Suporte', 'Webchat do site'], businessHours: 'Todos os dias, 08h as 22h' },
    { id: 'tm-3', name: 'Financeiro', memberCount: 2, inboxes: ['E-mail (IMAP/SMTP)'], businessHours: 'Seg a Sex, 09h as 17h' },
  ],
  customAttributes: [
    { id: 'ca-1', name: 'CPF', key: 'cpf', type: 'texto', appliesTo: 'contato' },
    { id: 'ca-2', name: 'CNPJ', key: 'cnpj', type: 'texto', appliesTo: 'contato' },
    { id: 'ca-3', name: 'Código ERP', key: 'codigo_erp', type: 'texto', appliesTo: 'contato' },
    { id: 'ca-4', name: 'Valor de Lead', key: 'valor_lead', type: 'numero', appliesTo: 'contato' },
    { id: 'ca-5', name: 'Venc. Fatura', key: 'venc_fatura', type: 'data', appliesTo: 'contato' },
    { id: 'ca-6', name: 'Motivo de encerramento', key: 'motivo_encerramento', type: 'lista', appliesTo: 'conversa' },
  ],
  billing: {
    planName: 'Profissional',
    priceLabel: 'R$ 597/mês',
    renewalLabel: 'Renova em 05/09/2026',
    usage: [
      { label: 'Agentes', used: 8, limit: 10 },
      { label: 'Conversas no mês', used: 12480, limit: 20000 },
      { label: 'Caixas de entrada', used: 5, limit: 8 },
    ],
    invoices: [
      { id: 'iv-1', reference: 'Agosto 2026', amountLabel: 'R$ 597,00', status: 'aberta' },
      { id: 'iv-2', reference: 'Julho 2026', amountLabel: 'R$ 597,00', status: 'paga' },
      { id: 'iv-3', reference: 'Junho 2026', amountLabel: 'R$ 597,00', status: 'paga' },
    ],
  },
  auditLog: [
    { id: 'al-1', actor: 'Rafael Souza', action: 'Alterou o método de atribuição', target: 'Configurações', ip: '187.45.12.9', at: 'Hoje, 09:02' },
    { id: 'al-2', actor: 'Camila Reis', action: 'Exportou contatos filtrados', target: 'Contatos', ip: '187.45.12.31', at: 'Ontem, 16:44' },
    { id: 'al-3', actor: 'Rafael Souza', action: 'Criou token de API', target: 'Integrações', ip: '187.45.12.9', at: '18 ago, 10:20' },
  ],
  activeSessions: [
    { id: 'ss-1', device: 'Chrome · Windows 11', location: 'Aracaju, SE', lastActive: 'Agora', current: true },
    { id: 'ss-2', device: 'Safari · iPhone 15', location: 'Aracaju, SE', lastActive: 'Há 3 h', current: false },
    { id: 'ss-3', device: 'Chrome · macOS', location: 'São Paulo, SP', lastActive: 'Ontem, 19:10', current: false },
  ],
  knowledge: KNOWLEDGE,
};
