import type { Id } from './shared';

/**
 * Comprimento mínimo de senha.
 *
 * Mora no domínio, e não no módulo que valida, porque quem precisa dele são os
 * dois lados: o servidor, que recusa, e os formulários de cliente, que avisam
 * antes de o usuário enviar. `infrastructure/auth/password.ts` importa
 * `node:crypto` e nunca poderia ser lido pelo navegador — então o número
 * acabava repetido como literal em seis lugares (dois medidores de força, dois
 * `minLength`, dois textos de ajuda), e mudá-lo exigia achar todos eles.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A partir daqui o medidor das telas de cadastro chama a senha de "forte".
 *
 * Não é regra de aceitação — o servidor aceita a partir de `MIN_PASSWORD_LENGTH`.
 * É só o incentivo visual, e ele existe porque comprimento é o que de fato
 * protege: quatro caracteres a mais valem mais que qualquer exigência de
 * símbolo.
 */
export const STRONG_PASSWORD_LENGTH = 12;

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

  /**
   * Configurações, uma sub-seção de cada vez.
   *
   * Antes eram duas permissões — `configuracoes:ler` e `configuracoes:escrever`
   * — cobrindo as onze sub-seções sem distinção nenhuma. Quem podia ler
   * etiquetas podia ler faturamento, segurança e a lista inteira de pessoas da
   * conta; quem podia escrever respostas rápidas podia excluir uma caixa de
   * entrada com todo o histórico dentro. O par único não era um atalho: era a
   * ausência da distinção que o negócio precisa fazer.
   *
   * O prefixo `config.` marca o grupo, e o terceiro nível (`config.equipe.*`)
   * aparece só onde uma seção tem sub-abas que merecem separação real.
   */

  /** Ver e editar caixas: horário de atendimento, mensagens automáticas, CSAT. */
  'config.caixas:ler',
  'config.caixas:escrever',
  /**
   * Excluir uma caixa de entrada.
   *
   * Terceiro verbo, e não parte de `:escrever`, porque a diferença é de
   * natureza: editar a mensagem de saudação é reversível, apagar a caixa leva
   * junto conversas e mensagens e não tem lixeira. Só entra no padrão do
   * administrador.
   */
  'config.caixas:excluir',
  /** Membros e equipes — quem entra, com que papel, em qual equipe. */
  'config.equipe.membros:ler',
  'config.equipe.membros:escrever',
  /**
   * Papéis e permissões.
   *
   * Existe no tipo para o `can()` funcionar, mas **nunca** é oferecida como
   * caixinha em nenhuma tela de personalização: quem pode editar permissões
   * pode dar a si mesmo qualquer outra, então concedê-la é conceder tudo. Fica
   * atada ao papel de administrador, e a trava é reafirmada no servidor a cada
   * gravação. Ver `ADMIN_ONLY_PERMISSIONS` em `permissions.ts`.
   */
  'config.equipe.papeis:ler',
  'config.equipe.papeis:escrever',
  'config.automacoes:ler',
  'config.automacoes:escrever',
  'config.etiquetas:ler',
  'config.etiquetas:escrever',
  'config.respostas:ler',
  'config.respostas:escrever',
  'config.conhecimento:ler',
  'config.conhecimento:escrever',
  'config.atributos:ler',
  'config.atributos:escrever',
  'config.empresa:ler',
  'config.empresa:escrever',
  'config.seguranca:ler',
  'config.seguranca:escrever',
  /** Faturamento é só leitura: trocar de plano passa por fora do produto. */
  'config.faturamento:ler',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Aceita qualquer string para papéis personalizados criados pelo administrador. */
export type RoleSlug = 'administrador' | 'supervisor' | 'colaborador' | (string & {});

/**
 * Personalização de permissões de **uma pessoa**, sobre o papel dela.
 *
 * Guardado como diferença (`add`/`remove`), e não como uma lista fechada, de
 * propósito: uma lista fechada seria uma fotografia do papel no dia em que
 * alguém clicou em salvar, e divergiria em silêncio toda vez que o papel fosse
 * editado depois — o administrador acrescentaria uma permissão ao papel
 * Colaborador e as pessoas "personalizadas" não a receberiam, sem nada na tela
 * explicando por quê. Como diferença, a pessoa continua acompanhando o papel em
 * tudo que não foi explicitamente mexido.
 */
export interface PermissionOverrides {
  readonly add: readonly Permission[];
  readonly remove: readonly Permission[];
}

/**
 * O que a pessoa pode, de fato: o papel dela, menos o que foi tirado, mais o
 * que foi dado.
 *
 * A ordem importa — `remove` é aplicado antes de `add`, então uma permissão que
 * apareça nas duas listas acaba concedida. É a escolha deliberada: as duas
 * listas nascem do mesmo formulário, e um estado contraditório vindo de um
 * payload manipulado deve terminar no resultado mais previsível para quem
 * olhou a tela e marcou a caixinha.
 */
export const effectivePermissions = (
  rolePermissions: readonly Permission[],
  overrides: PermissionOverrides | null | undefined,
): readonly Permission[] => {
  if (!overrides) return rolePermissions;
  const removidas = new Set(overrides.remove);
  const resultado = new Set(rolePermissions.filter((p) => !removidas.has(p)));
  for (const p of overrides.add) resultado.add(p);
  return [...resultado];
};

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
  /** O navegador emite um som quando chega mensagem nova. */
  readonly sound: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  assigned: true,
  mentions: true,
  sla: true,
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
  /** Foto real, servida por `/api/users/[userId]/avatar`. Ausente = iniciais. */
  readonly avatarUrl?: string;
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
  /**
   * Marca da empresa, projetada do `CompanyProfile` que mora em
   * `AccountSettings.company`.
   *
   * Os dois campos sobem para cá porque a identidade visual do workspace é
   * usada **fora** da tela de Configurações — no seletor ao lado do sininho,
   * que é onde a pessoa confirma em qual empresa está. Deixá-los só no JSON de
   * configurações obrigaria cada consumidor a carregar o perfil inteiro da
   * empresa para desenhar um círculo de 32 pixels.
   *
   * Ausentes quando a conta nunca enviou logo nem escolheu cor: aí o avatar cai
   * nas iniciais do nome, como já faz para pessoas.
   */
  readonly logoUrl?: string;
  readonly brandColor?: string;
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
  /** `jti` do acesso atual, usado para trocar workspace e identificar esta sessão. */
  readonly tokenId: Id;
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
