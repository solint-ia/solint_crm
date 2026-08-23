'use client';

import { useMemo, useState } from 'react';
import { Search, UserMinus } from 'lucide-react';
import type { Conversation } from '@/core/domain/conversation';
import type { User } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';

interface TransferModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly conversation: Conversation;
  readonly members: readonly User[];
  readonly currentUserId: string;
  readonly onAssign: (assignee: { id: string; name: string } | null) => void;
}

const AVAILABILITY_LABEL = {
  disponivel: 'disponível',
  ocupado: 'ocupado',
  ausente: 'ausente',
} as const;

/**
 * Transferir atendimento.
 *
 * O botão existia desde o começo sem nenhum comportamento, e `assign` já estava
 * pronto no repositório — faltava só a tela. A ordenação não é alfabética: quem
 * está disponível aparece primeiro, porque transferir para alguém ausente é o
 * erro que a lista precisa evitar.
 */
export function TransferModal({
  open,
  onClose,
  conversation,
  members,
  currentUserId,
  onAssign,
}: TransferModalProps) {
  const [term, setTerm] = useState('');

  const ordered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const rank = { disponivel: 0, ocupado: 1, ausente: 2 } as const;
    return members
      .filter(
        (member) =>
          !needle ||
          member.name.toLowerCase().includes(needle) ||
          member.email.toLowerCase().includes(needle),
      )
      .slice()
      .sort((a, b) => rank[a.availability] - rank[b.availability] || a.name.localeCompare(b.name));
  }, [members, term]);

  const choose = (assignee: { id: string; name: string } | null) => {
    onAssign(assignee);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transferir atendimento"
      description={`${conversation.contact.name} · atualmente com ${
        conversation.assigneeName ?? 'ninguém'
      }`}
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
          <TextInput
            autoFocus
            className="pl-8"
            aria-label="Buscar agente"
            placeholder="Buscar por nome ou e-mail"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>

        <ul className="max-h-72 overflow-y-auto rounded-control border border-line divide-y divide-line-soft">
          {ordered.map((member) => {
            const current = member.id === conversation.assigneeId;
            return (
              <li key={member.id}>
                <button
                  type="button"
                  disabled={current}
                  onClick={() => choose({ id: member.id, name: member.name })}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                    current
                      ? 'cursor-default bg-selected'
                      : 'hover:bg-surface-2',
                  )}
                >
                  <Avatar
                    name={member.name}
                    tone={member.avatarTone}
                    size="sm"
                    availability={member.availability}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-body font-semibold text-ink">
                        {member.name}
                      </span>
                      {member.id === currentUserId ? (
                        <span className="text-micro text-dim">(você)</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-meta text-dim">
                      {member.roleSlug} · {AVAILABILITY_LABEL[member.availability]}
                    </span>
                  </span>
                  {current ? (
                    <span className="shrink-0 text-meta font-semibold text-brand">atual</span>
                  ) : null}
                </button>
              </li>
            );
          })}

          {ordered.length === 0 ? (
            <li className="px-3 py-6 text-center text-body text-dim">
              Nenhum agente corresponde a “{term}”.
            </li>
          ) : null}
        </ul>

        {conversation.assigneeId ? (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            icon={<UserMinus className="size-3.5" />}
            onClick={() => choose(null)}
          >
            Devolver para a fila geral
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
