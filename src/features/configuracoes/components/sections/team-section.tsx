'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';

import type { Role, User } from '@/core/domain/user';
import type { Team } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { cn } from '@/lib/cn';
import { createTeamAction, deleteTeamAction } from '@/app/(workspace)/configuracoes/actions';

interface TeamSectionProps {
  readonly members: readonly User[];
  readonly roles: readonly Role[];
  readonly teams: readonly Team[];
}

type TeamSubTab = 'membros' | 'papeis' | 'equipes';

export function TeamSection({ members, roles, teams }: TeamSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [subTab, setSubTab] = useState<TeamSubTab>('membros');

  // Team Modal
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamColor, setTeamColor] = useState('#3B82F6');
  const [teamInboxes, setTeamInboxes] = useState<string>('WhatsApp · Comercial');
  const [teamError, setTeamError] = useState<string | null>(null);

  const handleCreateTeam = (e: React.FormEvent) => {
    e.preventDefault();
    setTeamError(null);
    startTransition(async () => {
      const res = await createTeamAction({
        name: teamName,
        color: teamColor,
        inboxes: teamInboxes.split(',').map((s) => s.trim()).filter(Boolean),
      });
      if (res.ok) {
        setIsTeamModalOpen(false);
        setTeamName('');
        router.refresh();
      } else {
        setTeamError(res.error ?? 'Erro ao criar equipe.');
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
      {/* Modal Nova Equipe */}
      <Modal
        open={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        title="Criar nova equipe"
      >
        <form onSubmit={handleCreateTeam} className="flex flex-col gap-4">
          {teamError && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {teamError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome da equipe</label>
            <input
              type="text"
              required
              placeholder="Ex: Comercial, Suporte N2, Financeiro"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Cor de identificação</label>
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
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Caixas vinculadas (separadas por vírgula)</label>
            <input
              type="text"
              placeholder="WhatsApp · Comercial, E-mail"
              value={teamInboxes}
              onChange={(e) => setTeamInboxes(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsTeamModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !teamName.trim()}>
              {isPending ? 'Criando...' : 'Criar equipe'}
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
              subTab === 'papeis'
                ? 'bg-surface text-brand shadow-xs'
                : 'text-muted hover:text-ink',
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
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setIsTeamModalOpen(true)}>
            Nova equipe
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
                  <th scope="col" className="px-4 py-3">Membro</th>
                  <th scope="col" className="px-4 py-3">Email</th>
                  <th scope="col" className="px-4 py-3">Papel</th>
                  <th scope="col" className="px-4 py-3">Equipes</th>
                  <th scope="col" className="px-4 py-3">2FA</th>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Excluir equipe ${team.name}`}
                    onClick={() => setDeletingTeam(team)}
                    icon={<Trash2 className="size-3.5 text-danger" />}
                  />
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
                    {team.inboxes.map((inbox) => (
                      <Badge key={inbox} tone="slate">
                        {inbox}
                      </Badge>
                    ))}
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
            <strong className="text-ink">{deletingTeam?.name}</strong>? Os membros associados serão desvinculados desta equipe.
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

