'use client';

import { Ban, Download, FileText, Lock, Mic, Music, Reply, Smartphone, Trash2 } from 'lucide-react';
import { previewOfMessage, type Message, type MessageContent } from '@/core/domain/message';
import { WaText } from '@/components/domain/wa-text';
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
}: MessageBubbleProps) {
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
  // Uma mensagem apagada não tem mídia nem legenda: ela é o aviso de que houve
  // algo ali. Molduras especiais (figurinha, GIF) deixam de valer junto.
  const frameless = !deleted && isFrameless(message.content);

  // O WhatsApp só permite remover para todos o que **nós** mandamos; oferecer o
  // botão numa mensagem do contato prometeria algo que o protocolo recusa.
  const canDelete = Boolean(onDelete) && !isInbound && !deleted;
  const canReply = Boolean(onReply) && !deleted;

  return (
    <article
      className={cn(
        'group/mensagem flex w-full items-end gap-1.5',
        isInbound ? 'justify-start' : 'justify-end',
      )}
    >
      {!isInbound && (canReply || canDelete) ? (
        <MessageActions
          message={message}
          {...(canReply && onReply ? { onReply } : {})}
          {...(canDelete && onDelete ? { onDelete } : {})}
        />
      ) : null}

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

        {quoted && !deleted ? <QuotedPreview message={quoted} inbound={isInbound} /> : null}

        {deleted ? (
          <p className="flex items-center gap-1.5 italic opacity-80">
            <Ban className="size-3.5 shrink-0" />
            {isInbound ? 'Esta mensagem foi apagada' : 'Você apagou esta mensagem'}
          </p>
        ) : (
          <MediaContent content={message.content} />
        )}

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
          {/* Mensagem apagada não tem estado de entrega a relatar: os ticks
              descreveriam o percurso de um conteúdo que não existe mais. */}
          {!isInbound && !deleted && message.deliveryStatus && (
            <DeliveryTicks status={message.deliveryStatus} />
          )}
        </footer>

        {/* O aviso de falha não depende mais de haver um `onResend`.
            Sem ele, uma mensagem que o canal recusou aparecia igual às outras,
            com um ícone de 12px como única diferença — e quem escreveu seguia
            achando que a pessoa tinha recebido. O texto é o aviso; tentar de
            novo é o extra que só existe onde alguém sabe como refazer o envio. */}
        {!deleted &&
          message.deliveryStatus === 'falha' &&
          (onResend ? (
            <button
              type="button"
              onClick={() => onResend(message.id)}
              className="mt-1.5 block text-right text-xs font-semibold text-red-500 hover:underline"
            >
              Não entregue · Clique para tentar novamente
            </button>
          ) : (
            <p className="mt-1.5 text-right text-xs font-semibold text-red-500">
              Não entregue pelo canal
            </p>
          ))}
      </div>

      {isInbound && canReply ? (
        <MessageActions message={message} {...(onReply ? { onReply } : {})} />
      ) : null}
    </article>
  );
}

/**
 * Ações da mensagem: responder e apagar.
 *
 * Ficam **fora** do balão, do lado de dentro da conversa, e só aparecem sob o
 * cursor. Dentro do balão elas disputariam espaço com o texto em toda mensagem
 * curta; visíveis o tempo todo, transformariam a leitura da conversa numa
 * parede de ícones.
 *
 * `focus-within` acompanha o `hover` porque quem navega por teclado também
 * precisa alcançá-las — sem isso o botão existiria só para quem usa mouse.
 */
function MessageActions({
  message,
  onReply,
  onDelete,
}: {
  readonly message: Message;
  readonly onReply?: (message: Message) => void;
  readonly onDelete?: (message: Message) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/mensagem:opacity-100 focus-within:opacity-100">
      {onReply ? (
        <button
          type="button"
          onClick={() => onReply(message)}
          title="Responder esta mensagem"
          aria-label="Responder esta mensagem"
          className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-brand"
        >
          <Reply className="size-3.5" />
        </button>
      ) : null}

      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(message)}
          title="Apagar para todos"
          aria-label="Apagar mensagem para todos"
          className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-red-500"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A citação dentro do balão.
 *
 * Uma faixa com barra lateral, como no próprio WhatsApp: quem lê precisa
 * reconhecer o formato antes de ler o conteúdo. O texto é o mesmo resumo que a
 * lista de conversas usa — uma foto citada aparece como "📷 Foto", não como um
 * vazio.
 */
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

function MediaContent({ content }: { readonly content: MessageContent }) {
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
