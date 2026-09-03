import { FEATURES } from '@/config/features';
import type { Permission } from './user';

/**
 * O catálogo que as telas de personalização apresentam.
 *
 * Separado de `PERMISSIONS` (a lista técnica, em `user.ts`) porque as duas
 * respondem perguntas diferentes: aquela diz *o que existe no sistema*, esta
 * diz *o que um administrador pode oferecer a alguém, e com que palavras*. Uma
 * permissão pode existir e não ser oferecível — é o caso de
 * `config.equipe.papeis:*`, que concede o poder de conceder.
 */

export interface PermissionOption {
  readonly id: Permission;
  readonly label: string;
  /** Uma frase sobre o que muda na prática. A tela mostra ao lado da caixinha. */
  readonly hint: string;
}

export interface PermissionGroup {
  readonly title: string;
  readonly options: readonly PermissionOption[];
}

/**
 * Nunca aparece como caixinha, em nenhuma tela, para nenhum papel.
 *
 * Quem edita permissões pode dar a si mesmo todas as outras — oferecer esta
 * numa grade de caixinhas seria oferecer "virar administrador" disfarçado de
 * item de lista. Ela é concedida apenas pelo padrão do papel `administrador`, e
 * a trava é reafirmada no servidor a cada gravação, não só escondendo a opção.
 */
export const ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  'config.equipe.papeis:ler',
  'config.equipe.papeis:escrever',
];

/**
 * Permissões de funcionalidades desligadas em `FEATURES`.
 *
 * Continuam existindo no tipo — o código delas não foi apagado — mas uma
 * caixinha para uma tela que ninguém consegue abrir só confunde quem monta o
 * papel. Voltam sozinhas ao catálogo no dia em que a flag for religada.
 */
export const HIDDEN_FEATURE_PERMISSIONS: readonly Permission[] = [
  ...(FEATURES.campanhas ? [] : (['campanhas:ler', 'campanhas:disparar'] as const)),
  ...(FEATURES.agentesIA ? [] : (['agentes-ia:ler', 'agentes-ia:escrever'] as const)),
];

/** A permissão existe, mas pertence a funcionalidade desligada em `FEATURES`. */
export const ehPermissaoDeFeatureDesligada = (permissao: string): boolean =>
  HIDDEN_FEATURE_PERMISSIONS.includes(permissao as Permission);

const GRUPOS: readonly PermissionGroup[] = [
  {
    title: 'Atendimento',
    options: [
      { id: 'conversas:ler', label: 'Ver conversas', hint: 'Abrir a caixa de entrada.' },
      { id: 'conversas:responder', label: 'Responder', hint: 'Enviar mensagens ao cliente.' },
      {
        id: 'conversas:transferir',
        label: 'Transferir',
        hint: 'Passar o atendimento para outra pessoa.',
      },
      {
        id: 'conversas:mover-caixa',
        label: 'Mover entre caixas',
        hint: 'Levar a conversa para outro canal ou setor.',
      },
      { id: 'conversas:resolver', label: 'Resolver', hint: 'Encerrar o atendimento.' },
      {
        id: 'caixas:todas',
        label: 'Ver todas as caixas',
        hint: 'Ignora a restrição por equipe: enxerga todos os canais da conta.',
      },
    ],
  },
  {
    title: 'Contatos e funil',
    options: [
      { id: 'contatos:ler', label: 'Ver contatos', hint: 'Abrir a agenda da conta.' },
      { id: 'contatos:escrever', label: 'Editar contatos', hint: 'Criar, alterar e etiquetar.' },
      { id: 'contatos:exportar', label: 'Exportar contatos', hint: 'Baixar a lista em CSV.' },
      { id: 'kanban:ler', label: 'Ver o Kanban', hint: 'Abrir o funil de vendas.' },
      { id: 'kanban:escrever', label: 'Editar o Kanban', hint: 'Mover cards, criar e excluir.' },
      { id: 'relatorios:ler', label: 'Ver relatórios', hint: 'Painel, indicadores e exportações.' },
      { id: 'campanhas:ler', label: 'Ver campanhas', hint: 'Lista de disparos em massa.' },
      { id: 'campanhas:disparar', label: 'Disparar campanhas', hint: 'Criar e executar disparos.' },
      { id: 'agentes-ia:ler', label: 'Ver agentes de IA', hint: 'Lista de agentes.' },
      { id: 'agentes-ia:escrever', label: 'Editar agentes de IA', hint: 'Criar e configurar.' },
    ],
  },
  {
    title: 'Configurações · Atendimento',
    options: [
      {
        id: 'config.caixas:ler',
        label: 'Ver caixas de entrada',
        hint: 'Consultar horários e mensagens automáticas.',
      },
      {
        id: 'config.caixas:escrever',
        label: 'Editar caixas de entrada',
        hint: 'Alterar horário, mensagens automáticas e CSAT.',
      },
      {
        id: 'config.caixas:excluir',
        label: 'Excluir caixas de entrada',
        hint: 'Apaga conversas e mensagens junto. Não tem lixeira.',
      },
      {
        id: 'config.equipe.membros:ler',
        label: 'Ver membros e equipes',
        hint: 'Quem está na conta e em qual equipe.',
      },
      {
        id: 'config.equipe.membros:escrever',
        label: 'Gerenciar membros e equipes',
        hint: 'Convidar, editar e remover pessoas. Não alcança administradores.',
      },
      { id: 'config.respostas:ler', label: 'Ver respostas rápidas', hint: 'Atalhos de mensagem.' },
      {
        id: 'config.respostas:escrever',
        label: 'Editar respostas rápidas',
        hint: 'Criar e alterar atalhos.',
      },
      { id: 'config.etiquetas:ler', label: 'Ver etiquetas', hint: 'Lista de etiquetas da conta.' },
      {
        id: 'config.etiquetas:escrever',
        label: 'Editar etiquetas',
        hint: 'Criar, renomear e excluir. Mexe no funil quando a etiqueta espelha uma etapa.',
      },
    ],
  },
  {
    title: 'Configurações · Automação e organização',
    options: [
      { id: 'config.automacoes:ler', label: 'Ver automações', hint: 'Regras automáticas.' },
      {
        id: 'config.automacoes:escrever',
        label: 'Editar automações',
        hint: 'Criar regras que agem sozinhas nas conversas.',
      },
      {
        id: 'config.conhecimento:ler',
        label: 'Ver base de conhecimento',
        hint: 'Artigos internos.',
      },
      {
        id: 'config.conhecimento:escrever',
        label: 'Editar base de conhecimento',
        hint: 'Escrever e publicar artigos.',
      },
    ],
  },
  {
    title: 'Configurações · Conta',
    options: [
      {
        id: 'config.empresa:ler',
        label: 'Ver dados da empresa',
        hint: 'Razão social e documento.',
      },
      {
        id: 'config.empresa:escrever',
        label: 'Editar dados da empresa',
        hint: 'Alterar o cadastro.',
      },
      { id: 'config.faturamento:ler', label: 'Ver faturamento', hint: 'Plano e consumo.' },
      { id: 'config.seguranca:ler', label: 'Ver segurança', hint: 'Sessões ativas e auditoria.' },
      {
        id: 'config.seguranca:escrever',
        label: 'Editar segurança',
        hint: 'Derrubar sessões e alterar exigências de acesso.',
      },
    ],
  },
];

/**
 * O catálogo já filtrado — é o que toda tela de personalização deve usar.
 *
 * Grupos que ficam vazios depois do filtro somem inteiros, para a grade não
 * mostrar um título de seção sem nada embaixo.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = GRUPOS.map((grupo) => ({
  ...grupo,
  options: grupo.options.filter(
    (opcao) =>
      !ADMIN_ONLY_PERMISSIONS.includes(opcao.id) && !HIDDEN_FEATURE_PERMISSIONS.includes(opcao.id),
  ),
})).filter((grupo) => grupo.options.length > 0);

/** Tudo que uma tela tem direito de oferecer. Serve também para validar no servidor. */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((grupo) =>
  grupo.options.map((opcao) => opcao.id),
);

/**
 * O que da lista submetida está fora do catálogo.
 *
 * Roda no servidor, e não só na tela: a grade de caixinhas é uma sugestão do
 * servidor que o cliente pode ignorar. Sem esta conferência, um payload montado
 * à mão concederia `config.equipe.papeis:escrever` a um colaborador — e daí a
 * qualquer outra coisa.
 */
export const permissoesForaDoCatalogo = (pedidas: readonly string[]): readonly string[] =>
  pedidas.filter((p) => !GRANTABLE_PERMISSIONS.includes(p as Permission));

/**
 * O que a gravação deve **recusar** — que não é a mesma coisa que estar fora do
 * catálogo.
 *
 * Fora do catálogo caem dois grupos com naturezas opostas. Um é a escalada de
 * privilégio (`config.equipe.papeis:*`) e o lixo desconhecido: isso é recusa. O
 * outro é a permissão de funcionalidade desligada em `FEATURES`, que **existe
 * gravada** nos papéis semeados — `supervisor` nasce com `agentes-ia:ler` — e
 * some da grade só porque a tela dela não abre hoje.
 *
 * Tratar os dois como intrusos foi o que quebrou a personalização por pessoa: a
 * tela abre marcando as permissões efetivas do colaborador, o supervisor tem
 * `agentes-ia:ler` desde o seed, e salvar devolvia "Permissão não reconhecida:
 * agentes-ia:ler." para um administrador que não tinha tocado naquilo — nem
 * podia, porque a caixinha nem estava na tela.
 */
export const permissoesRecusadas = (pedidas: readonly string[]): readonly string[] =>
  permissoesForaDoCatalogo(pedidas).filter((p) => !ehPermissaoDeFeatureDesligada(p));
