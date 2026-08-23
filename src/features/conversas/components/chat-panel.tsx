'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, FileCheck2, PanelRight, PlugZap, Users } from 'lucide-react';
import type { Conversation, ConversationStatus, Priority } from '@/core/domain/conversation';
import { isHsmWindowOpen } from '@/core/domain/conversation';
import { isGroupContact, PhoneNumber } from '@/core/domain/contact';
import type { Label } from '@/core/domain/label';
import type { CannedResponse } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ChannelBadge } from '@/components/domain/channel-badge';
import { StatusBadge } from '@/components/domain/status-badge';
import { Composer, type ComposerMode, type MediaResult } from './composer';
import {
  AssigneeButton,
  LabelMenu,
  PriorityMenu,
  type InboxCatalog,
} from './conversation-toolbar';
import { MessageBubble } from './message-bubble';
import { TemplatePicker } from './template-picker';
import { TransferModal } from './transfer-modal';

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
  /** Só no celular: volta para a lista de conversas. */
  readonly onBack?: () => void;
  /** Só no celular: abre o painel de contexto como tela cheia. */
  readonly onOpenContext?: () => void;
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
  onBack,
  onOpenContext,
}: ChatPanelProps) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const hsmOpen = isHsmWindowOpen(conversation);
  const isGroup = isGroupContact(conversation.contact);
  // Um grupo não tem telefone proprio — mostrar "+" seguido do id interno mentiria.
  const identity = isGroup
    ? `${conversation.contact.participantCount ?? 0} participantes`
    : PhoneNumber.format(conversation.contact.phone) || 'Sem telefone';

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-chat">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2.5 md:px-4 md:py-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para a lista de conversas"
            className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}

        <Avatar
          name={conversation.contact.name}
          tone={conversation.contact.avatarTone}
          src={conversation.contact.avatarUrl}
          size="md"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-ui font-semibold text-ink">
              {conversation.contact.name}
            </h2>
            <ChannelBadge channel={conversation.channel} />
            {isGroup ? (
              <span className="flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-micro font-semibold text-muted">
                <Users className="size-3" />
                Grupo
              </span>
            ) : null}
          </div>
          <p className="truncate font-mono text-meta text-muted">
            {identity} · {conversation.queue} · {conversation.assigneeName ?? 'Não atribuída'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Abaixo de `xl` os controles secundarios saem: numa faixa estreita
              eles espremeriam o nome do contato ate' virar reticencias. */}
          <span className="hidden items-center gap-1.5 xl:flex">
            <StatusBadge status={conversation.status} />
            <PriorityMenu conversation={conversation} onChange={onChangePriority} />
            <LabelMenu
              conversation={conversation}
              labels={catalog.labels}
              onChange={onSetLabels}
            />
          </span>
          <span className="hidden md:inline-flex">
            <AssigneeButton conversation={conversation} onOpen={() => setTransferOpen(true)} />
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => onChangeStatus('espera')}
            disabled={conversation.status === 'espera'}
            title="Aguardando uma ação interna, não o cliente"
          >
            Em espera
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => onChangeStatus('pendente')}
            disabled={conversation.status === 'pendente'}
          >
            Pendente
          </Button>
          <Button
            size="sm"
            onClick={() => onChangeStatus('resolvida')}
            disabled={conversation.status === 'resolvida'}
          >
            <span className="hidden sm:inline">Finalizar atendimento</span>
            <span className="sm:hidden">Finalizar</span>
          </Button>

          {onOpenContext ? (
            <button
              type="button"
              onClick={onOpenContext}
              aria-label="Abrir detalhes do contato"
              className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-ink xl:hidden"
            >
              <PanelRight className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      {conversation.channelOffline ? (
        <Banner tone="danger" icon={<PlugZap className="size-3.5" />}>
          Canal desconectado: as mensagens não serão entregues até a reconexão.
          <Link
            href="/configuracoes?secao=integracoes"
            className="ml-1 font-semibold underline hover:no-underline"
          >
            Reconectar
          </Link>
        </Banner>
      ) : null}

      {conversation.collisionAgent ? (
        <Banner tone="warning" icon={<Eye className="size-3.5" />}>
          {conversation.collisionAgent} também está visualizando esta conversa.
        </Banner>
      ) : null}

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-4 md:px-5">
        {conversation.timeline.map((item) =>
          item.kind === 'divider' ? (
            <div key={`divider-${item.label}`} className="my-2 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-meta font-semibold text-dim">{item.label}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              showAuthorName={isGroup}
            />
          ),
        )}

        {conversation.isTyping ? (
          <p className="text-meta text-muted">
            {conversation.contact.name.split(' ')[0]} está digitando...
          </p>
        ) : null}

        {conversation.timeline.length === 0 ? (
          <p className="my-auto text-center text-body text-dim">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        ) : null}
      </div>

      {/* A janela fechada deixou de ser um beco: o botão é a saída que o texto promete. */}
      {!hsmOpen ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-note-line bg-note px-4 py-2.5">
          <p className="min-w-0 flex-1 text-meta leading-relaxed text-note-text">
            Passaram-se mais de 24h desde a última mensagem de{' '}
            {conversation.contact.name.split(' ')[0]}. Só um template aprovado reabre a conversa.
          </p>
          <Button
            size="sm"
            icon={<FileCheck2 className="size-3.5" />}
            onClick={() => setTemplateOpen(true)}
          >
            Escolher template
          </Button>
        </div>
      ) : null}

      <Composer
        pending={pending}
        onSend={onSend}
        onSendMedia={onSendMedia}
        cannedResponses={cannedResponses}
        disabledReason={
          hsmOpen
            ? undefined
            : 'Janela de 24h encerrada. Envie um template aprovado para reabrir a conversa ou registre uma nota interna.'
        }
      />

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        conversation={conversation}
        members={catalog.members}
        currentUserId={currentUserId}
        onAssign={onAssign}
      />

      {templateOpen ? (
        <TemplatePicker
          open
          onClose={() => setTemplateOpen(false)}
          templates={catalog.templates}
          contactName={conversation.contact.name}
          pending={pending}
          onSend={(templateId, values) => {
            onSendTemplate(templateId, values);
            setTemplateOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  readonly tone: 'danger' | 'warning';
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const classes =
    tone === 'danger'
      ? 'border-red-line bg-red-soft text-red-text'
      : 'border-note-line bg-note text-note-text';
  return (
    <p
      className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-meta ${classes}`}
      role="status"
    >
      {icon}
      {children}
    </p>
  );
}
