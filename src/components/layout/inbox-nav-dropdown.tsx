'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronRight,
  Globe,
  Inbox,
  Mail,
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export interface AccessibleInbox {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
  readonly identifier?: string;
  readonly status: string;
  readonly teamName?: string;
  readonly unreadCount: number;
}

interface InboxNavDropdownProps {
  readonly accessibleInboxes: readonly AccessibleInbox[];
  readonly totalUnreadCount: number;
  readonly canManageInboxes?: boolean;
  readonly roleName?: string;
  readonly active?: boolean;
}

export function InboxNavDropdown({
  accessibleInboxes,
  totalUnreadCount,
  canManageInboxes = false,
  roleName,
  active = false,
}: InboxNavDropdownProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [currentCaixa, setCurrentCaixa] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Detecta se a URL atual tem ?caixa=...
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setCurrentCaixa(params.get('caixa'));
    }
  }, [pathname]);

  // Fecha no Escape e fecha ao navegar
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const channelIcon = (channel: string) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <MessageSquare className="size-3.5" />
          </span>
        );
      case 'instagram':
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-pink-500/15 text-pink-600 dark:text-pink-400">
            <Sparkles className="size-3.5" />
          </span>
        );
      case 'email':
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Mail className="size-3.5" />
          </span>
        );
      default:
        return (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
            <Globe className="size-3.5" />
          </span>
        );
    }
  };

  return (
    <div className="relative">
      {/* Botão de disparo na Barra Lateral */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title={`Caixas de entrada (${accessibleInboxes.length} disponíveis)`}
        aria-label="Caixas de entrada"
        className={cn(
          'group relative flex size-10 items-center justify-center rounded-xl transition-all duration-150',
          active || isOpen
            ? 'bg-brand/12 font-semibold text-brand border border-brand/25 shadow-xs'
            : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
        )}
      >
        <Inbox className="size-[19px] transition-transform group-hover:scale-110" />

        {/* Badge de Não Lidas Total */}
        {totalUnreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white shadow-sm shadow-blue-600/40">
            {totalUnreadCount}
          </span>
        )}

        {/* Indicador sutil de dropdown disponível */}
        <span
          className={cn(
            'absolute bottom-1 right-1 size-1 rounded-full transition-all',
            isOpen ? 'bg-brand scale-125' : 'bg-muted/40 group-hover:bg-brand',
          )}
        />
      </button>

      {/* Flyout Dropdown Flutuante ao lado da Rail */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            ref={menuRef}
            role="menu"
            aria-label="Caixas de entrada disponíveis"
            className="fixed left-16 top-14 z-50 ml-2.5 w-80 rounded-2xl border border-line bg-surface/95 backdrop-blur-xl p-2 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-150"
          >
            {/* Cabeçalho do Dropdown */}
            <div className="flex items-center justify-between border-b border-line pb-2.5 px-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-brand">
                  <Inbox className="size-4" />
                </span>
                <div>
                  <h3 className="font-display text-xs font-bold text-ink tracking-tight">
                    Caixas de entrada
                  </h3>
                  <p className="text-[10px] text-muted">
                    {roleName ? `Perfil: ${roleName}` : 'Acesso por equipe'}
                  </p>
                </div>
              </div>

              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-dim border border-line-soft">
                {accessibleInboxes.length} {accessibleInboxes.length === 1 ? 'caixa' : 'caixas'}
              </span>
            </div>

            {/*
              O atalho "Todas as caixas" saiu daqui.

              Ele levava a `/conversas` sem caixa, e o resultado era uma lista
              com os cinco números da conta embaralhados: uma cobrança ao lado
              de um agendamento, sem nada dizendo de qual número cada conversa
              veio. A caixa passou a ser o recorte da tela, e "todas as
              conversas" agora significa todas as **daquela** caixa — a escolha
              vive na coluna de canais, ao lado da lista.
            */}

            {/* Separador de Seção */}
            <div className="my-1.5 border-t border-line-soft px-2 pt-1.5">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-dim">
                Canais e Equipes Permitidos
              </span>
            </div>

            {/* Lista de Caixas com Acesso */}
            <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
              {accessibleInboxes.length > 0 ? (
                accessibleInboxes.map((inbox) => {
                  const isSelected = currentCaixa === inbox.id;
                  const isOnline =
                    inbox.status === 'conectado' ||
                    inbox.status === 'ativo' ||
                    inbox.status === 'online';

                  return (
                    <Link
                      key={inbox.id}
                      href={`/conversas?caixa=${inbox.id}`}
                      onClick={() => {
                        setCurrentCaixa(inbox.id);
                        setIsOpen(false);
                      }}
                      className={cn(
                        'flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-xs transition-all',
                        isSelected
                          ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                          : 'text-ink hover:bg-surface-2',
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {channelIcon(inbox.channel)}
                        <div className="truncate min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-ink truncate block">
                              {inbox.name}
                            </span>
                            <span
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                isOnline ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-amber-500',
                              )}
                              title={isOnline ? 'Conectado' : 'Aguardando conexão'}
                            />
                          </div>
                          <span className="block text-[10px] text-muted truncate">
                            {inbox.teamName
                              ? `Equipe: ${inbox.teamName}`
                              : isOnline
                                ? inbox.identifier || 'Canal conectado'
                                : 'Aguardando conexão (QR Code)'}
                          </span>
                        </div>
                      </div>

                      {inbox.unreadCount > 0 && (
                        <span className="flex min-w-4 h-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white shrink-0">
                          {inbox.unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-muted">
                  Nenhuma caixa vinculada ao seu usuário ou equipe no momento.
                </div>
              )}
            </div>

            {/* Rodapé de Gestão de Caixas */}
            {canManageInboxes && (
              <div className="mt-1.5 border-t border-line pt-1.5">
                <Link
                  href="/configuracoes?secao=caixas"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="size-3 text-dim" />
                    <span>Gerenciar caixas de entrada</span>
                  </div>
                  <ChevronRight className="size-3 text-dim" />
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
