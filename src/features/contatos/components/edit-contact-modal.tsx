'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Mail,
  Phone,
  User,
} from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updateContactAction } from '@/app/(workspace)/contatos/actions';

interface EditContactModalProps {
  readonly contact: Contact | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUpdated?: (updated: Contact) => void;
}

export function EditContactModal({
  contact,
  open,
  onClose,
  onUpdated,
}: EditContactModalProps) {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      setName(contact.name);
      setPhone(contact.phone);
      setEmail(contact.email ?? '');
      setCompany(contact.company ?? '');
      setNotes(contact.notes ?? '');
      setError(null);
    }
  }, [contact]);

  if (!contact) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await updateContactAction({
        contactId: contact.id,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() ? email.trim() : undefined,
        company: company.trim() ? company.trim() : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
      });

      if (res.ok) {
        show({
          tone: 'sucesso',
          title: 'Contato atualizado',
          description: `Os dados de ${name} foram salvos com sucesso.`,
        });
        if (res.data) {
          onUpdated?.(res.data as Contact);
        }
        onClose();
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao atualizar contato.');
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Editar Contato: ${contact.name}`}
      description="Atualize as informações comerciais e dados de contato."
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-1">
        {error && (
          <div className="rounded-lg bg-red-soft p-3 text-meta text-red-text border border-red-line/40">
            {error}
          </div>
        )}

        {/* Nome Completo */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
            <User className="size-3.5 text-muted" />
            <span>Nome completo <span className="text-red-500">*</span></span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
          />
        </div>

        {/* Telefone e E-mail */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
              <Phone className="size-3.5 text-muted" />
              <span>Telefone / WhatsApp <span className="text-red-500">*</span></span>
            </label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-body text-ink outline-none transition-colors focus:border-brand"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
              <Mail className="size-3.5 text-muted" />
              <span>E-mail</span>
            </label>
            <input
              type="email"
              placeholder="cliente@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
            />
          </div>
        </div>

        {/* Empresa */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
            <Building2 className="size-3.5 text-muted" />
            <span>Empresa / Organização</span>
          </label>
          <input
            type="text"
            placeholder="Nome da empresa"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
          />
        </div>

        {/* Anotações */}
        <div>
          <label className="mb-1.5 block text-meta font-medium text-ink">
            Anotações internas
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
          />
        </div>

        {/* Rodapé do Modal */}
        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-line-soft pt-4">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={isPending || !name.trim() || !phone.trim()}
          >
            {isPending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
