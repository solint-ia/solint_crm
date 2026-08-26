'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Mail,
  MessageSquare,
  Phone,
  User,
} from 'lucide-react';
import type { Channel } from '@/core/domain/channel';
import { CHANNELS, describeChannel } from '@/core/domain/channel';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createContactAction } from '@/app/(workspace)/contatos/actions';


interface NewContactModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function NewContactModal({ open, onClose }: NewContactModalProps) {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setPhone('');
    setEmail('');
    setCompany('');
    setChannel('whatsapp');
    setNotes('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createContactAction({
        name,
        phone,
        email: email.trim() ? email.trim() : undefined,
        company: company.trim() ? company.trim() : undefined,
        channel,
        notes: notes.trim() ? notes.trim() : undefined,
      });

      if (res.ok) {
        show({
          tone: 'sucesso',
          title: 'Contato cadastrado com sucesso!',
          description: `${name} foi adicionado à base comercial.`,
        });
        handleClose();
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao cadastrar contato.');
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Novo Contato"
      description="Preencha os dados do cliente para adicioná-lo à base do CRM."
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
            placeholder="Ex: Amanda Albuquerque"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors placeholder:text-dim focus:border-brand"
          />
        </div>

        {/* Telefone e Canal */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
              <Phone className="size-3.5 text-muted" />
              <span>Telefone / WhatsApp <span className="text-red-500">*</span></span>
            </label>
            <input
              type="tel"
              required
              placeholder="+55 11 98888-7777"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-body text-ink outline-none transition-colors placeholder:text-dim focus:border-brand"
            />
            <span className="mt-1 block text-micro text-dim">Formato nacional ou internacional com DDI</span>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
              <MessageSquare className="size-3.5 text-muted" />
              <span>Canal preferencial</span>
            </label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors focus:border-brand"
            >
              {CHANNELS.map((id) => (
                <option key={id} value={id}>
                  {describeChannel(id).label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* E-mail e Empresa */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors placeholder:text-dim focus:border-brand"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-ink">
              <Building2 className="size-3.5 text-muted" />
              <span>Empresa</span>
            </label>
            <input
              type="text"
              placeholder="Empresa ou Organização"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors placeholder:text-dim focus:border-brand"
            />
          </div>
        </div>

        {/* Anotações */}
        <div>
          <label className="mb-1.5 block text-meta font-medium text-ink">
            Anotações iniciais / Contexto
          </label>
          <textarea
            rows={3}
            placeholder="Histórico, interesses ou notas da primeira abordagem..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors placeholder:text-dim focus:border-brand"
          />
        </div>

        {/* Rodapé do Modal */}
        <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-line-soft pt-4">
          <Button variant="secondary" size="sm" type="button" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={isPending || !name.trim() || !phone.trim()}
          >
            {isPending ? 'Cadastrando...' : 'Cadastrar contato'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
