'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Edit2, Trash2 } from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { updateContactAction, deleteContactAction } from '@/app/(workspace)/contatos/actions';

interface ContactDetailActionsProps {
  readonly contact: Contact;
}

export function ContactDetailActions({ contact }: ContactDetailActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone);
  const [email, setEmail] = useState(contact.email ?? '');
  const [company, setCompany] = useState(contact.company ?? '');
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateContactAction({
        contactId: contact.id,
        name,
        phone,
        email,
        company,
        notes,
      });
      if (res.ok) {
        setIsEditOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao atualizar contato.');
      }
    });
  };

  const handleConfirmDelete = async () => {
    startTransition(async () => {
      const res = await deleteContactAction({ contactId: contact.id });
      if (res.ok) {
        setIsDeleteOpen(false);
        router.push('/contatos');
      } else {
        setError(res.error ?? 'Erro ao excluir contato.');
      }
    });
  };


  return (
    <>
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Editar contato">
        <form onSubmit={handleUpdate} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome completo</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Telefone / WhatsApp</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Empresa</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Notas internas</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !name.trim() || !phone.trim()}>
              {isPending ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsEditOpen(true)}
          icon={<Edit2 className="size-3.5" />}
        >
          Editar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Excluir contato ${contact.name}`}
          onClick={() => setIsDeleteOpen(true)}
          icon={<Trash2 className="size-3.5 text-danger" />}
        />
      </div>

      <ConfirmModal
        open={isDeleteOpen}
        title="Excluir contato"
        description={
          <span>
            Tem certeza que deseja excluir o contato <strong className="text-ink">{contact.name}</strong>? Ele sai da agenda. Se já houver conversa com ele, o histórico de mensagens continua na caixa de entrada.
          </span>
        }
        confirmLabel="Excluir contato"
        variant="danger"
        isLoading={isPending}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

