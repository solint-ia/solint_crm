'use client';

import { useState } from 'react';
import {
  Ban,
  Download,
  FileText,
  Lock,
  Maximize2,
  Mic,
  Music,
  Plus,
  Reply,
  Smartphone,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import {
  groupReactions,
  previewOfMessage,
  type Message,
  type MessageContent,
} from '@/core/domain/message';
import { WaText } from '@/components/domain/wa-text';
import { EmojiPicker, QUICK_REACTIONS } from '@/components/ui/emoji-picker';
import { MediaLightbox, type LightboxMedia } from '@/components/ui/media-lightbox';
import { cn } from '@/lib/cn';
import { horaDaMensagem } from '@/lib/datetime';
import { DeliveryTicks } from './delivery-ticks';

const AUDIO_LABEL = 'Mensagem de áudio';

interface MessageBubbleProps {
  readonly message: Message;
  readonly showAuthorName?: boolean;
  readonly onResend?: (messageId: string) => void;
  /** Mensagem citada por esta, já resolvida pela timeline. */
  readonly quoted?: Message;
  readonly onReply?: (message: Message) => void;
  readonly onDelete?: (message: Message) => void;
  /**
   * Reage à mensagem. `emoji` vazio retira a reação de quem está olhando — é a
   * mesma chamada, porque é assim que o WhatsApp representa a remoção.
   */
  readonly onReact?: (message: Message, emoji: string) => void;
}

const isFrameless = (content: MessageContent): boolean =>
  content.type === 'sticker' || (content.type === 'video' && Boolean(content.gif));

export function MessageBubble({
  message,
  showAuthorName,
  onResend,
  quoted,
  onReply,
  onDelete,
  onReact,
}: MessageBubbleProps) {
  const [lightboxMedia, setLightboxMedia] = useState<LightboxMedia | null>(null);

  if (message.content.type === 'system') {
    return (
      <div className="my-2.5 flex items-center justify-center">
        <span className="rounded-full border border-line-soft bg-surface px-3 py-1 text-center font-mono text-[11px] text-muted shadow-xs">
          {message.content.text}
        </span>
      </div>
    );
  }

  if (message.isPrivate) {
    return (
      <article className="mx-auto w-[96%] max-w-2xl rounded-2xl border border-note-line bg-note p-3.5 shadow-xs">
        <header className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 tracking-tight">
          <Lock className="size-3.5" />
          <span>Nota interna · visível apenas para a equipe</span>
        </header>
        <p
          className={cn(
            'text-sm leading-relaxed text-note-text font-normal',
            message.deletedAt && 'flex items-center gap-1.5 italic opacity-75',
          )}
        >
          {message.deletedAt ? (
            <>
              <Ban className="size-3.5 shrink-0" />
              Esta nota foi apagada
            </>
          ) : message.content.type === 'text' ? (
            <WaText text={message.content.text} />
          ) : (
            AUDIO_LABEL
          )}
        </p>
        <footer className="mt-2 flex items-center justify-between gap-2 text-[11px] font-medium text-amber-600/80 dark:text-amber-400/80">
          <span>
            {message.authorName} · {horaDaMensagem(message)}
          </span>
          {onDelete && !message.deletedAt ? (
            <button
              type="button"
              onClick={() => onDelete(message)}
              title="Apagar nota interna"
              className="rounded p-1 transition-colors hover:bg-amber-500/15 hover:text-red-500"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </footer>
      </article>
    );
  }

  const isInbound = message.author === 'contact';
  const isAi = message.author === 'ai';
  const deleted = Boolean(message.deletedAt);
  const sentFromPhone = !isInbound && message.origin === 'canal';
  const authorLabel = isAi || (isInbound && showAuthorName) ? message.authorName : undefined;
  const frameless = !deleted && isFrameless(message.content);

  const canDelete = Boolean(onDelete) && !isInbound && !deleted;
  const canReply = Boolean(onReply) && !deleted;
  const canReact = Boolean(onReact) && !deleted;

  const reactions = groupReactions(message.reactions);
  const minhaReacao = message.reactions?.find((item) => item.by === 'agent')?.emoji;

  /** Clicar no selo alterna: o meu emoji sai, o dos outros vira o meu. */
  const alternarReacao = (emoji: string) => {
    onReact?.(message, minhaReacao === emoji ? '' : emoji);
  };

  return (
    <>
      <article
        className={cn(
          'group/mensagem flex w-full items-end gap-1.5',
          isInbound ? 'justify-start' : 'justify-end',
        )}
      >
        {!isInbound && (canReply || canDelete || canReact) ? (
          <MessageActions
            message={message}
            inbound={isInbound}
            {...(canReply && onReply ? { onReply } : {})}
            {...(canDelete && onDelete ? { onDelete } : {})}
            {...(canReact ? { onReact: alternarReacao, current: minhaReacao } : {})}
          />
        ) : null}

        {/* A coluna existe para o selo de reações: ele fica **abaixo** do balão
            e alinhado com ele, do lado de quem falou — que é onde o WhatsApp o
            desenha e onde o olho já o procura. */}
        <div
          className={cn(
            'flex min-w-0 max-w-[82%] flex-col sm:max-w-[72%]',
            isInbound ? 'items-start' : 'items-end',
          )}
        >
          <div
            className={cn(
              'min-w-0 text-sm leading-relaxed transition-all',
              frameless
                ? 'flex flex-col gap-1'
                : cn(
                    'rounded-2xl px-4 py-2.5 shadow-xs',
                    isInbound && 'rounded-tl-xs border border-line bg-surface text-ink',
                    !isInbound &&
                      !isAi &&
                      'rounded-tr-xs bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs shadow-blue-600/15',
                    isAi && 'rounded-tr-xs border border-cyan-500/30 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200',
                  ),
              !frameless && message.content.type === 'image' && 'p-1.5',
            )}
          >
            {authorLabel && (
              <p
                className={cn(
                  'text-[11px] font-bold tracking-tight opacity-90',
                  message.content.type === 'image' ? 'px-2.5 pt-1.5' : 'mb-1 text-cyan-600 dark:text-cyan-400',
                )}
              >
                {authorLabel}
              </p>
            )}

            {quoted && !deleted ? <QuotedPreview message={quoted} inbound={isInbound} /> : null}

            {deleted ? (
              <p className="flex items-center gap-1.5 italic opacity-80">
                <Ban className="size-3.5 shrink-0" />
                {isInbound ? 'Esta mensagem foi apagada' : 'Você apagou esta mensagem'}
              </p>
            ) : (
              <MediaContent content={message.content} onOpenLightbox={setLightboxMedia} />
            )}

            <footer
              className={cn(
                'flex items-center justify-end gap-1.5 text-[11px] font-medium opacity-80',
                frameless ? 'mt-0' : 'mt-1.5',
                message.content.type === 'image' && !frameless && 'px-2 pb-1',
              )}
            >
              {sentFromPhone && (
                <span title="Enviada direto pelo WhatsApp">
                  <Smartphone className="size-3 opacity-70" />
                </span>
              )}
              <span>{horaDaMensagem(message)}</span>
              {!isInbound && message.deliveryStatus && (
                <DeliveryTicks
                  status={message.deliveryStatus}
                  {...(message.deliveryStatus === 'falha' && onResend
                    ? { onRetry: () => onResend(message.id) }
                    : {})}
                />
              )}
            </footer>
          </div>

          {reactions.length > 0 ? (
            <div className="-mt-1.5 flex flex-wrap items-center gap-1">
              {reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  type="button"
                  disabled={!canReact}
                  onClick={() => alternarReacao(reaction.emoji)}
                  title={
                    reaction.names.length > 0
                      ? `${reaction.emoji} ${reaction.names.join(', ')}`
                      : undefined
                  }
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none shadow-xs transition-colors',
                    reaction.mine
                      ? 'border-brand/40 bg-brand/15 text-brand'
                      : 'border-line bg-surface text-muted hover:bg-surface-2',
                    !canReact && 'cursor-default',
                  )}
                >
                  <span className="text-[13px]" aria-hidden="true">
                    {reaction.emoji}
                  </span>
                  {reaction.count > 1 ? (
                    <span className="font-semibold tabular-nums">{reaction.count}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {isInbound && (canReply || canDelete || canReact) ? (
          <MessageActions
            message={message}
            inbound={isInbound}
            {...(canReply && onReply ? { onReply } : {})}
            {...(canDelete && onDelete ? { onDelete } : {})}
            {...(canReact ? { onReact: alternarReacao, current: minhaReacao } : {})}
          />
        ) : null}
      </article>

      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
    </>
  );
}

function MessageActions({
  message,
  inbound,
  onReply,
  onDelete,
  onReact,
  current,
}: {
  readonly message: Message;
  readonly inbound: boolean;
  readonly onReply?: (message: Message) => void;
  readonly onDelete?: (message: Message) => void;
  readonly onReact?: (emoji: string) => void;
  /** Emoji com que **eu** já reagi, para o botão mostrar o estado. */
  readonly current?: string;
}) {
  const [barraAberta, setBarraAberta] = useState(false);
  const [pickerAberto, setPickerAberto] = useState(false);

  const reagir = (emoji: string) => {
    onReact?.(emoji);
    setBarraAberta(false);
    setPickerAberto(false);
  };

  return (
    <div
      className={cn(
        'relative flex items-center gap-0.5 transition-opacity',
        // A barra aberta segura a visibilidade: sem isto, tirar o mouse do
        // balão para alcançar o emoji fecharia o que a pessoa foi clicar.
        barraAberta || pickerAberto
          ? 'opacity-100'
          : 'opacity-0 group-hover/mensagem:opacity-100 focus-within:opacity-100',
      )}
    >
      {onReact && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setBarraAberta((valor) => !valor);
              setPickerAberto(false);
            }}
            aria-expanded={barraAberta}
            title="Reagir"
            className={cn(
              'rounded-lg p-1.5 transition-colors hover:bg-surface-2 hover:text-ink',
              current ? 'text-brand' : 'text-muted',
            )}
          >
            <SmilePlus className="size-3.5" />
          </button>

          {barraAberta && !pickerAberto ? (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setBarraAberta(false)}
                aria-hidden="true"
              />
              <div
                role="menu"
                aria-label="Reagir à mensagem"
                className={cn(
                  'absolute bottom-full z-40 mb-1 flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 shadow-xl',
                  inbound ? 'left-0' : 'right-0',
                )}
              >
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => reagir(emoji)}
                    title={current === emoji ? 'Retirar reação' : `Reagir com ${emoji}`}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-base leading-none transition-transform hover:scale-125',
                      current === emoji && 'bg-brand/15',
                    )}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPickerAberto(true)}
                  title="Mais emojis"
                  aria-label="Mais emojis"
                  className="flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </>
          ) : null}

          {pickerAberto ? (
            <EmojiPicker
              align={inbound ? 'left' : 'right'}
              onPick={reagir}
              onClose={() => {
                setPickerAberto(false);
                setBarraAberta(false);
              }}
            />
          ) : null}
        </div>
      )}

      {onReply && (
        <button
          type="button"
          onClick={() => onReply(message)}
          title="Responder"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink transition-colors"
        >
          <Reply className="size-3.5" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(message)}
          title="Apagar mensagem"
          className="rounded-lg p-1.5 text-muted hover:bg-red-500/15 hover:text-red-500 transition-colors"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function QuotedPreview({
  message,
  inbound,
}: {
  readonly message: Message;
  readonly inbound: boolean;
}) {
  return (
    <div
      className={cn(
        'mb-1.5 flex flex-col gap-0.5 rounded-lg border-l-2 px-2.5 py-1.5 text-xs',
        inbound ? 'border-l-brand bg-surface-2' : 'border-l-white/70 bg-black/15',
      )}
    >
      <span className="font-semibold opacity-90">
        {message.author === 'contact' ? (message.authorName ?? 'Contato') : 'Você'}
      </span>
      <span className="line-clamp-2 opacity-75">{previewOfMessage(message)}</span>
    </div>
  );
}

function MediaContent({
  content,
  onOpenLightbox,
}: {
  readonly content: MessageContent;
  readonly onOpenLightbox: (media: LightboxMedia) => void;
}) {
  switch (content.type) {
    case 'text':
    case 'template':
    case 'system':
      return (
        <p className="break-words whitespace-pre-wrap">
          <WaText text={content.text} />
        </p>
      );

    case 'image':
      return (
        <figure
          onClick={() => onOpenLightbox({ type: 'image', url: content.url, caption: content.caption })}
          className="group/media relative cursor-pointer overflow-hidden rounded-xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.url}
            alt={content.caption ?? 'Foto recebida'}
            loading="lazy"
            className="max-h-80 w-full rounded-xl object-cover transition-transform duration-300 group-hover/media:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-black/0 group-hover/media:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
            <span className="opacity-0 group-hover/media:opacity-100 transition-opacity bg-black/60 backdrop-blur-xs text-white p-2 rounded-full shadow-md">
              <Maximize2 className="size-4" />
            </span>
          </div>
          {content.caption && (
            <figcaption className="px-2 pt-2 text-xs leading-relaxed">
              {content.caption}
            </figcaption>
          )}
        </figure>
      );

    case 'video':
      return (
        <figure className="group/media relative overflow-hidden rounded-xl">
          <video
            src={content.url}
            controls={!content.gif}
            autoPlay={Boolean(content.gif)}
            loop={Boolean(content.gif)}
            muted={Boolean(content.gif)}
            playsInline
            className="max-h-80 w-full rounded-xl"
          />
          {!content.gif && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLightbox({
                  type: 'video',
                  url: content.url,
                  caption: content.caption,
                  isGif: content.gif,
                });
              }}
              title="Ver em tela cheia"
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white backdrop-blur-xs shadow-md transition-all opacity-80 hover:opacity-100"
            >
              <Maximize2 className="size-3.5" />
            </button>
          )}
          {content.caption && (
            <figcaption className="px-2 pt-2 text-xs leading-relaxed">
              {content.caption}
            </figcaption>
          )}
        </figure>
      );

    case 'audio':
      return (
        <div className="flex items-center gap-3 py-1 min-w-[200px]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15">
            {content.voice ? <Mic className="size-4" /> : <Music className="size-4" />}
          </div>
          <audio src={content.url} controls className="h-8 flex-1 max-w-[240px]" />
        </div>
      );

    case 'document':
      return (
        <a
          href={content.url}
          download={content.fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl bg-black/10 dark:bg-white/10 p-3 hover:bg-black/15 dark:hover:bg-white/15 transition-colors"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-black/10 dark:bg-white/10">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{content.fileName}</p>
            <p className="text-[10px] opacity-75">{content.size}</p>
          </div>
          <Download className="size-4 shrink-0 opacity-60" />
        </a>
      );

    case 'sticker':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={content.url}
          alt="Figurinha"
          loading="lazy"
          className="size-36 object-contain"
        />
      );

    default:
      return <p className="italic text-xs opacity-75">Mídia não suportada</p>;
  }
}
