import type { Label } from '@/core/domain/label';
import type { Account, Permission, Role, Session, User } from '@/core/domain/user';
import { DEFAULT_NOTIFICATION_PREFERENCES, PERMISSIONS } from '@/core/domain/user';

export const ACCOUNT_ID = 'acc-solint';

export const ACCOUNTS: readonly Account[] = [
  { id: ACCOUNT_ID, name: 'Solint Tech', plan: 'profissional', document: '12.345.678/0001-90' },
  { id: 'acc-solint-labs', name: 'Solint Labs', plan: 'starter' },
];

const SUPERVISOR_PERMISSIONS: readonly Permission[] = [
  'conversas:ler',
  'conversas:responder',
  'conversas:transferir',
  // Supervisor move atendimento entre setores; o colaborador, não. Reatribuir
  // a um colega e empurrar para a fila da Cobrança são decisões de peso
  // diferente.
  'conversas:mover-caixa',
  'conversas:resolver',
  'contatos:ler',
  'contatos:escrever',
  'contatos:exportar',
  'kanban:ler',
  'kanban:escrever',
  'campanhas:ler',
  'campanhas:disparar',
  'agentes-ia:ler',
  'relatorios:ler',
  'config.caixas:ler',
];

const COLLABORATOR_PERMISSIONS: readonly Permission[] = [
  'conversas:ler',
  'conversas:responder',
  'conversas:transferir',
  'conversas:resolver',
  'contatos:ler',
  'contatos:escrever',
  'kanban:ler',
  'kanban:escrever',
];

export const ROLES: readonly Role[] = [
  {
    id: 'role-admin',
    accountId: ACCOUNT_ID,
    slug: 'administrador',
    name: 'Administrador',
    description: 'Acesso total, incluindo faturamento, integrações e segurança.',
    permissions: PERMISSIONS,
    isSystem: true,
  },
  {
    id: 'role-supervisor',
    accountId: ACCOUNT_ID,
    slug: 'supervisor',
    name: 'Supervisor',
    description: 'Gerencia filas, acompanha SLA e vê relatórios de toda a equipe.',
    permissions: SUPERVISOR_PERMISSIONS,
    isSystem: true,
  },
  {
    id: 'role-colaborador',
    accountId: ACCOUNT_ID,
    slug: 'colaborador',
    name: 'Colaborador',
    description: 'Atende conversas atribuídas e gerencia os próprios contatos.',
    permissions: COLLABORATOR_PERMISSIONS,
    isSystem: true,
  },
];

export const USERS: readonly User[] = [
  {
    id: 'user-rafael',
    accountId: ACCOUNT_ID,
    name: 'Rafael Souza',
    email: 'rafael.souza@solint.com.br',
    roleSlug: 'administrador',
    avatarTone: 'var(--color-brand-deep)',
    availability: 'disponivel',
    teams: ['Comercial', 'Suporte N1'],
    signature: 'Rafael Souza · Solint CRM',
    signatureEnabled: false,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    twoFactorEnabled: false,
    lastActiveAt: 'agora',
  },
  {
    id: 'user-camila',
    accountId: ACCOUNT_ID,
    name: 'Camila Reis',
    email: 'camila.reis@solint.com.br',
    roleSlug: 'supervisor',
    avatarTone: '#8B5CF6',
    availability: 'disponivel',
    teams: ['Comercial'],
    signatureEnabled: false,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    twoFactorEnabled: false,
    lastActiveAt: 'ha 4 min',
  },
  {
    id: 'user-diego',
    accountId: ACCOUNT_ID,
    name: 'Diego Martins',
    email: 'diego.martins@solint.com.br',
    roleSlug: 'colaborador',
    avatarTone: 'var(--color-slate-text)',
    availability: 'ausente',
    teams: ['Suporte N1'],
    signatureEnabled: false,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    twoFactorEnabled: false,
    lastActiveAt: 'ha 2 h',
  },
];

export const CURRENT_USER = USERS[0] as User;

export const LABELS: readonly Label[] = [
  { id: 'lbl-vip', accountId: ACCOUNT_ID, name: 'VIP', tone: 'amber', usageCount: 184 },
  {
    id: 'lbl-recorrente',
    accountId: ACCOUNT_ID,
    name: 'Recorrente',
    tone: 'blue',
    usageCount: 312,
  },
  {
    id: 'lbl-proposta',
    accountId: ACCOUNT_ID,
    name: 'Proposta Enviada',
    tone: 'violet',
    usageCount: 96,
  },
  { id: 'lbl-urgente', accountId: ACCOUNT_ID, name: 'Urgente', tone: 'red', usageCount: 41 },
  { id: 'lbl-novo', accountId: ACCOUNT_ID, name: 'Novo Cliente', tone: 'green', usageCount: 220 },
];

const labelBySlug = (slug: string): Label => {
  const label = LABELS.find((item) => item.id === slug);
  if (!label) throw new Error(`Etiqueta de seed inexistente: ${slug}`);
  return label;
};

export const LABEL = {
  vip: labelBySlug('lbl-vip'),
  recorrente: labelBySlug('lbl-recorrente'),
  proposta: labelBySlug('lbl-proposta'),
  urgente: labelBySlug('lbl-urgente'),
  novo: labelBySlug('lbl-novo'),
} as const;

export const SESSION: Session = {
  // Sessão de semente não vem de token nenhum: não há `jti` a citar, e o valor
  // fixo deixa isso explícito em vez de fingir um identificador plausível.
  tokenId: 'seed',
  user: CURRENT_USER,
  account: ACCOUNTS[0] as Account,
  permissions: PERMISSIONS,
  availableAccounts: ACCOUNTS,
  // Coerente com `permissions: PERMISSIONS`, que inclui `caixas:todas`.
  inboxAccess: 'todas',
};
