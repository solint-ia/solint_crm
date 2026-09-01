import type { BillingInfo } from './settings';

/**
 * O molde de um workspace recém-nascido.
 *
 * Existe porque agora há **dois** caminhos que criam conta: o cadastro público
 * (`signupAction`) e o botão "criar novo workspace" de quem já está dentro. As
 * duas contas precisam nascer iguais — mesmos papéis, mesma caixa, mesmo funil
 * com os mesmos pesos de conversão —, e a única forma de garantir isso é ter um
 * molde só. Duplicar as cem linhas de provisionamento faria os dois caminhos
 * divergirem na primeira etapa de funil nova, e a divergência só apareceria
 * quando alguém reclamasse que "no meu segundo workspace o Kanban está
 * diferente".
 *
 * Aqui mora o **que** nasce (puro, sem I/O). O **como** grava mora em
 * `infrastructure/provisioning/provision-account.ts`, porque escrever é
 * assunto de adaptador. Ver REGRAS-GLOBAIS §3.
 */

/**
 * Teto de workspaces que uma pessoa pode criar.
 *
 * Não é regra de plano nem de cobrança: é o freio de um formulário aberto.
 * Sem ele, "criar workspace" é um botão que insere linhas em `Account`,
 * `Role`, `Inbox` e `Pipeline` quantas vezes alguém tiver paciência de clicar.
 * Conta em que a pessoa **entrou por convite** não conta para o teto: o limite
 * é sobre criar, não sobre participar.
 */
export const MAX_WORKSPACES_POR_USUARIO = 5;

export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 60;

/**
 * O nome serve? Devolve a explicação do problema, ou `undefined`.
 *
 * Mesma forma de `passwordProblem`: a mensagem é escrita uma vez e vale para o
 * formulário e para a Server Action, que revalida tudo de novo.
 */
export const workspaceNameProblem = (raw: string): string | undefined => {
  const nome = raw.trim();
  if (nome.length < WORKSPACE_NAME_MIN) return 'Dê um nome ao workspace.';
  if (nome.length > WORKSPACE_NAME_MAX) {
    return `O nome pode ter no máximo ${WORKSPACE_NAME_MAX} caracteres.`;
  }
  return undefined;
};

export interface StageBlueprint {
  /** Sufixo do id, para o id final ficar estável e legível: `stg-<slug>-<conta>`. */
  readonly slug: string;
  readonly name: string;
  readonly order: number;
  readonly color: string;
  readonly isWon: boolean;
  readonly isLost: boolean;
  /** Quanto esta etapa vale no indicador de conversão do Kanban. */
  readonly conversionWeight: number;
}

export const DEFAULT_INBOX_NAME = 'WhatsApp Principal';
export const DEFAULT_PIPELINE_NAME = 'Funil Comercial';

/**
 * As etapas com que todo funil novo nasce.
 *
 * Os pesos seguem a regra do indicador ponderado: o meio do funil só conta
 * quando alguém decide que conta. "Negociação" nasce em 50 e "Fechado Ganho"
 * em 100 porque são as duas etapas em que a conversão é evidente; as demais
 * ficam em 0 e o usuário ajusta na tela de etapas. Um funil recém-criado, sem
 * card nenhum, marca 0% — nunca um valor de exemplo.
 */
export const DEFAULT_PIPELINE_STAGES: readonly StageBlueprint[] = [
  {
    slug: '1',
    name: 'Novo Lead',
    order: 1,
    color: '#3b82f6',
    isWon: false,
    isLost: false,
    conversionWeight: 0,
  },
  {
    slug: '2',
    name: 'Qualificação',
    order: 2,
    color: '#f59e0b',
    isWon: false,
    isLost: false,
    conversionWeight: 0,
  },
  {
    slug: '3',
    name: 'Proposta',
    order: 3,
    color: '#8b5cf6',
    isWon: false,
    isLost: false,
    conversionWeight: 0,
  },
  {
    slug: '4',
    name: 'Negociação',
    order: 4,
    color: '#ec4899',
    isWon: false,
    isLost: false,
    conversionWeight: 50,
  },
  {
    slug: '5',
    name: 'Fechado Ganho',
    order: 5,
    color: '#10b981',
    isWon: true,
    isLost: false,
    conversionWeight: 100,
  },
  {
    slug: '6',
    name: 'Fechado Perdido',
    order: 6,
    color: '#64748b',
    isWon: false,
    isLost: true,
    conversionWeight: 0,
  },
];

/** Faturamento de uma conta que ainda não assinou nada. */
export const STARTER_BILLING: BillingInfo = {
  planName: 'Starter',
  priceLabel: 'Gratuito',
  // Travessão de "sem valor", igual ao resto do painel. Não é pontuação: é o
  // que a tela de faturamento mostra quando não existe renovação a anunciar.
  renewalLabel: '—',
  usage: [],
  invoices: [],
};
