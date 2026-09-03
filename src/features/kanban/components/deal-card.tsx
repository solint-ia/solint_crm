'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Clock,
  ExternalLink,
  GripVertical,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  User,
} from 'lucide-react';

import type { Deal } from '@/core/domain/pipeline';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/components/domain/presentation-maps';
import { useFormatarMoeda } from '@/components/layout/regional-provider';
import { cn } from '@/lib/cn';

interface DealCardProps {
  readonly deal: Deal;
  readonly stale: boolean;
  readonly dragging: boolean;
  readonly onDragStart: (dealId: string) => void;
  readonly onDragEnd: () => void;
  readonly onOpen: (dealId: string) => void;
  readonly onEdit?: (deal: Deal) => void;
  readonly onDelete?: (dealId: string) => void;
}

const SOURCE_ICONS: Readonly<Record<string, { label: string; tone: string }>> = {
  whatsapp: { label: 'WhatsApp', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  instagram: { label: 'Instagram', tone: 'bg-pink-500/10 text-pink-600 dark:text-pink-400' },
  site: { label: 'Website', tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  indicacao: { label: 'Indicação', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  google: { label: 'Google Ads', tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' },
  inbound: { label: 'Formulário', tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  outbound: { label: 'Outbound', tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
};

export function DealCard({
  deal,
  stale,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onEdit,
  onDelete,
}: DealCardProps) {
  const formatarMoeda = useFormatarMoeda();
  const [showMenu, setShowMenu] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  const sourceInfo = deal.source ? SOURCE_ICONS[deal.source] : null;

  return (
    <li className="group/card relative">
      <article
        draggable
        onDragStart={() => onDragStart(deal.id)}
        onDragEnd={onDragEnd}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(deal.id);
          }
        }}
        onClick={() => onOpen(deal.id)}
        className={cn(
          'relative flex flex-col rounded-lg border border-line bg-surface p-3 shadow-2xs transition-all duration-150',
          'hover:border-brand/40 hover:shadow-md cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-brand/20',
          dragging && 'opacity-40 scale-[0.97] ring-2 ring-brand/50 shadow-lg',
          stale && 'border-amber-500/40 bg-amber-50/20 dark:bg-amber-950/10',
        )}
      >
        {/* Cabeçalho do Card: Handle + Origem + Prioridade + Menu 3 pontos */}
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-dim/50 group-hover/card:text-dim transition-colors -ml-0.5 cursor-grab"
              title="Arraste para mover"
            >
              <GripVertical className="size-3.5" />
            </span>

            {sourceInfo && (
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-semibold tracking-tight uppercase',
                  sourceInfo.tone,
                )}
              >
                {sourceInfo.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Badge tone={PRIORITY_TONE[deal.priority]} className="text-[10px] py-0 px-1.5">
              {PRIORITY_LABEL[deal.priority]}
            </Badge>

            {/* Menu de Ações Rápidas (3 pontos) */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label="Opções da oportunidade"
                onClick={() => setShowMenu((v) => !v)}
                className="opacity-0 group-hover/card:opacity-100 rounded p-1 text-dim hover:bg-surface-2 hover:text-ink transition-opacity"
              >
                <MoreHorizontal className="size-3.5" />
              </button>

              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setShowMenu(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 top-full z-30 mt-1 w-38 rounded-float border border-line bg-surface p-1 shadow-lg text-body text-ink">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        onOpen(deal.id);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2"
                    >
                      <ExternalLink className="size-3.5 text-dim" />
                      <span>Ver detalhes</span>
                    </button>

                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          onEdit(deal);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2"
                      >
                        <Pencil className="size-3.5 text-dim" />
                        <span>Editar</span>
                      </button>
                    )}

                    {deal.conversationId && (
                      <Link
                        href="/conversas"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2 text-emerald-600 dark:text-emerald-400"
                      >
                        <MessageCircle className="size-3.5" />
                        <span>WhatsApp</span>
                      </Link>
                    )}

                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          setIsConfirmDeleteOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-soft/50"
                      >
                        <Trash2 className="size-3.5" />
                        <span>Excluir</span>
                      </button>
                    )}
                  </div>
                </>
              )}

            </div>
          </div>
        </div>

        {/* Título da Oportunidade */}
        <h3 className="font-display text-body font-semibold text-ink leading-snug line-clamp-2 tracking-tight group-hover/card:text-brand transition-colors">
          {deal.title ?? deal.contactName}
        </h3>

        {/* Contato e Empresa */}
        <div className="mt-1 flex flex-col gap-0.5 text-meta text-muted">
          <div className="flex items-center gap-1 truncate">
            <User className="size-3 shrink-0 text-dim" />
            <span className="truncate font-medium">{deal.contactName}</span>
          </div>

          {deal.company && (
            <div className="flex items-center gap-1 truncate text-dim">
              <Building2 className="size-3 shrink-0" />
              <span className="truncate">{deal.company}</span>
            </div>
          )}
        </div>

        {/* Valor Estimado */}
        <div className="mt-2.5 border-t border-line-soft pt-2">
          <span className="block text-[10px] font-medium uppercase text-dim">Valor Estimado</span>
          <span className="font-display text-title font-bold text-ink tracking-tight tabular-nums">
            {formatarMoeda(deal.amountInCents)}
          </span>
        </div>

        {/* Próxima Ação */}
        {deal.nextAction && deal.nextAction !== '—' && (
          <div className="mt-2 rounded bg-surface-2 px-2 py-1 text-meta text-muted flex items-start gap-1.5 line-clamp-1">
            <Calendar className="size-3 shrink-0 text-brand mt-0.5" />
            <span className="truncate">{deal.nextAction}</span>
          </div>
        )}

        {/* Rodapé: Responsável + Idade na Etapa / Alerta */}
        <footer className="mt-2.5 flex items-center justify-between pt-1 text-meta text-dim">
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar name={deal.ownerName} size="xs" />
            <span className="truncate text-micro font-medium text-muted">{deal.ownerName}</span>
          </div>

          <div
            className={cn(
              'flex items-center gap-1 font-mono text-[10px] tabular-nums',
              stale ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-dim',
            )}
            title={stale ? 'Oportunidade estagnada nesta etapa' : 'Tempo na etapa'}
          >
            {stale ? (
              <AlertTriangle className="size-3 shrink-0 text-amber-500" />
            ) : (
              <Clock className="size-3 shrink-0" />
            )}
            <span>{deal.stageAgeLabel}</span>
          </div>
        </footer>

        {/* Barra de Ações Rápidas no Hover (Inferior) */}
        <div
          className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 opacity-0 group-hover/card:opacity-100 group-hover/card:-bottom-3.5 transition-all duration-150 pointer-events-none group-hover/card:pointer-events-auto z-10 hidden sm:flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onOpen(deal.id)}
            title="Abrir detalhes da oportunidade"
            className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-brand transition-colors"
          >
            <ExternalLink className="size-3" />
          </button>

          {deal.conversationId && (
            <Link
              href="/conversas"
              title="Abrir WhatsApp"
              className="rounded-full p-1 text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              <MessageCircle className="size-3" />
            </Link>
          )}

          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(deal)}
              title="Editar oportunidade"
              className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-ink transition-colors"
            >
              <Pencil className="size-3" />
            </button>
          )}
        </div>
      </article>

      {/* Modal de Confirmação de Exclusão da Oportunidade */}
      {onDelete && (
        <ConfirmModal
          open={isConfirmDeleteOpen}
          title="Excluir oportunidade"
          description={
            <span>
              Tem certeza que deseja excluir a oportunidade{' '}
              <strong className="text-ink">&ldquo;{deal.title ?? deal.contactName}&rdquo;</strong>? Ela será removida permanentemente do funil.

            </span>
          }
          confirmLabel="Excluir oportunidade"
          variant="danger"
          onClose={() => setIsConfirmDeleteOpen(false)}
          onConfirm={() => {
            onDelete(deal.id);
            setIsConfirmDeleteOpen(false);
          }}
        />
      )}
    </li>
  );
}

