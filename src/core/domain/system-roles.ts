import { PERMISSIONS, type Permission, type RoleSlug } from './user';

/**
 * Os papéis que toda conta tem desde o primeiro dia.
 *
 * Antes o cadastro criava **só** `administrador`. O efeito só aparecia depois:
 * o gestor abria a tela de equipe para dar acesso a um colaborador e o seletor
 * de papel tinha uma opção — "Administrador". Ou seja, a única forma de somar
 * gente à conta era dar acesso total a ela, inclusive a faturamento e à
 * exclusão de caixas.
 *
 * Hoje são três degraus, e a diferença entre eles é concreta:
 *
 *  - **Administrador** — governa a conta, e é o único que edita papéis.
 *  - **Supervisor** — enxerga toda a operação (todas as caixas, os relatórios)
 *    mas não mexe na estrutura da conta. Gerenciar membros **não** vem por
 *    padrão: é a delegação que o administrador concede caso a caso, e é o
 *    ponto do produto onde "supervisionar" vira "administrar".
 *  - **Colaborador** — atende. Vê as caixas das equipes dele e nada de
 *    Configurações além da consulta às próprias caixas.
 *
 * `isSystem` marca que o papel não é apagável na tela. Ele continua editável —
 * é justamente o que o administrador faz ao personalizar o Supervisor —, mas o
 * `administrador` é a exceção: mexer nas permissões dele é o caminho mais curto
 * para uma conta sem ninguém que possa consertá-la.
 */

/**
 * O que um colaborador pode fazer.
 *
 * A lista é por inclusão, nunca por exclusão: um `PERMISSIONS.filter(...)`
 * daria ao colaborador toda permissão nova que aparecesse no sistema, e a
 * próxima permissão sensível entraria no papel de menor privilégio sem ninguém
 * decidir isso. Aqui, o que não está escrito não é concedido.
 *
 * Notavelmente **fora**: `caixas:todas` (o colaborador vê as caixas das equipes
 * dele), `relatorios:ler` e tudo de `config.*` que não seja consultar a própria
 * caixa.
 *
 * `config.caixas:ler` **está** dentro: quem atende precisa conferir o horário
 * de atendimento e o texto das mensagens automáticas do canal em que trabalha.
 * É o que atende ao "caixa de entrada todo mundo tem acesso" sem entregar junto
 * a estrutura inteira da conta — que era o problema do antigo
 * `configuracoes:ler` genérico, que abria equipe, faturamento e segurança na
 * mesma permissão.
 */
export const COLLABORATOR_PERMISSIONS: readonly Permission[] = [
  'conversas:ler',
  'conversas:responder',
  'conversas:transferir',
  'conversas:resolver',
  'contatos:ler',
  'contatos:escrever',
  'kanban:ler',
  'kanban:escrever',
  'config.caixas:ler',
];

/**
 * O que um supervisor pode fazer.
 *
 * `caixas:todas` entra por padrão: supervisionar é justamente olhar o que
 * atravessa todos os canais, e um supervisor restrito a uma equipe seria um
 * colaborador com outro nome. Continua personalizável — o administrador pode
 * tirar, e a partir daí o supervisor volta a enxergar só as equipes dele.
 *
 * `config.equipe.membros:*` fica de fora de propósito: é a delegação que dá a
 * um supervisor o poder de mexer em quem entra na conta, e essa é uma decisão
 * que o administrador toma para cada conta, não um padrão do produto. Quando é
 * concedida, o supervisor ainda assim não alcança administradores — a trava
 * mora nas Server Actions de membro, não no papel.
 */
export const SUPERVISOR_PERMISSIONS: readonly Permission[] = [
  'conversas:ler',
  'conversas:responder',
  'conversas:transferir',
  'conversas:mover-caixa',
  'conversas:resolver',
  'caixas:todas',
  'contatos:ler',
  'contatos:escrever',
  'contatos:exportar',
  'kanban:ler',
  'kanban:escrever',
  'relatorios:ler',
  'config.caixas:ler',
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
    description: 'Acesso total: equipe, papéis, canais, faturamento e configurações.',
    permissions: PERMISSIONS,
  },
  {
    slug: 'supervisor',
    name: 'Supervisor',
    description: 'Acompanha toda a operação e os relatórios, sem mexer na estrutura da conta.',
    permissions: SUPERVISOR_PERMISSIONS,
  },
  {
    slug: 'colaborador',
    name: 'Colaborador',
    description: 'Atende conversas e cuida dos contatos das caixas que alcança.',
    permissions: COLLABORATOR_PERMISSIONS,
  },
];

/**
 * O papel de menor privilégio — o padrão quando nada é escolhido.
 *
 * Nomeado em vez de repetido como literal em cada tela: quando alguém salva um
 * membro sem olhar o seletor, o que sai daí precisa ser o acesso menor, e essa
 * decisão merece um lugar só.
 */
export const DEFAULT_ROLE_SLUG: RoleSlug = 'colaborador';

/**
 * Papéis que exigem vínculo com ao menos uma equipe.
 *
 * Um colaborador sem equipe cairia na regra de "conta sem equipes = vê tudo" e
 * enxergaria todas as caixas — exatamente o oposto do que o papel significa.
 * Administrador e supervisor podem ficar sem equipe porque os dois têm
 * `caixas:todas` por outro caminho, deliberadamente.
 */
export const ROLES_REQUIRING_TEAM: readonly RoleSlug[] = ['colaborador'];

/** Id determinístico: a mesma conta nunca ganha dois papéis com o mesmo slug. */
export const systemRoleId = (accountId: string, slug: RoleSlug): string =>
  `role-${slug}-${accountId}`;
