'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import type { Role, User } from '@/core/domain/user';
import type { ChannelConnection, Team } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  /**
   * Caixas da conta.
   *
   * A equipe guarda **ids** de caixa, não nomes — nome não serve para
   * autorizar, porque renomear a caixa cortaria o acesso de quem dependia dela.
   * Quem traduz id em nome legível é esta tela.
   */
  readonly inboxes: readonly ChannelConnection[];
}

type TeamSubTab = 'membros' | 'papeis' | 'equipes';

export function TeamSection({ members, roles, teams, inboxes }: TeamSectionProps) {
  const inboxNameOf = (inboxId: string): string =>
    inboxes.find((inbox) => inbox.id === inboxId)?.name ?? inboxId;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [subTab, setSubTab] = useState<TeamSubTab>('membros');

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
        // O link aparece uma vez só — o banco guarda apenas o hash do token.
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

  return (
    <div className="flex flex-col gap-4">
      {/* Modal Equipe — criar e editar usam o mesmo formulário. */}
      <Modal
        open={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        title={editingTeam ? `Editar ${editingTeam.name}` : 'Criar nova equipe'}
      >
        <form onSubmit={handleSaveTeam} className="flex flex-col gap-4">
          {teamError && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">{teamError}</div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome da equipe</label>
            <input
              type="text"
              required
              placeholder="Ex: Recepção, Cobrança, Suporte N2"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">
              Cor de identificação
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={teamColor}
                onChange={(e) => setTeamColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-line bg-surface p-1"
              />
              <span className="font-mono text-meta text-muted">{teamColor}</span>
            </div>
          </div>

          {/*
            Seleção real, não texto livre.
            O campo pedia os nomes das caixas separados por vírgula, e nome não
            serve para autorizar acesso: um erro de digitação — ou renomear a
            caixa — cortava o acesso de todo mundo da equipe, em silêncio.
          */}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">
              Caixas que esta equipe atende
            </label>
            <p className="mb-2 text-meta text-muted">
              Quem está nesta equipe passa a ver as conversas destas caixas.
            </p>
            <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-2">
              {inboxes.map((inbox) => (
                <label
                  key={inbox.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-body text-ink hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={teamInboxIds.includes(inbox.id)}
                    onChange={() => toggle(teamInboxIds, inbox.id, setTeamInboxIds)}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  <span>{inbox.name}</span>
                  <Badge tone="slate">{inbox.channel}</Badge>
                </label>
              ))}
              {inboxes.length === 0 && (
                <span className="px-2 py-1.5 text-body text-muted">
                  Nenhuma caixa configurada nesta conta.
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Pessoas na equipe</label>
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-line bg-surface p-2">
              {members.map((member) => (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-body text-ink hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={teamMemberIds.includes(member.id)}
                    onChange={() => toggle(teamMemberIds, member.id, setTeamMemberIds)}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  <Avatar name={member.name} tone={member.avatarTone} size="sm" />
                  <span>{member.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsTeamModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !teamName.trim()}>
              {isPending ? 'Salvando...' : editingTeam ? 'Salvar' : 'Criar equipe'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Convite */}
      <Modal open={isInviteOpen} onClose={() => setIsInviteOpen(false)} title="Convidar pessoa">
        <form onSubmit={handleInvite} className="flex flex-col gap-4">
          {inviteError && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">{inviteError}</div>
          )}

          <div>
            <label className="mb-1 block text-meta font-medium text-ink">E-mail</label>
            <input
              type="email"
              required
              placeholder="pessoa@empresa.com.br"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>

          {/* Papel decide o que a pessoa pode fazer. */}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Papel</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.slug}>
                  {role.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-meta text-muted">
              Define o que a pessoa pode fazer: responder, transferir, ver relatórios.
            </p>
          </div>

          {/* Equipes decidem onde. Os dois eixos são independentes. */}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Equipes</label>
            <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-2">
              {teams.map((team) => (
                <label
                  key={team.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-body text-ink hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={inviteTeamIds.includes(team.id)}
                    onChange={() => toggle(inviteTeamIds, team.id, setInviteTeamIds)}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  <span>{team.name}</span>
                  <span className="text-meta text-muted">
                    {team.inboxIds.map(inboxNameOf).join(', ') || 'sem caixa'}
                  </span>
                </label>
              ))}
              {teams.length === 0 && (
                <span className="px-2 py-1.5 text-body text-muted">
                  Nenhuma equipe ainda. Sem equipes, a pessoa enxerga todas as caixas.
                </span>
              )}
            </div>
            <p className="mt-1 text-meta text-muted">
              Define quais caixas de entrada a pessoa enxerga.
            </p>
          </div>

          {inviteLink ? (
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <div className="mb-1 text-meta font-semibold text-ink">
                Link do convite — copie agora
              </div>
              <p className="mb-2 text-meta text-muted">
                Ele aparece uma única vez e vale por sete dias. Se perder, gere outro.
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="w-full rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-meta text-ink"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink);
                    setCopiado(true);
                  }}
                >
                  {copiado ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-2 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsInviteOpen(false)}>
              Fechar
            </Button>
            <Button type="submit" disabled={isPending || !inviteEmail.trim()}>
              {isPending ? 'Gerando...' : 'Gerar convite'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-control bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setSubTab('membros')}
            className={cn(
              'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
              subTab === 'membros'
                ? 'bg-surface text-brand shadow-xs'
                : 'text-muted hover:text-ink',
            )}
          >
            Membros da equipe
          </button>
          <button
            type="button"
            onClick={() => setSubTab('papeis')}
            className={cn(
              'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
              subTab === 'papeis' ? 'bg-surface text-brand shadow-xs' : 'text-muted hover:text-ink',
            )}
          >
            Papéis e permissões
          </button>
          <button
            type="button"
            onClick={() => setSubTab('equipes')}
            className={cn(
              'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
              subTab === 'equipes'
                ? 'bg-surface text-brand shadow-xs'
                : 'text-muted hover:text-ink',
            )}
          >
            Equipes e filas
          </button>
        </div>

        {subTab === 'equipes' ? (
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={openNewTeam}>
            Nova equipe
          </Button>
        ) : null}

        {subTab === 'membros' ? (
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setInviteLink(null);
              setInviteError(null);
              setIsInviteOpen(true);
            }}
          >
            Convidar pessoa
          </Button>
        ) : null}
      </div>

      {subTab === 'membros' ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-ui">
              <caption className="sr-only">Lista de membros da equipe</caption>
              <thead className="border-b border-line bg-surface-2 text-meta font-semibold text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Membro
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Papel
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Equipes
                  </th>
                  <th scope="col" className="px-4 py-3">
                    2FA
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={member.name}
                          tone={member.avatarTone}
                          size="sm"
                          availability={member.availability}
                        />
                        <span className="font-semibold text-ink">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{member.email}</td>
                    <td className="px-4 py-3">
                      <Badge tone="blue" className="capitalize">
                        {member.roleSlug}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {member.teams.map((t) => (
                          <Badge key={t} tone="slate">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={member.twoFactorEnabled ? 'green' : 'slate'}>
                        {member.twoFactorEnabled ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {subTab === 'papeis' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-ui font-semibold text-ink">{role.name}</h3>
                {role.isSystem ? <Badge tone="slate">Sistema</Badge> : null}
              </div>
              <p className="mt-1 text-body text-muted">{role.description}</p>
              <div className="mt-3 border-t border-line-soft pt-3">
                <div className="mb-2 text-meta font-semibold text-dim uppercase">
                  Permissões ({role.permissions.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {role.permissions.map((perm) => (
                    <Badge key={perm} tone="blue">
                      {perm}
                    </Badge>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {subTab === 'equipes' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id} className="flex flex-col justify-between p-4">
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-ui font-semibold text-ink">{team.name}</h3>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Editar equipe ${team.name}`}
                      onClick={() => openEditTeam(team)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Excluir equipe ${team.name}`}
                      onClick={() => setDeletingTeam(team)}
                      icon={<Trash2 className="size-3.5 text-danger" />}
                    />
                  </div>
                </div>
                <div className="mt-1 text-body text-muted">{team.memberCount} membros</div>
                <div className="mt-2 text-meta text-dim">
                  <span className="font-semibold text-ink">Horário:</span> {team.businessHours}
                </div>
                <div className="mt-3">
                  <div className="mb-1 text-meta font-semibold text-dim uppercase">
                    Inboxes vinculadas
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {team.inboxIds.map((inboxId) => (
                      <Badge key={inboxId} tone="slate">
                        {inboxNameOf(inboxId)}
                      </Badge>
                    ))}
                    {team.inboxIds.length === 0 && (
                      <span className="text-body text-muted">Nenhuma caixa vinculada</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <ConfirmModal
        open={deletingTeam !== null}
        title="Excluir equipe"
        description={
          <span>
            Tem certeza que deseja excluir a equipe{' '}
            <strong className="text-ink">{deletingTeam?.name}</strong>? Os membros associados serão
            desvinculados desta equipe.
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
