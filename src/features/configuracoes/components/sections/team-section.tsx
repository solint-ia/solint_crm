'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CheckCircle2,
  Copy,
  Layers,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

import type { Role, User } from '@/core/domain/user';
import type { ChannelConnection, Team } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { cn } from '@/lib/cn';
import {
  createTeamAction,
  deleteTeamAction,
  inviteMemberAction,
  updateTeamAction,
} from '@/app/(workspace)/configuracoes/actions';

interface TeamSectionProps {
  readonly members: readonly User[];
  readonly roles: readonly Role[];
  readonly teams: readonly Team[];
  readonly inboxes: readonly ChannelConnection[];
}

type TeamSubTab = 'membros' | 'papeis' | 'equipes';

export function TeamSection({ members, roles, teams, inboxes }: TeamSectionProps) {
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

  // Convite
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState(roles[0]?.slug ?? 'agente');
  const [inviteTeamIds, setInviteTeamIds] = useState<readonly string[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

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

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteLink(null);
    setCopiado(false);
    startTransition(async () => {
      const res = await inviteMemberAction({
        email: inviteEmail,
        roleSlug: inviteRole,
        teamIds: [...inviteTeamIds],
      });
      if (res.ok && res.link) {
        setInviteLink(`${window.location.origin}${res.link}`);
        router.refresh();
      } else {
        setInviteError(res.error ?? 'Erro ao gerar o convite.');
      }
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
            <Button
              size="md"
              icon={<UserPlus className="size-4" />}
              onClick={() => {
                setInviteLink(null);
                setInviteError(null);
                setIsInviteOpen(true);
              }}
            >
              Convidar membro
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
            {['todos', 'administrador', 'supervisor', 'agente'].map((role) => (
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
                    <th scope="col" className="px-4 py-3">Segurança 2FA</th>
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
      {subTab === 'papeis' ? (
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

      {/* Modal Convidar Membro */}
      <Modal
        open={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        title="Convidar novo membro"
        description="Envie um convite com link exclusivo para seu colaborador acessar o CRM."
        className="max-w-md"
      >
        <form onSubmit={handleInvite} className="flex flex-col gap-4 pt-1">
          {inviteError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {inviteError}
            </p>
          ) : null}

          <div>
            <label htmlFor="invite-email" className="mb-1 block text-xs font-semibold text-ink">
              E-mail do colaborador
            </label>
            <input
              id="invite-email"
              type="email"
              required
              placeholder="nome@empresa.com.br"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            />
          </div>

          <div>
            <label htmlFor="invite-role" className="mb-1 block text-xs font-semibold text-ink">
              Papel / Permissões
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-2xs"
            >
              {roles.map((role) => (
                <option key={role.slug} value={role.slug}>
                  {role.name} ({role.description})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink">
              Equipes de atendimento
            </label>
            <div className="max-h-32 overflow-y-auto rounded-xl border border-line bg-surface p-2 flex flex-col gap-1">
              {teams.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2.5 rounded-lg p-1.5 text-xs hover:bg-surface-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={inviteTeamIds.includes(t.id)}
                    onChange={() => toggle(inviteTeamIds, t.id, setInviteTeamIds)}
                    className="rounded accent-brand cursor-pointer"
                  />
                  <span className="font-medium text-ink">{t.name}</span>
                </label>
              ))}
            </div>
          </div>

          {inviteLink ? (
            <div className="rounded-xl border border-line-soft bg-surface-2 p-3">
              <span className="text-[11px] font-semibold text-dim uppercase">
                Link de acesso gerado:
              </span>
              <div className="mt-1 flex items-center justify-between gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-ink select-all outline-none"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copiado ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink);
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 2000);
                  }}
                >
                  {copiado ? 'Copiado!' : 'Copiar'}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsInviteOpen(false)}>
              {inviteLink ? 'Concluir' : 'Cancelar'}
            </Button>
            {!inviteLink ? (
              <Button type="submit" disabled={isPending || !inviteEmail.trim()}>
                {isPending ? 'Gerando…' : 'Gerar convite'}
              </Button>
            ) : null}
          </div>
        </form>
      </Modal>

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
    </div>
  );
}
