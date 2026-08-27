'use client';

import { Download, FileText, Lock, Mic, Music, Smartphone } from 'lucide-react';
import type { Message, MessageContent } from '@/core/domain/message';
import { cn } from '@/lib/cn';
import { horaDaMensagem } from '@/lib/datetime';
import { DeliveryTicks } from './delivery-ticks';

const AUDIO_LABEL = 'Mensagem de áudio';

interface MessageBubbleProps {
  readonly message: Message;
  readonly showAuthorName?: boolean;
  readonly onResend?: (messageId: string) => void;
}

const isFrameless = (content: MessageContent): boolean =>
  content.type === 'sticker' || (content.type === 'video' && Boolean(content.gif));

export function MessageBubble({ message, showAuthorName, onResend }: MessageBubbleProps) {
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
        <p className="text-sm leading-relaxed text-note-text font-normal">
          {message.content.type === 'text' ? message.content.text : AUDIO_LABEL}
        </p>
        <footer className="mt-2 text-[11px] font-medium text-amber-600/80 dark:text-amber-400/80">
          {message.authorName} · {horaDaMensagem(message)}
        </footer>
      </article>
    );
  }

  const isInbound = message.author === 'contact';
  const isAi = message.author === 'ai';
  const sentFromPhone = !isInbound && message.origin === 'canal';
  const authorLabel = isAi || (isInbound && showAuthorName) ? message.authorName : undefined;
  const frameless = isFrameless(message.content);

  return (
    <article className={cn('flex w-full', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[82%] sm:max-w-[72%] text-sm leading-relaxed transition-all',
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

        <MediaContent content={message.content} />

        <footer
          className={cn(
            'flex items-center justify-end gap-1.5 text-[11px] font-medium opacity-80',
            frameless ? 'mt-0' : 'mt-1.5',
            message.content.type === 'image' && !frameless && 'px-2 pb-1',
          )}
        >
          {sentFromPhone && (
            <span className="mr-auto flex items-center gap-1 opacity-90" title="Enviada pelo aparelho pareado">
              <Smartphone className="size-3" />
              {message.authorName}
            </span>
          )}
          <span className="tabular-nums font-mono">{horaDaMensagem(message)}</span>
          {!isInbound && message.deliveryStatus && (
            <DeliveryTicks status={message.deliveryStatus} />
          )}
        </footer>

        {message.deliveryStatus === 'falha' && onResend && (
          <button
            type="button"
            onClick={() => onResend(message.id)}
            className="mt-1.5 text-xs font-semibold text-red-500 hover:underline block text-right"
          >
            Falha ao enviar · Clique para tentar novamente
          </button>
        )}
      </div>
    </article>
  );
}

function MediaContent({ content }: { readonly content: MessageContent }) {
  switch (content.type) {
    case 'text':
    case 'template':
    case 'system':
      return <p className="break-words whitespace-pre-wrap">{content.text}</p>;

    case 'image':
      return (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.url}
            alt={content.caption ?? 'Foto recebida'}
            loading="lazy"
            className="max-h-80 w-full rounded-xl object-cover"
          />
          {content.caption && (
            <figcaption className="px-2 pt-2 text-xs leading-relaxed">
              {content.caption}
            </figcaption>
          )}
        </figure>
      );

    case 'video':
      return (
        <figure>
          <video
            src={content.url}
            controls={!content.gif}
            autoPlay={Boolean(content.gif)}
            loop={Boolean(content.gif)}
            muted={Boolean(content.gif)}
            className="max-h-80 w-full rounded-xl"
          />
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
