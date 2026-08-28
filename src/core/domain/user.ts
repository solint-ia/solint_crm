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

/**
 * Avisos pessoais — o que interrompe a pessoa, e como.
 *
 * Tudo opcional e com padrão explícito em `DEFAULT_NOTIFICATION_PREFERENCES`:
 * a coluna nasce nula para quem já existia, e um campo novo aqui não pode
 * significar "desligado" para toda a base por omissão.
 */
export interface NotificationPreferences {
  /** Conversa atribuída diretamente a mim. */
  readonly assigned: boolean;
  /** Menções com @ em notas internas. */
  readonly mentions: boolean;
  /** Prazo de resposta estourando. */
  readonly sla: boolean;
  /** Conclusão de campanhas em massa. */
  readonly campaigns: boolean;
  /** Resumo diário por email. */
  readonly dailySummary: boolean;
  /**
   * Para onde o resumo vai.
   *
   * Separado do email de login de propósito: o resumo costuma ser lido pela
   * gerência ou por uma caixa compartilhada, que raramente é a mesma conta que
   * atende. Vazio significa "manda para o email do meu login".
   */
  readonly dailySummaryEmail?: string;
  /** O navegador emite um som quando chega mensagem nova. */
  readonly sound: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  assigned: true,
  mentions: true,
  sla: true,
  campaigns: false,
  dailySummary: false,
  // Som ligado por padrão: quem atende costuma estar noutra aba, e o aviso
  // silencioso não avisa ninguém. Desligar é um clique.
  sound: true,
};

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
  /** A assinatura acompanha as mensagens enviadas? Ver `signatureFor`. */
  readonly signatureEnabled: boolean;
  readonly notifications: NotificationPreferences;
  readonly twoFactorEnabled: boolean;
  readonly lastActiveAt?: string;
}

/**
 * Como a assinatura entra na mensagem.
 *
 * Em negrito e numa linha própria acima do texto, que é a convenção do próprio
 * WhatsApp (`*texto*`) e o formato que os CRMs do mercado usam. Fica **acima**
 * e não abaixo porque quem lê precisa saber quem está falando antes de ler o
 * que foi dito — numa conversa atendida por três pessoas, descobrir isso só no
 * fim custa reler.
 *
 * Devolve `undefined` quando não há o que assinar: desligada, vazia, ou nota
 * interna (que ninguém de fora lê, então não há a quem se identificar).
 */
export const signatureFor = (user: User): string | undefined => {
  if (!user.signatureEnabled) return undefined;
  const texto = (user.signature ?? '').trim();
  return texto ? texto : undefined;
};

/** Aplica a assinatura ao corpo da mensagem, se houver uma. */
export const withSignature = (user: User, text: string): string => {
  const assinatura = signatureFor(user);
  if (!assinatura) return text;
  // Já assinada — reenvio, automação que montou o texto pronto — não ganha uma
  // segunda linha com o mesmo nome.
  if (text.startsWith(`*${assinatura}*`)) return text;
  return `*${assinatura}*\n${text}`;
};

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
