import type { Automation } from '../domain/automation';
import type { AutoReply, BusinessHours } from '../domain/business-hours';
import type { KnowledgeArticle, KnowledgeBase, KnowledgeCategory } from '../domain/knowledge';
import type { Label, Tone } from '../domain/label';
import type {
  ActiveSession,
  ApiToken,
  AssignmentMethod,
  AuditLogEntry,
  BillingInfo,
  CannedResponse,
  ChannelConnection,
  CompanyProfile,
  CustomAttributeDefinition,
  Macro,
  Team,
  Webhook,
} from '../domain/settings';
import type { Id } from '../domain/shared';
import type { Role, User } from '../domain/user';

export interface WorkspaceSettings {
  readonly automations: readonly Automation[];
  readonly macros: readonly Macro[];
  readonly cannedResponses: readonly CannedResponse[];
  readonly assignmentMethod: AssignmentMethod;
  readonly connections: readonly ChannelConnection[];
  readonly webhooks: readonly Webhook[];
  readonly apiTokens: readonly ApiToken[];
  readonly members: readonly User[];
  readonly roles: readonly Role[];
  readonly teams: readonly Team[];
  readonly labels: readonly Label[];
  readonly customAttributes: readonly CustomAttributeDefinition[];
  readonly billing: BillingInfo;
  readonly auditLog: readonly AuditLogEntry[];
  readonly activeSessions: readonly ActiveSession[];
  readonly knowledge: KnowledgeBase;
  readonly company: CompanyProfile;
}

/** Campos que o construtor de automação escreve. O id ausente cria uma nova. */
export interface AutomationDraft {
  readonly id?: Id;
  readonly name: Automation['name'];
  readonly trigger: Automation['trigger'];
  readonly conditions: Automation['conditions'];
  readonly actions: Automation['actions'];
  readonly enabled: boolean;
}

export interface InboxDraft {
  readonly name: string;
  readonly channel?: 'whatsapp' | 'webchat' | 'instagram' | 'email';
  readonly provider?: string;
}

/** Ajustes operacionais de uma caixa de entrada (§15). */
export interface InboxSettingsPatch {
  readonly businessHours?: BusinessHours;
  readonly awayMessage?: AutoReply;
  readonly greeting?: AutoReply;
  readonly webhookUrl?: string;
}

export interface ArticleDraft {
  readonly id?: Id;
  readonly categoryId: Id;
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly status: KnowledgeArticle['status'];
  readonly tags: readonly string[];
}

export interface SettingsRepository {
  get(accountId: Id): Promise<WorkspaceSettings>;
  setAutomationEnabled(accountId: Id, automationId: Id, enabled: boolean): Promise<Automation>;
  setAssignmentMethod(accountId: Id, method: AssignmentMethod): Promise<AssignmentMethod>;

  saveAutomation(accountId: Id, draft: AutomationDraft): Promise<Automation>;
  deleteAutomation(accountId: Id, automationId: Id): Promise<void>;
  /** A ordem decide quem vence um conflito de sobrescrita — por isso é editável. */
  moveAutomation(accountId: Id, automationId: Id, direction: 'cima' | 'baixo'): Promise<void>;

  createInbox(accountId: Id, draft: InboxDraft): Promise<ChannelConnection>;
  updateInbox(
    accountId: Id,
    connectionId: Id,
    patch: InboxSettingsPatch,
  ): Promise<ChannelConnection>;

  saveArticle(accountId: Id, draft: ArticleDraft): Promise<KnowledgeArticle>;
  deleteArticle(accountId: Id, articleId: Id): Promise<void>;
  saveCategory(
    accountId: Id,
    name: string,
    description: string,
    id?: Id,
  ): Promise<KnowledgeCategory>;
  deleteCategory(accountId: Id, categoryId: Id): Promise<void>;

  // Onda 3: Webhooks, Tokens, Respostas Rápidas, Atributos e Equipes
  createWebhook(
    accountId: Id,
    draft: { name: string; url: string; events: readonly string[] },
  ): Promise<Webhook>;
  toggleWebhook(accountId: Id, webhookId: Id, enabled: boolean): Promise<Webhook>;
  deleteWebhook(accountId: Id, webhookId: Id): Promise<void>;

  createApiToken(
    accountId: Id,
    draft: { name: string; permissions?: readonly string[] },
  ): Promise<{ token: ApiToken; rawSecret: string }>;
  deleteApiToken(accountId: Id, tokenId: Id): Promise<void>;

  createCannedResponse(
    accountId: Id,
    draft: { shortcut: string; content: string },
  ): Promise<CannedResponse>;
  /**
   * Edita a resposta existente.
   *
   * Sem isto, a tela de edição caía no `create` e o atalho editado virava uma
   * segunda linha em vez de substituir a primeira.
   */
  updateCannedResponse(
    accountId: Id,
    responseId: Id,
    draft: { shortcut: string; content: string },
  ): Promise<CannedResponse>;
  deleteCannedResponse(accountId: Id, responseId: Id): Promise<void>;

  createCustomAttribute(
    accountId: Id,
    draft: {
      name: string;
      key: string;
      type: 'texto' | 'numero' | 'data' | 'lista' | 'booleano';
      appliesTo: 'contato' | 'conversa';
      options?: readonly string[];
    },
  ): Promise<CustomAttributeDefinition>;
  deleteCustomAttribute(accountId: Id, attributeId: Id): Promise<void>;

  createTeam(accountId: Id, draft: TeamDraft): Promise<Team>;
  updateTeam(accountId: Id, teamId: Id, draft: TeamDraft): Promise<Team>;
  deleteTeam(accountId: Id, teamId: Id): Promise<void>;

  /**
   * Encerra uma sessão ativa, ou todas menos a atual.
   *
   * A sessão corrente nunca cai: encerrar a própria sessão a partir desta tela
   * deslogaria quem clicou, que não é o que o botão promete.
   */
  terminateSession(accountId: Id, sessionId: Id): Promise<readonly ActiveSession[]>;
  terminateOtherSessions(accountId: Id): Promise<readonly ActiveSession[]>;

  /** Grava o perfil da empresa. `tradeName` vai para `Account.name`. */
  saveCompanyProfile(
    accountId: Id,
    draft: CompanyProfile & { readonly tradeName: string; readonly document?: string },
  ): Promise<CompanyProfile>;

  createLabel(accountId: Id, draft: LabelDraft): Promise<Label>;
  updateLabel(accountId: Id, labelId: Id, draft: LabelDraft): Promise<Label>;
  /**
   * Remove a etiqueta do catálogo.
   *
   * As ligações com conversas e contatos caem junto pela cascata do Prisma —
   * uma etiqueta excluída não pode continuar aplicada a nada.
   */
  deleteLabel(accountId: Id, labelId: Id): Promise<void>;
}

/** Rascunho de etiqueta. `tone` é da paleta fechada, nunca uma cor solta. */
export interface LabelDraft {
  readonly name: string;
  readonly tone: Tone;
  readonly description?: string;
}

/**
 * Rascunho de equipe.
 *
 * `inboxIds` e `memberIds` são ids — nunca nomes. O campo já guardou nome de
 * caixa, e nome não serve para autorizar acesso: renomear a caixa cortaria em
 * silêncio quem dependia dela.
 */
export interface TeamDraft {
  readonly name: string;
  readonly color?: string;
  readonly memberIds?: readonly string[];
  readonly inboxIds?: readonly string[];
}
