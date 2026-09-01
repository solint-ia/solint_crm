'use client';

import { Check, ChevronDown, Inbox, Tag, UserPlus } from 'lucide-react';
import type { WhatsAppTemplate } from '@/core/domain/campaign';
import type { Conversation, Priority } from '@/core/domain/conversation';
import { PRIORITIES } from '@/core/domain/conversation';
import type { Label } from '@/core/domain/label';
import type { User } from '@/core/domain/user';
import { Menu, MenuHeader, MenuItem } from '@/components/ui/menu';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/components/domain/presentation-maps';
import { isHexColor, TONE_DOT_CLASSES } from '@/components/ui/tone';
import { cn } from '@/lib/cn';

export interface InboxCatalog {
  readonly members: readonly User[];
  readonly labels: readonly Label[];
  readonly templates: readonly WhatsAppTemplate[];
}

/**
 * Seletor de prioridade.
 *
 * A prioridade era só um selo de leitura, embora `changePriority` já existisse
 * no repositório. Continua parecendo um selo — mas agora abre.
 */
export function PriorityMenu({
  conversation,
  onChange,
}: {
  readonly conversation: Conversation;
  readonly onChange: (priority: Priority) => void;
}) {
  const tone = PRIORITY_TONE[conversation.priority];

  return (
    <Menu
      label={`Prioridade: ${PRIORITY_LABEL[conversation.priority]}`}
      trigger={
        <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-ink transition-all hover:bg-surface hover:shadow-2xs">
          <span className={cn('size-1.5 rounded-full', TONE_DOT_CLASSES[tone])} />
          {PRIORITY_LABEL[conversation.priority]}
          <ChevronDown className="size-3 text-dim" />
        </span>
      }
    >
      {(close) => (
        <>
          <MenuHeader>Prioridade</MenuHeader>
          {PRIORITIES.map((priority) => (
            <MenuItem
              key={priority}
              selected={priority === conversation.priority}
              onClick={() => {
                onChange(priority);
                close();
              }}
            >
              <span
                className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT_CLASSES[PRIORITY_TONE[priority]])}
              />
              {PRIORITY_LABEL[priority]}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

/**
 * Aplicar etiquetas.
 *
 * Não fecha a cada clique: etiquetar costuma ser marcar duas ou três de uma vez,
 * e um painel que se fecha sozinho obrigaria a reabrir a cada escolha.
 */
export function LabelMenu({
  conversation,
  labels,
  onChange,
}: {
  readonly conversation: Conversation;
  readonly labels: readonly Label[];
  readonly onChange: (labels: readonly Label[]) => void;
}) {
  const applied = new Set(conversation.labels.map((label) => label.id));

  const toggle = (label: Label) => {
    const next = applied.has(label.id)
      ? conversation.labels.filter((item) => item.id !== label.id)
      : [...conversation.labels, label];
    onChange(next);
  };

  return (
    <Menu
      label="Aplicar etiquetas"
      panelClassName="w-64"
      trigger={
        <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-ink transition-all hover:bg-surface hover:shadow-2xs">
          <Tag className="size-3 text-dim" />
          {conversation.labels.length > 0 ? (
            <span className="flex items-center gap-1">
              <span>Etiquetas</span>
              <span className="rounded-full bg-brand/15 text-brand px-1 py-0.2 text-[10px] font-bold">
                {conversation.labels.length}
              </span>
            </span>
          ) : (
            'Etiquetas'
          )}
          <ChevronDown className="size-3 text-dim" />
        </span>
      }
    >
      {() => (
        <>
          <MenuHeader>Etiquetas da conversa</MenuHeader>
          <div className="max-h-64 overflow-y-auto">
            {labels.map((label) => {
              const active = applied.has(label.id);
              const isHex = isHexColor(label.tone);
              return (
                <MenuItem key={label.id} selected={active} onClick={() => toggle(label)}>
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', !isHex && TONE_DOT_CLASSES[label.tone])}
                    style={isHex ? { backgroundColor: label.tone } : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                  {active ? <Check className="size-3 shrink-0 text-brand" /> : null}
                </MenuItem>
              );
            })}
            {labels.length === 0 ? (
              <p className="px-3 py-4 text-center text-meta text-dim">
                Nenhuma etiqueta cadastrada nesta conta.
              </p>
            ) : null}
          </div>
        </>
      )}
    </Menu>
  );
}

/** Atalho de transferência que também mostra quem está com a conversa. */
export function AssigneeButton({
  conversation,
  onOpen,
}: {
  readonly conversation: Conversation;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Transferir responsável"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-ink transition-all hover:bg-surface hover:shadow-2xs"
    >
      <UserPlus className="size-3 text-dim" />
      <span className="max-w-28 truncate">
        {conversation.assigneeName ?? 'Sem responsável'}
      </span>
    </button>
  );
}

/**
 * Mover o atendimento para outra caixa de entrada.
 *
 * Aparece só quando há mais de uma caixa ao alcance — com uma só, o menu seria
 * uma escolha sem alternativa. Quando a pessoa responsável não atende a caixa
 * de destino, o servidor a desatribui, e o aviso abaixo diz isso antes de o
 * clique acontecer: uma conversa que perde o dono sem explicação vira suporte
 * no dia seguinte.
 */
export function InboxMenu({
  conversation,
  inboxes,
  onMove,
}: {
  readonly conversation: Conversation;
  readonly inboxes: readonly { readonly id: string; readonly name: string }[];
  readonly onMove: (inboxId: string) => void;
}) {
  if (inboxes.length < 2) return null;

  const atual = inboxes.find((inbox) => inbox.id === conversation.inboxId);

  return (
    <Menu
      label={`Caixa: ${atual?.name ?? 'atual'}`}
      trigger={
        <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-ink transition-all hover:bg-surface hover:shadow-2xs">
          <Inbox className="size-3 text-dim" />
          <span className="max-w-24 truncate">{atual?.name ?? 'Caixa'}</span>
          <ChevronDown className="size-3 text-dim" />
        </span>
      }
    >
      {(close) => (
        <>
          <MenuHeader>Mover para a caixa</MenuHeader>
          {inboxes.map((inbox) => (
            <MenuItem
              key={inbox.id}
              selected={inbox.id === conversation.inboxId}
              onClick={() => {
                if (inbox.id !== conversation.inboxId) onMove(inbox.id);
                close();
              }}
            >
              {inbox.name}
            </MenuItem>
          ))}
          {conversation.assigneeName ? (
            <div className="border-t border-line-soft px-3 py-2 text-meta text-muted">
              {conversation.assigneeName} deixa de ser responsável se não atender a caixa de
              destino.
            </div>
          ) : null}
        </>
      )}
    </Menu>
  );
}
