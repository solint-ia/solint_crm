import type { Route } from 'next';
import type { Permission } from '@/core/domain/user';

export type NavIcon =
  'inbox' | 'contacts' | 'kanban' | 'ai' | 'campaigns' | 'dashboard' | 'settings';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: Route;
  readonly icon: NavIcon;
  readonly permission: Permission;
  /** Rotas adicionais que mantem este item destacado. */
  readonly matches?: readonly string[];
}

/** Rail de 7 icones (SKILL.md secao 4.1). Fonte unica da navegacao global. */
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
  { id: 'kanban', label: 'Kanban', href: '/kanban', icon: 'kanban', permission: 'kanban:ler' },
  {
    id: 'agentes-ia',
    label: 'Agentes de IA',
    href: '/agentes-ia',
    icon: 'ai',
    permission: 'agentes-ia:ler',
  },
  {
    id: 'campanhas',
    label: 'Campanhas',
    href: '/campanhas',
    icon: 'campaigns',
    permission: 'campanhas:ler',
  },
  {
    id: 'dashboard',
    label: 'Dashboard e relatórios',
    href: '/dashboard',
    icon: 'dashboard',
    permission: 'relatorios:ler',
    matches: ['/relatorios'],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    href: '/configuracoes',
    icon: 'settings',
    permission: 'configuracoes:ler',
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
  const primeiro = NAV_ITEMS.find((item) => permissions.includes(item.permission));
  return primeiro?.href ?? '/conversas';
};

export const SETTINGS_SECTIONS = [
  { id: 'automacoes', label: 'Automações e Regras' },
  { id: 'integracoes', label: 'Integrações e Conexões' },
  { id: 'caixas', label: 'Caixas de entrada' },
  { id: 'equipe', label: 'Equipe e Permissões' },
  { id: 'etiquetas', label: 'Etiquetas' },
  { id: 'respostas', label: 'Respostas rápidas' },
  { id: 'conhecimento', label: 'Base de conhecimento' },
  { id: 'atributos', label: 'Atributos personalizados' },
  { id: 'empresa', label: 'Empresa' },
  { id: 'faturamento', label: 'Faturamento e Plano' },
  { id: 'seguranca', label: 'Segurança' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];
