import type { Route } from 'next';
import type { Permission } from '@/core/domain/user';
import { FEATURES } from './features';

export type NavIcon =
  'inbox' | 'contacts' | 'kanban' | 'ai' | 'campaigns' | 'dashboard' | 'settings';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: Route;
  readonly icon: NavIcon;
  /**
   * Basta **uma** destas para o item aparecer.
   *
   * Virou lista por causa de Configurações: depois que cada sub-seção ganhou a
   * própria permissão, não existe mais uma única permissão que signifique
   * "alcança Configurações" — quem só pode ver Etiquetas precisa do item na
   * barra tanto quanto o administrador. Os demais itens continuam com uma
   * permissão só, escrita sem colchetes.
   */
  readonly permission: Permission | readonly Permission[];
  /** Rotas adicionais que mantem este item destacado. */
  readonly matches?: readonly string[];
}

/** A pessoa alcança este item da barra? */
export const reachesNavItem = (
  permissions: readonly Permission[],
  item: NavItem,
): boolean =>
  Array.isArray(item.permission)
    ? item.permission.some((p) => permissions.includes(p))
    : permissions.includes(item.permission as Permission);

/**
 * Toda permissão de leitura de alguma sub-seção de Configurações.
 *
 * Escrita à mão e não derivada de `SETTINGS_SECTIONS` porque aquela constante é
 * declarada depois — e inverter a ordem dos dois blocos deixaria a barra de
 * navegação, que é o assunto principal deste arquivo, no rodapé. O
 * `satisfies` na declaração de `SETTINGS_SECTIONS` garante que nenhum id novo
 * apareça sem permissão; o teste de tipo abaixo garante o outro sentido.
 */
export const CONFIG_READ_PERMISSIONS = [
  'config.caixas:ler',
  'config.equipe.membros:ler',
  'config.equipe.papeis:ler',
  'config.automacoes:ler',
  'config.etiquetas:ler',
  'config.respostas:ler',
  'config.conhecimento:ler',
  'config.atributos:ler',
  'config.empresa:ler',
  'config.seguranca:ler',
  'config.faturamento:ler',
] as const satisfies readonly Permission[];

/**
 * Rail de navegação global — fonte única, usada pela barra lateral e pelo menu mobile.
 *
 * Kanban e Dashboard trocaram de ícone de propósito (pedido explícito): o
 * item `kanban` usa `icon: 'dashboard'` e vice-versa — nenhum outro arquivo
 * precisa mudar, os dois pontos de render resolvem o ícone por este campo.
 *
 * Campanhas e Agentes de IA saem da lista quando `FEATURES` os desliga — a
 * barra nunca mostra um item para uma funcionalidade que não existe hoje, e
 * isso vale para todo mundo, papel nenhum faz diferença aqui.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'conversas',
    label: 'Caixa de entrada',
    href: '/conversas',
    icon: 'inbox',
    permission: 'conversas:ler',
  },
  {
    id: 'contatos',
    label: 'Contatos',
    href: '/contatos',
    icon: 'contacts',
    permission: 'contatos:ler',
  },
  { id: 'kanban', label: 'Kanban', href: '/kanban', icon: 'dashboard', permission: 'kanban:ler' },
  ...(FEATURES.agentesIA
    ? [
        {
          id: 'agentes-ia',
          label: 'Agentes de IA',
          href: '/agentes-ia',
          icon: 'ai',
          permission: 'agentes-ia:ler',
        } as const,
      ]
    : []),
  ...(FEATURES.campanhas
    ? [
        {
          id: 'campanhas',
          label: 'Campanhas',
          href: '/campanhas',
          icon: 'campaigns',
          permission: 'campanhas:ler',
        } as const,
      ]
    : []),
  {
    id: 'dashboard',
    label: 'Dashboard e relatórios',
    href: '/dashboard',
    icon: 'kanban',
    permission: 'relatorios:ler',
    matches: ['/relatorios'],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    href: '/configuracoes',
    icon: 'settings',
    // Definida abaixo de `SETTINGS_SECTIONS` seria mais legível, mas a barra é
    // declarada antes; `CONFIG_READ_PERMISSIONS` resolve isso sem duplicar a
    // lista, que é o que de fato não pode divergir.
    permission: CONFIG_READ_PERMISSIONS,
  },
];

/**
 * Onde a pessoa cai ao entrar no sistema.
 *
 * O destino era `/dashboard` fixo para todo mundo. Quem atende não tem
 * `relatorios:ler` — então o primeiro que um agente via depois de digitar a
 * senha era a tela de acesso negado, e ele precisava descobrir sozinho que a
 * caixa de entrada ficava no primeiro ícone da barra. A tela de entrada de um
 * CRM de atendimento é a caixa de entrada; o painel é privilégio de quem tem
 * relatório para ler.
 *
 * A ordem é a da própria navegação: cai no primeiro item que a pessoa alcança.
 * Assim um papel personalizado — sem conversas, só contatos, por exemplo —
 * também entra em algum lugar útil, em vez de num beco.
 */
export const landingRouteFor = (permissions: readonly Permission[]): Route => {
  if (permissions.includes('relatorios:ler')) return '/dashboard';
  const primeiro = NAV_ITEMS.find((item) => reachesNavItem(permissions, item));
  return primeiro?.href ?? '/conversas';
};

/**
 * As sub-seções de Configurações, cada uma com a permissão que a abre.
 *
 * O par `read`/`write` mora aqui e não espalhado pelas telas: a página, a
 * barra lateral e as Server Actions precisam concordar sobre quem entra em
 * cada aba, e três lugares decidindo isso separadamente divergem na primeira
 * seção nova.
 *
 * "Equipe e Permissões" tem duas leituras porque tem duas sub-abas com públicos
 * diferentes: membros pode ser delegado a um supervisor, papéis nunca sai do
 * administrador. A seção aparece se **qualquer** uma delas for alcançável, e a
 * própria tela decide quais abas mostrar.
 */
export const SETTINGS_SECTIONS = [
  { id: 'automacoes', label: 'Automações e Regras', read: 'config.automacoes:ler', write: 'config.automacoes:escrever' },
  // "Integrações e Conexões" saiu: webhooks e tokens de API passaram a ser
  // administrados pelo superadministrador da plataforma, e o que restava na
  // seção era um duplicado somente-leitura dos cartões de conexão que
  // "Caixas de entrada" já mostra.
  { id: 'caixas', label: 'Caixas de entrada', read: 'config.caixas:ler', write: 'config.caixas:escrever' },
  { id: 'equipe', label: 'Equipe e Permissões', read: 'config.equipe.membros:ler', alsoRead: 'config.equipe.papeis:ler', write: 'config.equipe.membros:escrever' },
  { id: 'etiquetas', label: 'Etiquetas', read: 'config.etiquetas:ler', write: 'config.etiquetas:escrever' },
  { id: 'respostas', label: 'Respostas rápidas', read: 'config.respostas:ler', write: 'config.respostas:escrever' },
  { id: 'conhecimento', label: 'Base de conhecimento', read: 'config.conhecimento:ler', write: 'config.conhecimento:escrever' },
  { id: 'atributos', label: 'Atributos personalizados', read: 'config.atributos:ler', write: 'config.atributos:escrever' },
  { id: 'empresa', label: 'Empresa', read: 'config.empresa:ler', write: 'config.empresa:escrever' },
  { id: 'faturamento', label: 'Faturamento e Plano', read: 'config.faturamento:ler' },
  { id: 'seguranca', label: 'Segurança', read: 'config.seguranca:ler', write: 'config.seguranca:escrever' },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly read: Permission;
  /** Segunda leitura que também abre a seção, quando ela tem sub-abas. */
  readonly alsoRead?: Permission;
  readonly write?: Permission;
}[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** As sub-seções que esta pessoa alcança, na ordem da barra lateral. */
export const settingsSectionsFor = (
  permissions: readonly Permission[],
): readonly (typeof SETTINGS_SECTIONS)[number][] =>
  SETTINGS_SECTIONS.filter(
    (section) =>
      permissions.includes(section.read) ||
      ('alsoRead' in section && permissions.includes(section.alsoRead)),
  );

/**
 * Em que seção cair quando nenhuma é pedida na URL.
 *
 * Mesma ideia de `landingRouteFor`: a primeira alcançável, em vez de uma fixa
 * que jogaria metade das pessoas numa tela de acesso negado. `undefined`
 * significa que Configurações inteira está fora do alcance.
 */
export const firstSettingsSectionFor = (
  permissions: readonly Permission[],
): SettingsSectionId | undefined => settingsSectionsFor(permissions)[0]?.id;
