import { PERMISSIONS, type Permission, type RoleSlug } from './user';

/**
 * Os papéis que toda conta tem desde o primeiro dia.
 *
 * Antes o cadastro criava **só** `administrador`. O efeito só aparecia depois:
 * o gestor abria a tela de equipe para dar acesso a um colaborador e o seletor
 * de papel tinha uma opção — "Administrador". Ou seja, a única forma de somar
 * gente à conta era dar acesso total a ela, inclusive a faturamento e à
 * exclusão de caixas. Os papéis existiam no seed de demonstração e nunca
 * chegavam a uma conta real.
 *
 * São dois, e não uma escala: administrador e agente. Quem gerencia a conta e
 * quem atende. Um terceiro degrau intermediário é fácil de acrescentar e caro
 * de justificar — só vale a pena quando alguém pedir a diferença concreta.
 *
 * `isSystem` marca que o papel não é editável na tela: mexer nas permissões do
 * administrador é o caminho mais curto para uma conta sem ninguém que possa
 * consertá-la.
 */

/**
 * O que um agente pode fazer.
 *
 * A lista é por inclusão, nunca por exclusão: um `PERMISSIONS.filter(...)`
 * daria ao agente toda permissão nova que aparecesse no sistema, e a próxima
 * permissão sensível entraria no papel de menor privilégio sem ninguém decidir
 * isso. Aqui, o que não está escrito não é concedido.
 *
 * Notavelmente **fora**: `caixas:todas` (o agente vê as caixas das equipes
 * dele), `configuracoes:escrever`, `equipe:gerenciar` e `faturamento:gerenciar`.
 */
export const AGENT_PERMISSIONS: readonly Permission[] = [
  'conversas:ler',
  'conversas:responder',
  'conversas:transferir',
  'conversas:resolver',
  'contatos:ler',
  'contatos:escrever',
  'kanban:ler',
  'kanban:escrever',
  'campanhas:ler',
  'agentes-ia:ler',
  'configuracoes:ler',
];

export interface SystemRoleTemplate {
  readonly slug: RoleSlug;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

export const SYSTEM_ROLES: readonly SystemRoleTemplate[] = [
  {
    slug: 'administrador',
    name: 'Administrador',
    description: 'Acesso total: equipe, canais, faturamento e configurações.',
    permissions: PERMISSIONS,
  },
  {
    slug: 'agente',
    name: 'Agente',
    description: 'Atende conversas e cuida dos contatos das caixas que alcança.',
    permissions: AGENT_PERMISSIONS,
  },
];

/** Id determinístico: a mesma conta nunca ganha dois papéis com o mesmo slug. */
export const systemRoleId = (accountId: string, slug: RoleSlug): string =>
  `role-${slug}-${accountId}`;
