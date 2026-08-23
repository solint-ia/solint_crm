'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Role, User } from '@/core/domain/user';
import type { Team } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { planned } from '@/components/ui/planned';

interface TeamSectionProps {
  readonly members: readonly User[];
  readonly roles: readonly Role[];
  readonly teams: readonly Team[];
}

type TeamSubTab = 'membros' | 'papeis' | 'equipes';

export function TeamSection({ members, roles, teams }: TeamSectionProps) {
  const [subTab, setSubTab] = useState<TeamSubTab>('membros');

  return (
    <div className="flex flex-col gap-4">
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

        {subTab === 'membros' ? (
          <Button size="sm" icon={<Plus className="size-3.5" />} {...planned('Convidar um agente por e-mail')}>
            Convidar membro
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
                    <td className="px-4 py-3 capitalize text-ink">{member.roleSlug}</td>
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
                      <Badge tone={member.twoFactorEnabled ? 'green' : 'amber'}>
                        {member.twoFactorEnabled ? 'Ativo' : 'Pendente'}
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
                <h3 className="text-ui font-semibold text-ink">{team.name}</h3>
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
              <div className="mt-4 border-t border-line pt-3">
                <Button variant="secondary" size="sm" className="w-full" {...planned('Configurar esta fila de atendimento')}>
                  Configurar fila
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
