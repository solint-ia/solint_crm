'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Calendar,
  Clock,
  Kanban,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Tag,
  Trash2,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { PhoneNumber } from '@/core/domain/contact';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { LabelChips } from '@/components/domain/label-chip';
import { ContactTimeline } from './contact-timeline';
import { StartConversationButton } from './start-conversation-button';
import { deleteContactAction } from '@/app/(workspace)/contatos/actions';
import { cn } from '@/lib/cn';


interface ContactDrawerProps {
  readonly contact: Contact | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onEdit: (contact: Contact) => void;
  readonly onDelete?: (contactId: string) => void;
}

export function ContactDrawer({
  contact,
  open,
  onClose,
  onEdit,
  onDelete,
}: ContactDrawerProps) {
  const router = useRouter();
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'geral' | 'timeline'>('geral');

  // Fecha no Esc
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !contact) return null;

  const rawPhone = contact.phone.replace(/\D/g, '');
  const waUrl = rawPhone ? `https://wa.me/${rawPhone}` : null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await deleteContactAction({ contactId: contact.id });
      if (res.ok) {
        setIsConfirmDeleteOpen(false);
        onDelete?.(contact.id);
        onClose();
        router.refresh();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes do contato ${contact.name}`}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-200 ease-out sm:max-w-xl',
          'animate-in slide-in-from-right duration-200',
        )}
      >
        {/* Topo do Drawer */}
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4 bg-surface-2/40">
          <div className="flex items-center gap-2 text-meta font-medium text-muted">
            <User className="size-4 text-brand" />
            <span>Perfil do Contato</span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil className="size-3.5" />}
              onClick={() => onEdit(contact)}
            >
              Editar
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar painel de detalhes"
              className="rounded-control p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        {/* Informações Principais do Contato */}
        <div className="flex flex-col items-center border-b border-line bg-surface p-6 text-center">
          <div className="relative mb-3">
            <Avatar name={contact.name} tone={contact.avatarTone} size="lg" />
            {contact.channel && (
              <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-surface border-2 border-surface shadow-xs">
                {contact.channel === 'whatsapp' ? (
                  <MessageCircle className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <MessageSquare className="size-3.5 text-brand" />
                )}
              </span>
            )}
          </div>

          <h3 className="font-display text-metric font-bold text-ink tracking-tight">
            {contact.name}
          </h3>

          {contact.company && (
            <p className="mt-0.5 flex items-center gap-1 text-body text-muted">
              <Building2 className="size-3.5 text-dim" />
              <span>{contact.company}</span>
            </p>
          )}

          {/* Ações Rápidas em Destaque */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {waUrl && (
              <StartConversationButton
                contact={contact}
                onNavigate={onClose}
                className="flex items-center gap-1.5 rounded-control bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-3 py-1.5 text-meta font-semibold transition-colors shadow-2xs"
              />
            )}

            <Link
              href="/kanban"
              className="flex items-center gap-1.5 rounded-control border border-line bg-surface hover:bg-surface-2 text-ink px-3 py-1.5 text-meta font-semibold transition-colors shadow-2xs"
            >
              <Kanban className="size-3.5 text-brand" />
              <span>Ver no Funil</span>
            </Link>
          </div>

          {/* Abas de Navegação Interna */}
          <div className="mt-6 flex w-full border-t border-line-soft pt-3">
            <div className="flex w-full gap-1 rounded-lg bg-surface-2 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('geral')}
                className={cn(
                  'flex-1 rounded-md py-1.5 text-xs font-semibold transition-all',
                  activeTab === 'geral'
                    ? 'bg-surface text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
                )}
              >
                Dados Gerais
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('timeline')}
                className={cn(
                  'flex-1 rounded-md py-1.5 text-xs font-semibold transition-all',
                  activeTab === 'timeline'
                    ? 'bg-surface text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
                )}
              >
                Histórico & Linha do Tempo
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo Rolável */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'geral' ? (
            <>
              {/* Seção: Informações de Contato */}
              <section className="space-y-3">
                <h4 className="text-meta font-bold uppercase tracking-wider text-dim">
                  Contatos & Endereço
                </h4>
                <div className="grid gap-2.5 rounded-xl border border-line bg-surface-2/40 p-4 text-body">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-muted">
                      <Phone className="size-3.5 text-dim" />
                      <span>Telefone:</span>
                    </span>
                    <span className="font-mono font-medium text-ink">
                      {PhoneNumber.format(contact.phone)}
                    </span>
                  </div>

                  {contact.email && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-muted">
                        <Mail className="size-3.5 text-dim" />
                        <span>E-mail:</span>
                      </span>
                      <a
                        href={`mailto:${contact.email}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {contact.email}
                      </a>
                    </div>
                  )}

                  {contact.location && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-muted">
                        <Clock className="size-3.5 text-dim" />
                        <span>Localização / Fuso:</span>
                      </span>
                      <span className="text-ink">
                        {contact.location} {contact.timezone ? `· ${contact.timezone}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </section>

              {/* Seção: Gestão & Atribuição */}
              <section className="space-y-3">
                <h4 className="text-meta font-bold uppercase tracking-wider text-dim">
                  Gestão Comercial
                </h4>
                <div className="grid gap-2.5 rounded-xl border border-line bg-surface-2/40 p-4 text-body">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-muted">
                      <UserCheck className="size-3.5 text-dim" />
                      <span>Responsável:</span>
                    </span>
                    <span className="font-medium text-ink">
                      {contact.ownerName ?? 'Nenhum responsável'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-muted">
                      <Calendar className="size-3.5 text-dim" />
                      <span>Último Contato:</span>
                    </span>
                    <span className="text-ink">
                      {contact.lastContactLabel ?? 'Sem registro recente'}
                    </span>
                  </div>
                </div>
              </section>

              {/* Seção: Etiquetas */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-meta font-bold uppercase tracking-wider text-dim flex items-center gap-1.5">
                    <Tag className="size-3.5" />
                    <span>Etiquetas</span>
                  </h4>
                </div>
                {contact.labels.length > 0 ? (
                  <LabelChips labels={contact.labels} />
                ) : (
                  <p className="text-meta text-dim italic">Nenhuma etiqueta associada.</p>
                )}
              </section>

              {/* Seção: Atributos Personalizados */}
              {contact.customFields && contact.customFields.length > 0 && (
                <section className="space-y-3">
                  <h4 className="text-meta font-bold uppercase tracking-wider text-dim">
                    Atributos Personalizados
                  </h4>
                  <div className="grid gap-2 rounded-xl border border-line bg-surface-2/40 p-4">
                    {contact.customFields.map((field) => (
                      <div
                        key={field.label}
                        className="flex items-center justify-between gap-2 text-body"
                      >
                        <span className="text-muted">{field.label}:</span>
                        <span className="font-mono font-medium text-ink">{field.value}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Seção: Anotações Internas */}
              {contact.notes && (
                <section className="space-y-2.5">
                  <h4 className="text-meta font-bold uppercase tracking-wider text-dim">
                    Anotações Internas
                  </h4>
                  <div className="rounded-xl border border-line-soft bg-surface-2 p-3.5 text-body text-ink leading-relaxed whitespace-pre-wrap">
                    {contact.notes}
                  </div>
                </section>
              )}
            </>
          ) : (
            /* Linha do Tempo de Atividades */
            <section className="space-y-3">
              <h4 className="text-meta font-bold uppercase tracking-wider text-dim">
                Histórico de Interações
              </h4>
              <ContactTimeline events={contact.timeline ?? []} />
            </section>
          )}
        </div>

        {/* Rodapé do Drawer */}
        <footer className="flex shrink-0 items-center justify-between border-t border-line bg-surface-2/60 px-5 py-3.5">
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="size-3.5 text-red-600" />}
            onClick={() => setIsConfirmDeleteOpen(true)}
            className="text-red-600 hover:bg-red-soft"
          >
            Excluir contato
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Fechar
            </Button>
            <Button size="sm" onClick={() => onEdit(contact)}>
              Editar dados
            </Button>
          </div>
        </footer>
      </aside>

      {/* Modal de Confirmação de Exclusão */}
      <ConfirmModal
        open={isConfirmDeleteOpen}
        title="Excluir contato"
        description={
          <span>
            Tem certeza que deseja excluir o contato{' '}
            <strong className="text-ink">&ldquo;{contact.name}&rdquo;</strong>? O histórico de atendimentos, conversas e dados cadastrais serão removidos.
          </span>
        }
        confirmLabel="Excluir contato"
        variant="danger"
        isLoading={isDeleting}
        onClose={() => setIsConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
