import { Download, FileText, Lock, Mic, Music, Smartphone } from 'lucide-react';
import type { Message, MessageContent } from '@/core/domain/message';
import { cn } from '@/lib/cn';
import { DeliveryTicks } from './delivery-ticks';

const AUDIO_LABEL = 'Mensagem de áudio';

interface MessageBubbleProps {
  readonly message: Message;
  /** Em grupos, cada bolha recebida precisa dizer quem falou. */
  readonly showAuthorName?: boolean;
  readonly onResend?: (messageId: string) => void;
}

/** Figurinha e GIF são exibidos "soltos", sem a moldura de bolha. */
const isFrameless = (content: MessageContent): boolean =>
  content.type === 'sticker' || (content.type === 'video' && Boolean(content.gif));

/**
 * Renderiza um item da timeline com estética refinada.
 * Nota interna tem tratamento âmbar exclusivo de alta legibilidade.
 */
export function MessageBubble({ message, showAuthorName, onResend }: MessageBubbleProps) {
  if (message.content.type === 'system') {
    return (
      <p className="my-2.5 text-center text-meta font-medium text-dim">
        {message.content.text}
      </p>
    );
  }

  if (message.isPrivate) {
    return (
      <article className="mx-auto w-[94%] rounded-control border border-note-line bg-note p-3.5 shadow-2xs">
        <header className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-note-meta tracking-tight">
          <Lock className="size-3.5" />
          Nota interna · visível apenas para a equipe
        </header>
        <p className="text-ui leading-relaxed text-note-text font-normal">
          {message.content.type === 'text' ? message.content.text : AUDIO_LABEL}
        </p>
        <footer className="mt-2 text-meta font-medium text-note-meta opacity-90">
          {message.authorName} · {message.time}
        </footer>
      </article>
    );
  }

  const isInbound = message.author === 'contact';
  const isAi = message.author === 'ai';
  // Saiu do celular pareado, não desta plataforma: sinalizar evita atribuir ao agente logado.
  const sentFromPhone = !isInbound && message.origin === 'canal';
  const authorLabel = isAi || (isInbound && showAuthorName) ? message.authorName : undefined;
  const frameless = isFrameless(message.content);

  return (
    <article className={cn('flex w-full', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[76%] text-ui leading-relaxed',
          frameless
            ? 'flex flex-col gap-1'
            : cn(
                'rounded-bubble px-4 py-3 shadow-2xs',
                isInbound && 'rounded-tl-xs border border-line bg-surface text-ink',
                !isInbound &&
                  !isAi &&
                  'rounded-tr-xs bg-accent-soft text-accent-soft-text border border-accent-line/40',
                isAi && 'rounded-tr-xs border border-cyan-line bg-cyan-soft text-cyan-text',
              ),
          !frameless && message.content.type === 'image' && 'p-1.5',
        )}
      >
        {authorLabel ? (
          <p
            className={cn(
              'text-meta font-bold tracking-tight opacity-85',
              message.content.type === 'image' ? 'px-2.5 pt-1.5' : 'mb-1',
            )}
          >
            {authorLabel}
          </p>
        ) : null}

        <MediaContent content={message.content} />

        <footer
          className={cn(
            'flex items-center justify-end gap-1.5 text-meta font-medium opacity-75',
            frameless ? 'mt-0' : 'mt-1.5',
            message.content.type === 'image' && !frameless && 'px-2 pb-1',
          )}
        >
          {sentFromPhone ? (
            <span className="mr-auto flex items-center gap-1" title="Enviada pelo celular pareado">
              <Smartphone className="size-3" />
              {message.authorName}
            </span>
          ) : null}
          <span className="tabular-nums">{message.time}</span>
          {!isInbound && message.deliveryStatus ? (
            <DeliveryTicks status={message.deliveryStatus} />
          ) : null}
        </footer>

        {message.deliveryStatus === 'falha' && onResend ? (
          <button
            type="button"
            onClick={() => onResend(message.id)}
            className="mt-1.5 text-meta font-semibold text-red-text hover:underline"
          >
            Falha ao enviar · Reenviar
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** Corpo da mensagem por tipo de conteúdo. */
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
            className="max-h-80 w-full rounded-bubble object-cover"
          />
          {content.caption ? (
            <figcaption className="px-2 pt-2 text-body leading-relaxed">
              {content.caption}
            </figcaption>
          ) : null}
        </figure>
      );

    case 'sticker':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={content.url}
          alt="Figurinha"
          loading="lazy"
          className="size-32 object-contain"
        />
      );

    case 'video':
      // GIF do WhatsApp é vídeo mudo em laço: reproduz sozinho, sem controles.
      return content.gif ? (
        <video
          src={content.url}
          autoPlay
          loop
          muted
          playsInline
          className="max-h-72 max-w-full rounded-bubble"
          aria-label={content.caption ?? 'GIF recebido'}
        />
      ) : (
        <figure>
          <video
            src={content.url}
            controls
            preload="metadata"
            className="max-h-80 w-full rounded-bubble"
          />
          {content.caption ? (
            <figcaption className="pt-2 text-body leading-relaxed">
              {content.caption}
            </figcaption>
          ) : null}
        </figure>
      );

    case 'audio':
      return (
        <div className="min-w-56">
          <div className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold opacity-80">
            {content.voice ? <Mic className="size-3.5" /> : <Music className="size-3.5" />}
            {content.voice ? 'Mensagem de voz' : 'Áudio'}
            <span className="ml-auto font-mono tabular-nums">{content.duration}</span>
          </div>
          {content.url ? (
            <audio controls preload="metadata" src={content.url} className="h-9 w-full">
              <a href={content.url}>Baixar áudio</a>
            </audio>
          ) : (
            <p className="text-body opacity-75">Áudio indisponível para reprodução.</p>
          )}
          {content.transcript ? (
            <p className="mt-2.5 border-t border-current/15 pt-2 text-body leading-relaxed opacity-90">
              <span className="font-semibold">Transcrição por IA: </span>
              {content.transcript}
            </p>
          ) : null}
        </div>
      );

    case 'document':
      return (
        <a
          href={content.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={content.url ? undefined : true}
          className={cn(
            'flex items-center gap-2.5 rounded-control transition-colors',
            content.url ? 'hover:bg-current/5' : 'pointer-events-none opacity-70',
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-current/10">
            <FileText className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{content.fileName}</span>
            <span className="block font-mono text-meta opacity-75">{content.size}</span>
          </span>
          {content.url ? <Download className="size-3.5 shrink-0 opacity-70" /> : null}
        </a>
      );
  }
}
