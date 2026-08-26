'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  MoreVertical,
  PanelRight,
  PanelRightClose,
  PauseCircle,
  PlugZap,
  UserCheck,
  Users,
} from 'lucide-react';
import type { Conversation, ConversationStatus, Priority } from '@/core/domain/conversation';
import { isHsmWindowOpen } from '@/core/domain/conversation';
import { isGroupContact, PhoneNumber } from '@/core/domain/contact';
import type { Label } from '@/core/domain/label';
import type { CannedResponse } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Menu, MenuHeader, MenuItem } from '@/components/ui/menu';
import { ChannelBadge } from '@/components/domain/channel-badge';
import { StatusBadge } from '@/components/domain/status-badge';
import { Composer, type ComposerMode, type MediaResult } from './composer';
import {
  AssigneeButton,
  InboxMenu,
  LabelMenu,
  PriorityMenu,
  type InboxCatalog,
} from './conversation-toolbar';
import { MessageBubble } from './message-bubble';
import { TemplatePicker } from './template-picker';
import { TransferModal } from './transfer-modal';
import { cn } from '@/lib/cn';

interface ChatPanelProps {
  readonly conversation: Conversation;
  readonly pending: boolean;
  readonly currentUserId: string;
  readonly catalog: InboxCatalog;
  readonly cannedResponses: readonly CannedResponse[];
  readonly onSend: (text: string, mode: ComposerMode) => void;
  readonly onSendMedia: (form: FormData) => Promise<MediaResult>;
  readonly onSendTemplate: (templateId: string, values: readonly string[]) => void;
  readonly onChangeStatus: (status: ConversationStatus) => void;
  readonly onAssign: (assignee: { id: string; name: string } | null) => void;
  readonly onChangePriority: (priority: Priority) => void;
  readonly onSetLabels: (labels: readonly Label[]) => void;
  readonly inboxes: readonly { readonly id: string; readonly name: string }[];
  readonly onMoveInbox: (inboxId: string) => void;
  readonly onBack?: () => void;
  readonly isContextOpen?: boolean;
  readonly onToggleContext?: () => void;
}

export function ChatPanel({
  conversation,
  pending,
  currentUserId,
  catalog,
  cannedResponses,
  onSend,
  onSendMedia,
  onSendTemplate,
  onChangeStatus,
  onAssign,
  onChangePriority,
  onSetLabels,
  inboxes,
  onMoveInbox,
  onBack,
  isContextOpen = false,
  onToggleContext,
}: ChatPanelProps) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const hsmOpen = isHsmWindowOpen(conversation);
  const isGroup = isGroupContact(conversation.contact);

  const identity = isGroup
    ? `${conversation.contact.participantCount ?? 0} participantes`
    : PhoneNumber.format(conversation.contact.phone) || 'Sem telefone';

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-chat h-full overflow-hidden">
      {/* ---------- Cabeçalho Fixo da Conversa ---------- */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 sm:px-4 py-2 z-10 shadow-xs">
        {/* Lado Esquerdo: Identificação do Contato (Truncamento Seguro) */}
        <div className="flex items-center gap-2.5 min-w-0 max-w-[48%] sm:max-w-[58%]">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar para a lista de conversas"
              className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}

          {/* Avatar e Nome Clicáveis para abrir detalhes */}
          <button
            type="button"
            onClick={onToggleContext}
            title={isContextOpen ? 'Recolher detalhes do contato' : 'Ver detalhes do contato'}
            className="group flex items-center gap-2.5 text-left min-w-0 rounded-lg p-1 -m-1 transition-colors hover:bg-surface-2"
          >
            <div className="relative shrink-0">
              <Avatar
                name={conversation.contact.name}
                tone={conversation.contact.avatarTone}
                src={conversation.contact.avatarUrl}
                size="md"
              />
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="truncate font-display text-xs sm:text-sm font-semibold text-ink group-hover:text-brand transition-colors">
                  {conversation.contact.name}
                </h2>
                <ChannelBadge channel={conversation.channel} />
                {isGroup && (
                  <span className="flex items-center gap-1 rounded-md bg-surface-2 border border-line-soft px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    <Users className="size-3" />
                    Grupo
                  </span>
                )}
              </div>
              <p className="truncate font-mono text-[11px] text-muted leading-tight mt-0.5">
                {identity} · {conversation.queue}
              </p>
            </div>
          </button>
        </div>

        {/* Lado Direito: Ações do Atendimento */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Se o painel de contexto estiver FECHADO e houver espaço, exibe a barra completa */}
          {!isContextOpen ? (
            <>
              <div className="hidden 2xl:flex items-center gap-1.5">
                <StatusBadge status={conversation.status} />
                <PriorityMenu conversation={conversation} onChange={onChangePriority} />
                <LabelMenu
                  conversation={conversation}
                  labels={catalog.labels}
                  onChange={onSetLabels}
                />
                <InboxMenu conversation={conversation} inboxes={inboxes} onMove={onMoveInbox} />
              </div>

              <div className="hidden lg:inline-flex">
                <AssigneeButton conversation={conversation} onOpen={() => setTransferOpen(true)} />
              </div>

              <button
                type="button"
                onClick={() => onChangeStatus('espera')}
                disabled={conversation.status === 'espera'}
                title="Colocar atendimento em espera"
                className={cn(
                  'hidden md:inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition-all hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed',
                  conversation.status === 'espera' && 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300 font-semibold',
                )}
              >
                <PauseCircle className="size-3.5 text-amber-500" />
                <span>Em espera</span>
              </button>

              <button
                type="button"
                onClick={() => onChangeStatus('pendente')}
                disabled={conversation.status === 'pendente'}
                title="Marcar como pendente"
                className={cn(
                  'hidden md:inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition-all hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed',
                  conversation.status === 'pendente' && 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300 font-semibold',
                )}
              >
                <Clock className="size-3.5 text-sky-500" />
                <span>Pendente</span>
              </button>

              {/* Menu de Mais Ações em Telas Médias */}
              <div className="2xl:hidden">
                <Menu
                  label="Mais ações da conversa"
                  trigger={
                    <span className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink transition-colors">
                      <MoreVertical className="size-4" />
                    </span>
                  }
                >
                  {(close) => (
                    <>
                      <MenuHeader>Status & Responsável</MenuHeader>
                      <MenuItem
                        onClick={() => {
                          onChangeStatus('espera');
                          close();
                        }}
                      >
                        <PauseCircle className="size-3.5 text-amber-500" />
                        <span>Colocar em espera</span>
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          onChangeStatus('pendente');
                          close();
                        }}
                      >
                        <Clock className="size-3.5 text-sky-500" />
                        <span>Marcar como pendente</span>
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          setTransferOpen(true);
                          close();
                        }}
                      >
                        <UserCheck className="size-3.5 text-brand" />
                        <span>Transferir responsável</span>
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            </>
          ) : (
            /* Quando o painel de contexto está ABERTO: Menu compacto para evitar sobreposição */
            <div className="flex items-center gap-1.5">
              <Menu
                label="Mais opções da conversa"
                trigger={
                  <span className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink transition-colors">
                    <MoreVertical className="size-4" />
                  </span>
                }
              >
                {(close) => (
                  <>
                    <MenuHeader>Ações Rápidas</MenuHeader>
                    <MenuItem
                      onClick={() => {
                        onChangeStatus('espera');
                        close();
                      }}
                    >
                      <PauseCircle className="size-3.5 text-amber-500" />
                      <span>Colocar em espera</span>
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        onChangeStatus('pendente');
                        close();
                      }}
                    >
                      <Clock className="size-3.5 text-sky-500" />
                      <span>Marcar como pendente</span>
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setTransferOpen(true);
                        close();
                      }}
                    >
                      <UserCheck className="size-3.5 text-brand" />
                      <span>Transferir responsável</span>
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          )}

          {/* Ação Principal: Finalizar Atendimento */}
          <button
            type="button"
            onClick={() => onChangeStatus('resolvida')}
            disabled={conversation.status === 'resolvida'}
            title="Finalizar e resolver atendimento"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-white shadow-xs shadow-emerald-600/25 transition-all hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">Finalizar atendimento</span>
            <span className="sm:hidden">Finalizar</span>
          </button>

          {/* Botão de Alternar Barra Lateral de Detalhes */}
          {onToggleContext && (
            <button
              type="button"
              onClick={onToggleContext}
              aria-label={isContextOpen ? 'Recolher detalhes do contato' : 'Abrir detalhes do contato'}
              title={isContextOpen ? 'Recolher detalhes (painel lateral)' : 'Abrir detalhes (painel lateral)'}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all',
                isContextOpen
                  ? 'border-brand/40 bg-brand/12 text-brand shadow-xs'
                  : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {isContextOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRight className="size-4" />
              )}
            </button>
          )}
        </div>
      </header>

      {/* Alertas contextuais */}
      {conversation.channelOffline && (
        <div className="flex items-center gap-2 bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs text-red-600 dark:text-red-300">
          <PlugZap className="size-3.5 shrink-0 text-red-500" />
          <span>Canal desconectado: as mensagens não serão entregues até a reconexão.</span>
          <Link
            href="/configuracoes?secao=integracoes"
            className="ml-auto font-semibold text-red-600 dark:text-red-200 underline hover:no-underline"
          >
            Reconectar
          </Link>
        </div>
      )}

      {conversation.collisionAgent && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Eye className="size-3.5 shrink-0 text-amber-500" />
          <span>{conversation.collisionAgent} também está visualizando esta conversa.</span>
        </div>
      )}

      {/* ---------- Stream de Mensagens ---------- */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
        {conversation.timeline.map((item) =>
          item.kind === 'divider' ? (
            <div key={`divider-${item.label}`} className="my-3 flex items-center justify-center">
              <span className="rounded-full border border-line bg-surface/80 px-3 py-0.5 text-[11px] font-medium text-muted backdrop-blur-xs">
                {item.label}
              </span>
            </div>
          ) : (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              showAuthorName={isGroup}
            />
          ),
        )}

        {conversation.isTyping && (
          <p className="text-xs text-brand animate-pulse font-medium">
            {conversation.contact.name} está digitando...
          </p>
        )}
      </div>

      {/* Aviso de Janela de 24h Meta/HSM */}
      {!hsmOpen && conversation.channel === 'whatsapp' && (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
          <span>Janela de 24h do WhatsApp encerrada. Use um template aprovado para reabrir.</span>
          <button
            type="button"
            onClick={() => setTemplateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-500 transition-colors"
          >
            <FileCheck2 className="size-3.5" />
            <span>Enviar template</span>
          </button>
        </div>
      )}

      {/* ---------- Compositor de Mensagens Fixo na Base ---------- */}
      <div className="shrink-0 border-t border-line bg-surface p-3 md:p-4">
        <Composer
          disabledReason={
            !hsmOpen && conversation.channel === 'whatsapp'
              ? 'Janela de 24h encerrada. Envie um template para falar com o contato.'
              : undefined
          }
          onSend={onSend}
          onSendMedia={onSendMedia}
          cannedResponses={cannedResponses}
          pending={pending}
        />
      </div>

      {/* Modais auxiliares */}
      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        conversation={conversation}
        members={catalog.members}
        currentUserId={currentUserId}
        onAssign={onAssign}
      />

      <TemplatePicker
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        contactName={conversation.contact.name}
        templates={catalog.templates}
        onSend={(templateId, values) => {
          onSendTemplate(templateId, values);
          setTemplateOpen(false);
        }}
      />
    </section>
  );
}
