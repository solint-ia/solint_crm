import type { Id } from './shared';

export type AvailabilityStatus = 'disponivel' | 'ocupado' | 'ausente';

export const PERMISSIONS = [
  'conversas:ler',
  'conversas:responder',
  'conversas:transferir',
  'conversas:resolver',
  'contatos:ler',
  'contatos:escrever',
  'contatos:exportar',
  'kanban:ler',
  'kanban:escrever',
  'campanhas:ler',
  'campanhas:disparar',
  'agentes-ia:ler',
  'agentes-ia:escrever',
  'relatorios:ler',
  'configuracoes:ler',
  'configuracoes:escrever',
  'equipe:gerenciar',
  'faturamento:gerenciar',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type RoleSlug = 'administrador' | 'supervisor' | 'agente' | (string & {});

export interface Role {
  readonly id: Id;
  readonly accountId: Id;
  readonly slug: RoleSlug;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
  readonly isSystem: boolean;
}

export interface User {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly email: string;
  readonly roleSlug: RoleSlug;
  readonly avatarTone: string;
  readonly availability: AvailabilityStatus;
  readonly teams: readonly string[];
  readonly signature?: string;
  readonly twoFactorEnabled: boolean;
  readonly lastActiveAt?: string;
}

export interface Account {
  readonly id: Id;
  readonly name: string;
  readonly plan: 'starter' | 'profissional' | 'enterprise';
  readonly document?: string;
}

/** Sessão do usuário autenticado no contexto de uma conta. */
export interface Session {
  readonly user: User;
  readonly account: Account;
  readonly permissions: readonly Permission[];
  readonly availableAccounts: readonly Account[];
}

/** Autorização é decidida sempre aqui — nunca espalhada por componentes. */
export const can = (session: Session, permission: Permission): boolean =>
  session.permissions.includes(permission);
