import type { Id } from './shared';

export type AvailabilityStatus = 'disponivel' | 'ocupado' | 'ausente';

export const PERMISSIONS = [
  'conversas:ler',
  'conversas:responder',
  /** Reatribuir o atendimento a outra pessoa. */
  'conversas:transferir',
  /**
   * Mover o atendimento para outra caixa de entrada.
   *
   * Separada de `conversas:transferir` de propósito: passar uma conversa para
   * um colega e passá-la para o setor de Cobrança são decisões de negócio
   * diferentes, e uma clínica pode querer conceder uma sem a outra.
   */
  'conversas:mover-caixa',
  'conversas:resolver',
  /**
   * Enxergar todas as caixas, independente de equipe.
   *
   * É o que impede o próprio gestor de se trancar do lado de fora ao criar a
   * primeira equipe: sem esta permissão, quem não estivesse em nenhuma equipe
   * deixaria de ver as caixas que ele mesmo configurou.
   */
  'caixas:todas',
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

/**
 * Caixas de entrada que a pessoa alcança nesta conta.
 *
 * `'todas'` não é atalho de conveniência — é um estado legítimo, e há dois
 * caminhos até ele: papel com `caixas:todas` (o gestor), ou conta que ainda não
 * organizou nenhuma equipe com caixa vinculada. O segundo é o que mantém
 * funcionando quem usa o sistema com um número só: a restrição por caixa passa
 * a valer no dia em que o gestor a configura, não antes.
 */
export type InboxAccess = 'todas' | readonly Id[];

/** Sessão do usuário autenticado no contexto de uma conta. */
export interface Session {
  readonly user: User;
  readonly account: Account;
  readonly permissions: readonly Permission[];
  readonly availableAccounts: readonly Account[];
  readonly inboxAccess: InboxAccess;
}

/** Autorização é decidida sempre aqui — nunca espalhada por componentes. */
export const can = (session: Session, permission: Permission): boolean =>
  session.permissions.includes(permission);

/**
 * A pessoa alcança esta caixa?
 *
 * Vive ao lado de `can()` pelo mesmo motivo: autorização decidida num lugar só.
 * `can()` responde *o que* a pessoa pode fazer; este responde *onde*. Os dois
 * eixos são independentes — dois agentes com o mesmo papel podem atender caixas
 * diferentes.
 */
export const canSeeInbox = (session: Session, inboxId: Id | undefined): boolean => {
  if (session.inboxAccess === 'todas') return true;
  // Sem caixa declarada não há como afirmar que é permitido. Num evento de
  // tempo real, deixar passar significaria vazar conversa de outro setor.
  if (!inboxId) return false;
  return session.inboxAccess.includes(inboxId);
};
