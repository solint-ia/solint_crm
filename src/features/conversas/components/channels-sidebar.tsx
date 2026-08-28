'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  Inbox as InboxIcon,
  MailOpen,
  MessagesSquare,
  Settings2,
  UserRound,
  UserRoundX,
} from 'lucide-react';
import { ChannelDot } from '@/components/domain/channel-badge';
import { cn } from '@/lib/cn';
import type { InboxScope } from '@/core/domain/conversation';
import type { StatusTab } from '../hooks/use-inbox';

export interface SidebarInbox {
  readonly id: string;
  readonly name: string;
  readonly channel: string;
  readonly status: string;
}

/**
 * Coluna de canais da caixa de entrada.
 *
 * As caixas moravam num menu suspenso do rail: para saber quantas existiam era
 * preciso abrir, e para trocar de caixa, abrir de novo. Numa conta com cinco
 * números — Principal, Cobrança, Oral Plus — isso é a navegação principal do
 * atendimento escondida atrás de um clique.
 *
 * Aqui elas ficam listadas, sempre visíveis, com o não lidas de cada uma ao
 * lado. É o mesmo desenho do Chatwoot, e pela mesma razão: quem atende passa o
 * dia trocando de canal.
 *
 * **A caixa é o recorte, não um filtro.** Selecionar um canal muda o universo
 * inteiro da tela — as abas, as contagens e a lista passam a falar só dele.
 * Não há "todas as caixas": misturar cinco números numa lista só apagava
 * exatamente a informação que separa um atendimento de cobrança de um de
 * agendamento.
 */
export function ChannelsSidebar({
  inboxes,
  selectedInboxId,
  onSelectInbox,
  counts,
  scope,
  onSelectScope,
  statusTab,
  onSelectStatus,
  unreadOnly,
  onToggleUnread,
  unreadByInbox,
  canManageInboxes,
}: {
  readonly inboxes: readonly SidebarInbox[];
  readonly selectedInboxId?: string;
  readonly onSelectInbox: (inboxId: string) => void;
  readonly counts: {
    readonly minhas: number;
    readonly nao_atribuidas: number;
    readonly todas: number;
    readonly naoLidas: number;
  };
  readonly scope: InboxScope;
  readonly onSelectScope: (scope: InboxScope) => void;
  readonly statusTab: StatusTab;
  readonly onSelectStatus: (tab: StatusTab) => void;
  readonly unreadOnly: boolean;
  readonly onToggleUnread: (only: boolean) => void;
  readonly unreadByInbox: ReadonlyMap<string, number>;
  readonly canManageInboxes: boolean;
}) {
  const [canaisAbertos, setCanaisAbertos] = useState(true);
  const [conversasAbertas, setConversasAbertas] = useState(true);

  /**
   * "Todas as conversas" é o estado sem nenhum estreitamento.
   *
   * Ele não some com a caixa escolhida — é justamente o oposto: significa tudo
   * o que existe **dentro** dela. Era esse o pedido, e era esse o defeito: o
   * botão limpava a caixa junto e devolvia a lista misturada de todos os
   * números.
   */
  const semEstreitamento = scope === 'todas' && statusTab === 'todas' && !unreadOnly;

  const verTudo = () => {
    onSelectScope('todas');
    onSelectStatus('todas');
    onToggleUnread(false);
  };

  return (
    <nav
      aria-label="Canais e filtros"
      className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface-2/40 px-2 py-3 xl:flex"
    >
      <SecaoTitulo
        icon={<MessagesSquare className="size-3.5" />}
        label="Conversas"
        aberta={conversasAbertas}
        onToggle={() => setConversasAbertas((atual) => !atual)}
      />

      {conversasAbertas ? (
        <div className="mb-2 flex flex-col gap-0.5 border-l border-line-soft pl-2">
          <ItemLateral
            label="Todas as conversas"
            count={counts.todas}
            active={semEstreitamento}
            onClick={verTudo}
          />
          <ItemLateral
            label="Atribuídas a mim"
            icon={<UserRound className="size-3.5" />}
            count={counts.minhas}
            active={scope === 'minhas'}
            onClick={() => onSelectScope('minhas')}
          />
          <ItemLateral
            label="Não atendidas"
            icon={<UserRoundX className="size-3.5" />}
            count={counts.nao_atribuidas}
            active={scope === 'nao_atribuidas'}
            onClick={() => onSelectScope('nao_atribuidas')}
          />
          <ItemLateral
            label="Não lidas"
            icon={<MailOpen className="size-3.5" />}
            count={counts.naoLidas}
            active={unreadOnly}
            onClick={() => onToggleUnread(!unreadOnly)}
          />
        </div>
      ) : null}

      <SecaoTitulo
        icon={<InboxIcon className="size-3.5" />}
        label="Canais"
        aberta={canaisAbertos}
        onToggle={() => setCanaisAbertos((atual) => !atual)}
      />

      {canaisAbertos ? (
        <div className="flex flex-col gap-0.5 border-l border-line-soft pl-2">
          {inboxes.map((inbox) => (
            <ItemLateral
              key={inbox.id}
              label={inbox.name}
              icon={<ChannelDot channel={inbox.channel as never} />}
              count={unreadByInbox.get(inbox.id) ?? 0}
              // Um canal desconectado ainda mostra o histórico; o ponto âmbar
              // avisa que nada novo vai chegar por ele enquanto estiver assim.
              warn={inbox.status !== 'conectado'}
              active={inbox.id === selectedInboxId}
              onClick={() => onSelectInbox(inbox.id)}
            />
          ))}

          {inboxes.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-dim">
              Nenhum canal disponível para você.
            </p>
          ) : null}

          {canManageInboxes ? (
            <Link
              href="/configuracoes"
              className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Settings2 className="size-3.5" />
              <span>Gerenciar canais</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

function SecaoTitulo({
  icon,
  label,
  aberta,
  onToggle,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly aberta: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={aberta}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim transition-colors hover:text-ink"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown className={cn('size-3.5 transition-transform', !aberta && '-rotate-90')} />
    </button>
  );
}

function ItemLateral({
  label,
  icon,
  count,
  active,
  warn = false,
  onClick,
}: {
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly count: number;
  readonly active: boolean;
  readonly warn?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      title={label}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
        active
          ? 'bg-brand/12 font-semibold text-brand'
          : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {icon ? <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>

      {warn ? (
        <span
          title="Canal desconectado"
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
          aria-label="Canal desconectado"
        />
      ) : null}

      {count > 0 ? (
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums',
            active ? 'bg-brand/20 text-brand' : 'bg-surface-2 text-muted',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  );
}
