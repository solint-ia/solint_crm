'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  CalendarClock,
  FileText,
  Lock,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  X,
} from 'lucide-react';
import type { CannedResponse } from '@/core/domain/settings';
import { MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { Button } from '@/components/ui/button';
import { planned } from '@/components/ui/planned';
import { cn } from '@/lib/cn';

export type ComposerMode = 'publica' | 'nota';

export interface MediaResult {
  readonly ok: boolean;
  readonly error?: string;
}

interface ComposerProps {
  readonly disabledReason?: string;
  readonly onSend: (text: string, mode: ComposerMode) => void;
  readonly onSendMedia?: (form: FormData) => Promise<MediaResult>;
  readonly cannedResponses?: readonly CannedResponse[];
  readonly pending?: boolean;
}

/** Categoria do anexo a partir do tipo declarado pelo arquivo. */
const kindOf = (type: string): 'image' | 'video' | 'audio' | 'document' => {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
};

const humanSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Preferência de container para a gravação de voz.
 *
 * O WhatsApp toca opus em ogg; o Chrome só grava opus em webm. Pedimos ogg
 * primeiro e caímos para webm — que o Baileys envia, mas que pode não tocar em
 * todos os aparelhos sem transcodificação no servidor. É a limitação conhecida
 * desta entrega, e é melhor gravar em webm do que não gravar.
 */
const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

const pickRecordingType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
};

/** Barra de composicao com alternancia Mensagem pública / Nota interna. */
export function Composer({
  disabledReason,
  onSend,
  onSendMedia,
  cannedResponses = [],
  pending,
}: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>('publica');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File | undefined>();
  const [recording, setRecording] = useState<{ readonly blob: Blob; readonly seconds: number } | undefined>();
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | undefined>();
  const [cannedIndex, setCannedIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const isNote = mode === 'nota';
  const blocked = Boolean(disabledReason) && !isNote;
  const hasMedia = Boolean(attachment ?? recording);

  /**
   * Respostas rápidas: só quando a mensagem inteira começa com `/`.
   * Disparar no meio do texto transformaria qualquer URL numa gaveta aberta.
   */
  const cannedQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1) : undefined;
  const cannedMatches = useMemo(() => {
    if (cannedQuery === undefined) return [];
    const needle = cannedQuery.toLowerCase();
    return cannedResponses
      .filter(
        (response) =>
          response.shortcut.slice(1).toLowerCase().startsWith(needle) ||
          response.content.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [cannedQuery, cannedResponses]);

  useEffect(() => setCannedIndex(0), [cannedQuery]);

  // Cronômetro da gravação. Vive aqui e não no recorder para poder ser exibido.
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [isRecording]);

  // Soltar o microfone ao desmontar: um stream esquecido mantém o LED aceso.
  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const applyCanned = (response: CannedResponse) => {
    setText(response.content);
    textareaRef.current?.focus();
  };

  const startRecording = async () => {
    setMediaError(undefined);
    const mimeType = pickRecordingType();
    if (!mimeType) {
      setMediaError('Este navegador não permite gravar áudio.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setElapsed(0);
        if (blob.size > 0) setRecording({ blob, seconds });
      };

      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setElapsed(0);
    } catch {
      // Negar o microfone é uma escolha legítima — não é um erro para logar.
      setMediaError('Permissão de microfone negada.');
    }
  };

  const cancelRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setElapsed(0);
    };
    recorder.stop();
  };

  const clearMedia = () => {
    setAttachment(undefined);
    setRecording(undefined);
    setMediaError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || uploading) return;

    if (hasMedia && onSendMedia) {
      const form = new FormData();
      form.set('isPrivate', String(isNote));
      form.set('caption', text.trim());

      if (recording) {
        const extension = recording.blob.type.includes('ogg') ? 'ogg' : 'webm';
        form.set('kind', 'audio');
        form.set('voice', 'true');
        form.set('durationSeconds', String(recording.seconds));
        form.set('file', recording.blob, `audio-${Date.now()}.${extension}`);
      } else if (attachment) {
        form.set('kind', kindOf(attachment.type));
        form.set('file', attachment, attachment.name);
      }

      setUploading(true);
      setMediaError(undefined);
      const result = await onSendMedia(form);
      setUploading(false);

      if (!result.ok) {
        setMediaError(result.error ?? 'Não foi possível enviar o anexo.');
        return;
      }
      clearMedia();
      setText('');
      return;
    }

    const content = text.trim();
    if (!content) return;
    onSend(content, mode);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (cannedMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCannedIndex((index) => (index + 1) % cannedMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCannedIndex((index) => (index - 1 + cannedMatches.length) % cannedMatches.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        const chosen = cannedMatches[cannedIndex];
        if (chosen) {
          event.preventDefault();
          applyCanned(chosen);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setText('');
        return;
      }
    }

    // Enter envia, Shift+Enter quebra linha — convenção de todo chat.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event as unknown as FormEvent);
    }
  };

  const canSubmit = hasMedia ? !uploading : text.trim().length > 0;

  return (
    <form
      onSubmit={submit}
      className={cn(
        'relative shrink-0 border-t border-line px-3 py-3 md:px-4',
        isNote ? 'bg-note' : 'bg-surface',
      )}
    >
      {/* ---------- Respostas rápidas ---------- */}
      {cannedMatches.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Respostas rápidas"
          className="absolute bottom-full left-3 z-20 mb-1 w-[min(28rem,calc(100%-1.5rem))] overflow-hidden rounded-float border border-line bg-surface shadow-xl"
        >
          {cannedMatches.map((response, index) => (
            <li key={response.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === cannedIndex}
                onMouseEnter={() => setCannedIndex(index)}
                onClick={() => applyCanned(response)}
                className={cn(
                  'flex w-full flex-col gap-0.5 border-b border-line-soft px-3 py-2 text-left last:border-0 transition-colors',
                  index === cannedIndex ? 'bg-accent-soft' : 'hover:bg-surface-2',
                )}
              >
                <span className="font-mono text-meta font-bold text-brand">
                  {response.shortcut}
                </span>
                <span className="line-clamp-2 text-body text-muted">{response.content}</span>
              </button>
            </li>
          ))}
          <li className="bg-surface-2 px-3 py-1 text-micro text-dim">
            ↑↓ navega · Enter insere · Esc cancela
          </li>
        </ul>
      ) : null}

      <div className="mb-2 flex items-center gap-1">
        <ModeButton active={!isNote} onClick={() => setMode('publica')}>
          Mensagem pública
        </ModeButton>
        <ModeButton active={isNote} onClick={() => setMode('nota')} icon={<Lock className="size-3" />}>
          Nota interna
        </ModeButton>
        {cannedResponses.length > 0 ? (
          <span className="ml-auto hidden text-meta text-dim sm:block">
            Digite <kbd className="font-mono font-semibold">/</kbd> para respostas rápidas
          </span>
        ) : null}
      </div>

      {blocked ? (
        <p className="mb-2 rounded-control border border-note-line bg-note px-3 py-2 text-meta text-note-text">
          {disabledReason}
        </p>
      ) : null}

      {/* ---------- Anexo escolhido ---------- */}
      {attachment ? (
        <AttachmentPreview
          name={attachment.name}
          detail={`${kindOf(attachment.type)} · ${humanSize(attachment.size)}`}
          onRemove={clearMedia}
        />
      ) : null}

      {recording ? (
        <AttachmentPreview
          name={`Mensagem de voz · ${clock(recording.seconds)}`}
          detail={humanSize(recording.blob.size)}
          onRemove={clearMedia}
        />
      ) : null}

      {mediaError ? (
        <p role="alert" className="mb-2 text-meta font-medium text-red-text">
          {mediaError}
        </p>
      ) : null}

      {isRecording ? (
        <div className="mb-2 flex items-center gap-3 rounded-control border border-red-line/50 bg-red-soft px-3 py-2">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-text" />
          <span className="font-mono text-body font-semibold text-red-text tabular-nums">
            {clock(elapsed)}
          </span>
          <span className="flex-1 text-meta text-red-text">Gravando…</span>
          <button
            type="button"
            onClick={cancelRecording}
            className="text-meta font-semibold text-red-text hover:underline"
          >
            Descartar
          </button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Square className="size-3" />}
            onClick={() => recorderRef.current?.stop()}
          >
            Parar
          </Button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          disabled={blocked || isRecording}
          aria-label={isNote ? 'Nota interna' : 'Mensagem para o cliente'}
          placeholder={
            hasMedia
              ? 'Legenda do anexo (opcional)…'
              : isNote
                ? 'Escreva uma nota visível apenas para a equipe...'
                : 'Escreva sua mensagem...'
          }
          className={cn(
            'flex-1 resize-none rounded-control border px-3 py-2 text-ui text-ink outline-none placeholder:text-dim focus:border-brand disabled:opacity-60',
            isNote ? 'border-note-line bg-surface' : 'border-line bg-surface',
          )}
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setRecording(undefined);
            setMediaError(undefined);
            setAttachment(file);
          }}
        />

        <div className="flex items-center gap-0.5 pb-1">
          <IconButton
            label="Anexar arquivo"
            disabled={blocked || isRecording || !onSendMedia}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </IconButton>
          <IconButton label="Inserir emoji" hint="Escolher um emoji">
            <Smile className="size-4" />
          </IconButton>
          <IconButton
            label={isRecording ? 'Parar gravação' : 'Gravar áudio'}
            disabled={blocked || !onSendMedia}
            onClick={() => (isRecording ? recorderRef.current?.stop() : void startRecording())}
            className={isRecording ? 'text-red-text' : undefined}
          >
            <Mic className="size-4" />
          </IconButton>
          <IconButton label="Agendar envio" hint="Programar a mensagem para depois">
            <CalendarClock className="size-4" />
          </IconButton>
          <Button
            type="submit"
            size="sm"
            className="ml-1"
            disabled={blocked || pending || uploading || !canSubmit}
            icon={<Send className="size-3.5" />}
          >
            {uploading ? 'Enviando' : pending ? 'Enviando' : 'Enviar'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function AttachmentPreview({
  name,
  detail,
  onRemove,
}: {
  readonly name: string;
  readonly detail: string;
  readonly onRemove: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2">
      <FileText className="size-4 shrink-0 text-dim" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{name}</span>
        <span className="block text-meta text-dim">{detail}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover anexo"
        className="rounded-control p-1 text-dim transition-colors hover:bg-surface hover:text-red-text"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
  icon,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-control px-2.5 py-1 text-meta font-semibold transition-colors',
        active ? 'bg-accent-soft text-brand' : 'text-muted hover:bg-surface-2',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function IconButton({
  label,
  hint,
  onClick,
  disabled,
  className,
  children,
}: {
  readonly label: string;
  /** Quando presente, o recurso ainda não existe: o botão fica honestamente desabilitado. */
  readonly hint?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      {...(hint ? planned(hint) : { disabled, title: label })}
      className={cn(
        'flex size-8 items-center justify-center rounded-control text-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        className,
      )}
    >
      {children}
    </button>
  );
}
