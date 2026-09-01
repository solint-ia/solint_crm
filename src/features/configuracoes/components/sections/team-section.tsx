'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Pencil,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

import type { Permission, Role, User } from '@/core/domain/user';
import { PermissionGrid } from '@/features/configuracoes/components/permission-grid';
import type { ChannelConnection, Team } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { cn } from '@/lib/cn';
import {
  createCollaboratorAction,
  createTeamAction,
  deleteTeamAction,
  removeCollaboratorAction,
  updateCollaboratorAction,
  updateMemberOverridesAction,
  updateRolePermissionsAction,
  updateTeamAction,
} from '@/app/(workspace)/configuracoes/actions';

interface TeamSectionProps {
  readonly members: readonly User[];
  readonly roles: readonly Role[];
  readonly teams: readonly Team[];
  readonly inboxes: readonly ChannelConnection[];
  /**
   * Quem está olhando pode editar papéis e personalizar pessoas?
   *
   * Vem resolvido do servidor (`config.equipe.papeis:escrever`) porque este é
   * um componente de cliente e a permissão não deve viajar até o navegador.
   * Esconder é cortesia com quem não pode — a trava de verdade está na Server
   * Action, que reconfere a cada gravação.
   */
  readonly canEditRoles: boolean;
  /** Permissões efetivas de cada pessoa, já com os overrides aplicados. */
  readonly memberPermissions: Readonly<Record<string, readonly Permission[]>>;
}

type TeamSubTab = 'membros' | 'papeis' | 'equipes';

export function TeamSection({
  members,
  roles,
  teams,
  inboxes,
  canEditRoles,
  memberPermissions,
}: TeamSectionProps) {
  const inboxNameOf = (inboxId: string): string =>
    inboxes.find((inbox) => inbox.id === inboxId)?.name ?? inboxId;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [subTab, setSubTab] = useState<TeamSubTab>('membros');
  const [roleFilter, setRoleFilter] = useState<string>('todos');

  // Team Modal
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState('#3B82F6');
  const [teamInboxIds, setTeamInboxIds] = useState<readonly string[]>([]);
  const [teamMemberIds, setTeamMemberIds] = useState<readonly string[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);

  /**
   * Painel de colaborador — criar e editar usam o mesmo formulário.
   *
   * `editando` é quem separa os dois: nulo cria, preenchido altera. Duplicar o
   * formulário faria os dois divergirem no primeiro campo novo, e são
   * exatamente os mesmos campos — com uma diferença, a senha, que na edição é
   * opcional porque vazio significa "manter a atual".
   */
  const [colabAberto, setColabAberto] = useState(false);
  const [editando, setEditando] = useState<User | null>(null);
  const [colabNome, setColabNome] = useState('');
  const [colabEmail, setColabEmail] = useState('');
  const [colabSenha, setColabSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [colabRole, setColabRole] = useState(roles[0]?.slug ?? 'colaborador');
  const [colabTeamIds, setColabTeamIds] = useState<readonly string[]>([]);

  /**
   * Editor de permissões — serve ao papel e à pessoa com o mesmo estado.
   *
   * `alvo` diz qual dos dois está aberto. A grade é a mesma; muda o que é
   * gravado no fim: o papel inteiro, ou a diferença desta pessoa em relação ao
   * papel dela.
   */
  const [permAlvo, setPermAlvo] = useState<
    { readonly tipo: 'papel'; readonly role: Role } | { readonly tipo: 'pessoa'; readonly member: User } | null
  >(null);
  const [permMarcadas, setPermMarcadas] = useState<readonly Permission[]>([]);
  const [permErro, setPermErro] = useState<string | null>(null);

  const abrirPermissoesDoPapel = (role: Role) => {
    setPermAlvo({ tipo: 'papel', role });
    setPermMarcadas(role.permissions);
    setPermErro(null);
  };

  const abrirPermissoesDaPessoa = (member: User) => {
    setPermAlvo({ tipo: 'pessoa', member });
    setPermMarcadas(memberPermissions[member.id] ?? []);
    setPermErro(null);
  };

  const alternarPermissao = (permission: Permission) =>
    setPermMarcadas((atual) =>
      atual.includes(permission)
        ? atual.filter((p) => p !== permission)
        : [...atual, permission],
    );

  const salvarPermissoes = () => {
    if (!permAlvo) return;
    setPermErro(null);
    startTransition(async () => {
      const res =
        permAlvo.tipo === 'papel'
          ? await updateRolePermissionsAction({
              roleSlug: permAlvo.role.slug,
              permissions: permMarcadas,
            })
          : await updateMemberOverridesAction({
              userId: permAlvo.member.id,
              permissions: permMarcadas,
            });

      if (!res.ok) {
        setPermErro(res.error ?? 'Não foi possível salvar.');
        return;
      }
      setPermAlvo(null);
      router.refresh();
    });
  };

  /** O papel de quem está sendo personalizado — a régua da coluna "a mais/a menos". */
  const papelDoAlvo =
    permAlvo?.tipo === 'pessoa'
      ? roles.find((role) => role.slug === permAlvo.member.roleSlug)
      : undefined;
  const [colabError, setColabError] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<User | null>(null);

  const toggle = (current: readonly string[], id: string, set: (next: readonly string[]) => void) =>
    set(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const openNewTeam = () => {
    setEditingTeam(null);
    setTeamName('');
    setTeamColor('#3B82F6');
    setTeamInboxIds([]);
    setTeamMemberIds([]);
    setTeamError(null);
    setIsTeamModalOpen(true);
  };

  const openEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamColor(team.color);
    setTeamInboxIds(team.inboxIds);
    setTeamMemberIds(team.memberIds);
    setTeamError(null);
    setIsTeamModalOpen(true);
  };

  const handleSaveTeam = (e: React.FormEvent) => {
    e.preventDefault();
    setTeamError(null);
    startTransition(async () => {
      const draft = {
        name: teamName,
        color: teamColor,
        inboxIds: [...teamInboxIds],
        memberIds: [...teamMemberIds],
      };
      const res = editingTeam
        ? await updateTeamAction({ teamId: editingTeam.id, ...draft })
        : await createTeamAction(draft);

      if (res.ok) {
        setIsTeamModalOpen(false);
        router.refresh();
      } else {
        setTeamError(res.error ?? 'Erro ao salvar equipe.');
      }
    });
  };

  const abrirNovoColaborador = () => {
    setEditando(null);
    setColabNome('');
    setColabEmail('');
    setColabSenha('');
    setMostrarSenha(false);
    // Colaborador é o padrão porque é o acesso menor: se alguém salvar sem olhar
    // este campo, o erro é conceder de menos, não conceder a conta inteira.
    setColabRole(
      roles.find((role) => role.slug === 'colaborador')?.slug ?? roles[0]?.slug ?? 'colaborador',
    );
    setColabTeamIds([]);
    setColabError(null);
    setColabAberto(true);
  };

  const abrirEdicaoColaborador = (member: User) => {
    setEditando(member);
    setColabNome(member.name);
    setColabEmail(member.email);
    // Nunca preenchida: a senha guardada é um hash, e mostrar um valor falso
    // aqui faria parecer que ela pode ser lida de volta.
    setColabSenha('');
    setMostrarSenha(false);
    setColabRole(member.roleSlug);
    setColabTeamIds(
      teams.filter((team) => (member.teams ?? []).includes(team.name)).map((team) => team.id),
    );
    setColabError(null);
    setColabAberto(true);
  };

  const handleSalvarColaborador = (e: React.FormEvent) => {
    e.preventDefault();
    setColabError(null);

    startTransition(async () => {
      const comum = {
        name: colabNome.trim(),
        email: colabEmail.trim(),
        roleSlug: colabRole,
        teamIds: [...colabTeamIds],
      };

      const res = editando
        ? await updateCollaboratorAction({
            ...comum,
            userId: editando.id,
            ...(colabSenha.trim() ? { password: colabSenha } : {}),
          })
        : await createCollaboratorAction({ ...comum, password: colabSenha });

      if (res.ok) {
        setColabAberto(false);
        router.refresh();
      } else {
        setColabError(res.error ?? 'Erro ao salvar o colaborador.');
      }
    });
  };

  const handleRemoverColaborador = () => {
    if (!removendo) return;
    startTransition(async () => {
      const res = await removeCollaboratorAction({ userId: removendo.id });
      setRemovendo(null);
      if (res.ok) router.refresh();
    });
  };

  const handleConfirmDeleteTeam = async () => {
    if (!deletingTeam) return;
    startTransition(async () => {
      await deleteTeamAction({ teamId: deletingTeam.id });
      setDeletingTeam(null);
      router.refresh();
    });
  };

  // KPIs
  const totalMembers = members.length;
  const onlineAgents = members.filter((m) => m.availability === 'disponivel').length;
  const adminCount = members.filter((m) => m.roleSlug === 'administrador').length;

  const roleNameOf = (slug: string): string =>
    roles.find((r) => r.slug === slug)?.name ?? slug;

  const filteredMembers = useMemo(() => {
    if (roleFilter === 'todos') return members;
    return members.filter((m) => m.roleSlug === roleFilter);
  }, [members, roleFilter]);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {/* ============================================================ */}
      {/* CABEÇALHO DA SEÇÃO                                           */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              Equipe e permissões
            </h2>
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              {totalMembers} {totalMembers === 1 ? 'membro' : 'membros'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Gerencie os membros da equipe e controle os níveis de acesso e filas no CRM.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'equipes' ? (
            <Button size="md" icon={<Plus className="size-4" />} onClick={openNewTeam}>
              Nova equipe
            </Button>
          ) : (
            <Button size="md" icon={<UserPlus className="size-4" />} onClick={abrirNovoColaborador}>
              Novo colaborador
            </Button>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 4 KPI CARDS NO TOPO ESTILO DASHBOARD                         */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Card 1: Total */}
        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Total de membros</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {totalMembers}
          </div>
          <span className="mt-1 block text-[11px] text-dim">Usuários cadastrados</span>
        </div>

        {/* Card 2: Agentes Online */}
        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Agentes online</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {onlineAgents}
          </div>
          <span className="mt-1 block text-[11px] text-green-600 dark:text-green-400 font-semibold">
            {Math.round((onlineAgents / (totalMembers || 1)) * 100)}% da equipe ativa
          </span>
        </div>

        {/* Card 3: Administradores */}
        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Administradores</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Shield className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {adminCount}
          </div>
          <span className="mt-1 block text-[11px] text-dim">Gestão total da conta</span>
        </div>

        {/* Card 4: Equipes / Filas */}
        <div className="rounded-2xl border border-line bg-surface p-4.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Equipes ativas</span>
            <div className="flex size-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Layers className="size-4" />
            </div>
          </div>
          <div className="mt-3 font-display text-2xl font-bold text-ink tabular-nums">
            {teams.length}
          </div>
          <span className="mt-1 block text-[11px] text-dim">Filas segmentadas</span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* NAVEGAÇÃO DE SUB-ABAS (Membros / Papéis / Equipes)            */}
      {/* ============================================================ */}
      <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface-2 p-1 text-xs w-fit">
        <button
          type="button"
          onClick={() => setSubTab('membros')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3.5 py-1.5 font-semibold transition-all',
            subTab === 'membros'
              ? 'bg-surface text-ink shadow-2xs font-bold ring-1 ring-black/5 dark:ring-white/10'
              : 'text-muted hover:text-ink',
          )}
        >
          <Users className="size-3.5 text-dim" />
          <span>Membros da equipe</span>
        </button>
        {/* Papéis e permissões nunca é delegada: um supervisor com "gerenciar
            membros" não vê nem a aba. Ver `ADMIN_ONLY_PERMISSIONS`. */}
        {canEditRoles ? (
          <button
            type="button"
            onClick={() => setSubTab('papeis')}
            className={cn(
              'flex items-center gap-2 rounded-xl px-3.5 py-1.5 font-semibold transition-all',
              subTab === 'papeis'
                ? 'bg-surface text-ink shadow-2xs font-bold ring-1 ring-black/5 dark:ring-white/10'
                : 'text-muted hover:text-ink',
            )}
          >
            <Shield className="size-3.5 text-dim" />
            <span>Papéis e permissões</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setSubTab('equipes')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-3.5 py-1.5 font-semibold transition-all',
            subTab === 'equipes'
              ? 'bg-surface text-ink shadow-2xs font-bold ring-1 ring-black/5 dark:ring-white/10'
              : 'text-muted hover:text-ink',
          )}
        >
          <Layers className="size-3.5 text-dim" />
          <span>Equipes e filas</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* ABA 1: MEMBROS DA EQUIPE (TABELA MODERNA + FILTROS)          */}
      {/* ============================================================ */}
      {subTab === 'membros' ? (
        <div className="flex flex-col gap-4">
          {/* Filtros Rápidos */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-dim mr-1">Filtrar por papel:</span>
            {['todos', 'administrador', 'supervisor', 'colaborador'].map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={cn(
                  'rounded-xl px-3 py-1 font-semibold transition-all capitalize',
                  roleFilter === role
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-bold'
                    : 'border border-line bg-surface text-muted hover:bg-surface-2',
                )}
              >
                {role}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line bg-surface-2/60 text-[11px] font-semibold text-muted uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="px-4 py-3">Membro</th>
                    <th scope="col" className="px-4 py-3">E-mail</th>
                    <th scope="col" className="px-4 py-3">Função</th>
                    <th scope="col" className="px-4 py-3">Equipes atribuídas</th>
                    <th scope="col" className="px-4 py-3">Acesso</th>
                    <th scope="col" className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-surface-2/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={member.name}
                            tone={member.avatarTone}
                            size="sm"
                            availability={member.availability}
                          />
                          <div className="min-w-0">
                            <span className="font-bold text-ink block truncate">
                              {member.name}
                            </span>
                            <span className="text-[11px] text-dim capitalize">
                              {member.availability === 'disponivel'
                                ? 'Disponível agora'
                                : member.availability === 'ocupado'
                                  ? 'Ocupado'
                                  : 'Ausente'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 font-mono text-muted">
                        {member.email}
                      </td>

                      <td className="px-4 py-3.5">
                        <Badge
                          tone={
                            member.roleSlug === 'administrador'
                              ? 'violet'
                              : member.roleSlug === 'supervisor'
                                ? 'blue'
                                : 'slate'
                          }
                        >
                          {roleNameOf(member.roleSlug)}
                        </Badge>
                      </td>

                      <td className="px-4 py-3.5">
                        {member.teams && member.teams.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {member.teams.map((t) => (
                              <span
                                key={t}
                                className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-ink border border-line-soft"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-dim text-[11px]">Todas as caixas</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3" />
                          Ativo
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {/* Administrador não é personalizável: o papel dele
                              já é o acesso total, e tirar peças dele por aqui
                              produziria um administrador que não administra. */}
                          {canEditRoles && member.roleSlug !== 'administrador' ? (
                            <button
                              type="button"
                              onClick={() => abrirPermissoesDaPessoa(member)}
                              title={`Personalizar permissões de ${member.name}`}
                              className="rounded-control p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
                            >
                              <KeyRound className="size-3.5" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => abrirEdicaoColaborador(member)}
                            title={`Editar acesso de ${member.name}`}
                            className="rounded-control p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemovendo(member)}
                            title={`Remover ${member.name} da conta`}
                            className="rounded-control p-1.5 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* ============================================================ */}
      {/* ABA 2: PAPÉIS E PERMISSÕES                                    */}
      {/* ============================================================ */}
      {subTab === 'papeis' && canEditRoles ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-display text-base font-bold text-ink">
                    {role.name}
                  </h4>
                  <Badge
                    tone={
                      role.slug === 'administrador'
                        ? 'violet'
                        : role.slug === 'supervisor'
                          ? 'blue'
                          : 'slate'
                    }
                  >
                    {role.slug}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted leading-relaxed">
                  {role.description}
                </p>

                <div className="mt-4 border-t border-line-soft pt-3">
                  <span className="text-[11px] font-semibold text-dim uppercase">
                    {role.permissions.length} permissões concedidas
                  </span>
                  <div className="mt-2 flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                    {role.permissions.map((p) => (
                      <span
                        key={p}
                        className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted border border-line-soft"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* O administrador não é editável: tirar permissão dele é o
                  caminho mais curto para uma conta sem quem a conserte. */}
              {canEditRoles && role.slug !== 'administrador' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-4 w-full"
                  icon={<Pencil className="size-3.5" />}
                  onClick={() => abrirPermissoesDoPapel(role)}
                >
                  Editar permissões
                </Button>
              ) : (
                <p className="mt-4 text-[11px] text-dim">
                  {role.slug === 'administrador'
                    ? 'Acesso total, não editável.'
                    : 'Somente um administrador edita papéis.'}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/* ============================================================ */}
      {/* ABA 3: EQUIPES E FILAS                                       */}
      {/* ============================================================ */}
      {subTab === 'equipes' ? (
        <div className="flex flex-col gap-4">
          {teams.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2/40 p-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-dim mb-3">
                <Layers className="size-6" />
              </div>
              <h4 className="font-display text-base font-bold text-ink">
                Nenhuma equipe cadastrada
              </h4>
              <p className="mt-1 max-w-md text-xs text-muted">
                Equipes agrupam atendentes por setor (Comercial, Suporte, Financeiro) e direcionam conversas das caixas correspondentes.
              </p>
              <Button size="md" className="mt-5" icon={<Plus className="size-4" />} onClick={openNewTeam}>
                Criar primeira equipe
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs transition-all hover:border-brand/40 hover:shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="size-3.5 rounded-full ring-2 ring-white/10"
                          style={{ backgroundColor: team.color }}
                        />
                        <h4 className="font-display text-base font-bold text-ink">
                          {team.name}
                        </h4>
                      </div>
                      <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted border border-line-soft">
                        {team.memberIds.length} {team.memberIds.length === 1 ? 'membro' : 'membros'}
                      </span>
                    </div>

                    <div className="mt-4 border-t border-line-soft pt-3">
                      <span className="text-[11px] font-semibold uppercase text-dim">
                        Caixas de entrada vinculadas
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {team.inboxIds.length > 0 ? (
                          team.inboxIds.map((id) => (
                            <span
                              key={id}
                              className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400"
                            >
                              {inboxNameOf(id)}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-dim italic">Nenhuma caixa atribuída</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-end gap-2 border-t border-line-soft pt-3">
                    <Button variant="ghost" size="sm" onClick={() => openEditTeam(team)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir equipe ${team.name}`}
                      onClick={() => setDeletingTeam(team)}
                      icon={<Trash2 className="size-3.5 text-red-500" />}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Modal Nova/Editar Equipe */}
      <Modal
        open={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        title={editingTeam ? `Editar ${editingTeam.name}` : 'Criar nova equipe'}
        description="Configure o nome, cor e as caixas que essa equipe atenderá."
        className="max-w-md"
      >
        <form onSubmit={handleSaveTeam} className="flex flex-col gap-4 pt-1">
          {teamError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {teamError}
            </p>
          ) : null}

          <div>
            <label htmlFor="team-name" className="mb-1 block text-xs font-semibold text-ink">
              Nome da equipe
            </label>
            <input
              id="team-name"
              type="text"
              required
              placeholder="Ex: Comercial, Suporte N2, Cobrança"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink">
              Cor de identificação
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={teamColor}
                onChange={(e) => setTeamColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1"
              />
              <span className="font-mono text-xs text-muted">{teamColor}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink">
              Caixas de entrada atendidas
            </label>
            <div className="max-h-36 overflow-y-auto rounded-xl border border-line bg-surface p-2 flex flex-col gap-1">
              {inboxes.map((inbox) => (
                <label
                  key={inbox.id}
                  className="flex items-center gap-2.5 rounded-lg p-1.5 text-xs hover:bg-surface-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={teamInboxIds.includes(inbox.id)}
                    onChange={() => toggle(teamInboxIds, inbox.id, setTeamInboxIds)}
                    className="rounded accent-brand cursor-pointer"
                  />
                  <span className="font-medium text-ink">{inbox.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsTeamModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !teamName.trim()}>
              {isPending ? 'Salvando…' : 'Salvar equipe'}
            </Button>
          </div>
        </form>
      </Modal>

      {/*
        Painel do colaborador.

        Substituiu o modal de convite. O convite entregava um link e transferia
        para o colaborador as duas decisões que são de quem contrata: qual
        senha usar e quando entrar. E não havia volta — o gestor não conseguia
        recuperar um acesso perdido, só emitir outro link e esperar de novo.
      */}
      <Modal
        open={colabAberto}
        onClose={() => setColabAberto(false)}
        title={editando ? `Editar acesso de ${editando.name}` : 'Novo colaborador'}
        description={
          editando
            ? 'Altere os dados de acesso, o papel e as equipes deste colaborador.'
            : 'Crie o acesso e entregue o e-mail e a senha ao colaborador.'
        }
        className="max-w-md"
      >
        <form onSubmit={handleSalvarColaborador} className="flex flex-col gap-4 pt-1">
          {colabError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {colabError}
            </p>
          ) : null}

          <div>
            <label htmlFor="colab-nome" className="mb-1 block text-xs font-semibold text-ink">
              Nome completo
            </label>
            <input
              id="colab-nome"
              type="text"
              required
              minLength={2}
              placeholder="Ex: Camila Reis"
              value={colabNome}
              onChange={(e) => setColabNome(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="colab-email" className="mb-1 block text-xs font-semibold text-ink">
              E-mail de acesso
            </label>
            <input
              id="colab-email"
              type="email"
              required
              autoComplete="off"
              placeholder="nome@empresa.com.br"
              value={colabEmail}
              onChange={(e) => setColabEmail(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="colab-senha" className="mb-1 block text-xs font-semibold text-ink">
              {editando ? 'Nova senha' : 'Senha'}
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
              <input
                id="colab-senha"
                type={mostrarSenha ? 'text' : 'password'}
                required={!editando}
                autoComplete="new-password"
                placeholder={editando ? 'Deixe em branco para manter a atual' : 'Mínimo 10 caracteres'}
                value={colabSenha}
                onChange={(e) => setColabSenha(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface pr-10 pl-9 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
              />
              {/*
                Visível por padrão? Não — mas com um olho.

                Quem cria a senha de outra pessoa precisa conferir o que
                digitou para poder ditá-la depois. Sem o olho, o caminho é
                colar num bloco de notas, e aí a senha vira um arquivo.
              */}
              <button
                type="button"
                onClick={() => setMostrarSenha((atual) => !atual)}
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Exibir senha'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-dim transition-colors hover:text-ink"
              >
                {mostrarSenha ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            {editando ? (
              <p className="mt-1 text-[11px] text-dim">
                Trocar a senha encerra as sessões abertas deste colaborador.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="colab-role" className="mb-1 block text-xs font-semibold text-ink">
              Nível de acesso
            </label>
            <select
              id="colab-role"
              value={colabRole}
              onChange={(e) => setColabRole(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            >
              {roles.map((role) => (
                <option key={role.slug} value={role.slug}>
                  {role.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">
              {roles.find((role) => role.slug === colabRole)?.description ??
                'Escolha o que este colaborador poderá fazer.'}
            </p>
          </div>

          {teams.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">
                Equipes de atendimento
              </label>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-surface p-2">
                {teams.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-xs hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={colabTeamIds.includes(t.id)}
                      onChange={() => toggle(colabTeamIds, t.id, setColabTeamIds)}
                      className="cursor-pointer rounded accent-brand"
                    />
                    <span className="font-medium text-ink">{t.name}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-dim">
                As equipes decidem quais caixas ele alcança. Sem nenhuma, ele vê as caixas que o
                papel permitir.
              </p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" type="button" onClick={() => setColabAberto(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || !colabNome.trim() || !colabEmail.trim()}
            >
              {isPending ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar acesso'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmação de Remoção de Colaborador */}
      <ConfirmModal
        open={removendo !== null}
        title="Remover colaborador"
        description={
          <span>
            Remover <strong className="text-ink">{removendo?.name}</strong> desta conta? Ele perde o
            acesso imediatamente. As conversas e os contatos que atendeu permanecem.
          </span>
        }
        confirmLabel="Remover acesso"
        variant="danger"
        isLoading={isPending}
        onConfirm={handleRemoverColaborador}
        onClose={() => setRemovendo(null)}
      />

      {/* Confirmação de Exclusão de Equipe */}
      <ConfirmModal
        open={deletingTeam !== null}
        title="Excluir equipe"
        description={
          <span>
            Tem certeza que deseja excluir a equipe{' '}
            <strong className="text-ink">{deletingTeam?.name}</strong>? Os membros não serão excluídos do CRM, mas perderão a filtragem por esta fila.
          </span>
        }
        confirmLabel="Excluir equipe"
        variant="danger"
        isLoading={isPending}
        onClose={() => setDeletingTeam(null)}
        onConfirm={handleConfirmDeleteTeam}
      />

      {/* ============================================================ */}
      {/* EDITOR DE PERMISSÕES (papel ou pessoa — mesma grade)          */}
      {/* ============================================================ */}
      <Modal
        open={permAlvo !== null}
        onClose={() => setPermAlvo(null)}
        title={
          permAlvo?.tipo === 'papel'
            ? `Permissões do papel ${permAlvo.role.name}`
            : permAlvo
              ? `Permissões de ${permAlvo.member.name}`
              : 'Permissões'
        }
        description={
          permAlvo?.tipo === 'papel'
            ? 'Vale para todas as pessoas com este papel, inclusive as já cadastradas.'
            : `Personalização sobre o papel ${
                permAlvo ? roleNameOf(permAlvo.member.roleSlug) : ''
              }. O que não for mexido continua acompanhando o papel.`
        }
        className="max-w-3xl"
      >
        <div className="flex flex-col gap-4">
          {permErro ? (
            <p className="rounded-xl border border-red-line/50 bg-red-soft p-3 text-xs text-red-text">
              {permErro}
            </p>
          ) : null}

          <div className="max-h-[55vh] overflow-y-auto pr-1">
            <PermissionGrid
              selected={permMarcadas}
              onToggle={alternarPermissao}
              disabled={isPending}
              {...(permAlvo?.tipo === 'pessoa'
                ? { roleBaseline: papelDoAlvo?.permissions ?? [] }
                : {})}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-[11px] text-muted">
              {permMarcadas.length} permissão(ões) marcada(s)
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isPending}
                onClick={() => setPermAlvo(null)}
              >
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={isPending} onClick={salvarPermissoes}>
                {isPending ? 'Salvando…' : 'Salvar permissões'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

    </div>
  );
}
