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
  Loader2,
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

const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

const pickRecordingType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
};

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

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [isRecording]);

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
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const seconds = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000));
        setRecording({ blob, seconds });
        setIsRecording(false);
        setElapsed(0);
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setElapsed(0);
      setAttachment(undefined);
    } catch {
      setMediaError('Acesso ao microfone foi negado.');
    }
  };

  const cancelRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current.stop();
    }
    setIsRecording(false);
    setRecording(undefined);
    setElapsed(0);
  };

  const clearMedia = () => {
    setAttachment(undefined);
    setRecording(undefined);
    setMediaError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || uploading || pending) return;

    if (attachment && onSendMedia) {
      setUploading(true);
      setMediaError(undefined);
      try {
        const form = new FormData();
        form.set('file', attachment);
        if (text.trim()) form.set('caption', text.trim());
        const res = await onSendMedia(form);
        if (!res.ok) {
          setMediaError(res.error || 'Não foi possível enviar o anexo.');
          return;
        }
        clearMedia();
        setText('');
      } finally {
        setUploading(false);
      }
      return;
    }

    if (recording && onSendMedia) {
      setUploading(true);
      setMediaError(undefined);
      try {
        const form = new FormData();
        const ext = recording.blob.type.includes('ogg') ? 'ogg' : 'webm';
        form.set('file', recording.blob, `audio-${Date.now()}.${ext}`);
        if (text.trim()) form.set('caption', text.trim());
        const res = await onSendMedia(form);
        if (!res.ok) {
          setMediaError(res.error || 'Não foi possível enviar o áudio.');
          return;
        }
        clearMedia();
        setText('');
      } finally {
        setUploading(false);
      }
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, mode);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (cannedMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCannedIndex((prev) => (prev + 1) % cannedMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCannedIndex((prev) => (prev - 1 + cannedMatches.length) % cannedMatches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const match = cannedMatches[cannedIndex];
        if (match) applyCanned(match);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setText('');
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event as unknown as FormEvent);
    }
  };

  const canSubmit = hasMedia ? !uploading : text.trim().length > 0;
  const isBusy = uploading || pending;

  return (
    <form
      onSubmit={submit}
      className={cn(
        'relative flex flex-col gap-2 rounded-2xl border transition-all duration-200 p-2.5 sm:p-3 shadow-xs',
        isNote
          ? 'border-note-line bg-note'
          : 'border-line bg-surface focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/10',
      )}
    >
      {/* Respostas rápidas popup */}
      {cannedMatches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Respostas rápidas"
          className="absolute bottom-full left-0 z-20 mb-2 w-[min(32rem,100%)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl backdrop-blur-md"
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
                  'flex w-full flex-col gap-0.5 border-b border-line-soft px-3.5 py-2.5 text-left last:border-0 transition-colors',
                  index === cannedIndex ? 'bg-brand/12 text-ink' : 'text-muted hover:bg-surface-2',
                )}
              >
                <span className="font-mono text-xs font-bold text-brand">
                  {response.shortcut}
                </span>
                <span className="line-clamp-2 text-xs text-muted">{response.content}</span>
              </button>
            </li>
          ))}
          <li className="bg-surface-2 px-3.5 py-1.5 text-[10px] text-muted font-mono">
            ↑↓ navega · Enter insere · Esc cancela
          </li>
        </ul>
      )}

      {/* Topo do compositor: Alternância de Modo */}
      <div className="flex items-center justify-between gap-2 border-b border-line-soft pb-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode('publica')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
              !isNote
                ? 'bg-brand/15 text-brand border border-brand/30 shadow-xs'
                : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
            )}
          >
            <span>Mensagem pública</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('nota')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
              isNote
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
            )}
          >
            <Lock className="size-3 text-amber-500" />
            <span>Nota interna</span>
          </button>
        </div>

        {cannedResponses.length > 0 && (
          <span className="hidden text-[11px] text-muted sm:block font-mono">
            Atalho <kbd className="rounded bg-surface-2 px-1 py-0.5 text-ink border border-line-soft">/</kbd>
          </span>
        )}
      </div>

      {blocked && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {disabledReason}
        </div>
      )}

      {/* Prévia de Anexo */}
      {attachment && (
        <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs text-ink">
          <div className="flex items-center gap-2 min-w-0">
            <Paperclip className="size-4 shrink-0 text-brand" />
            <span className="truncate font-medium">{attachment.name}</span>
            <span className="text-[10px] text-muted shrink-0">
              ({kindOf(attachment.type)} · {humanSize(attachment.size)})
            </span>
          </div>
          <button
            type="button"
            onClick={clearMedia}
            aria-label="Remover anexo"
            className="flex size-5 items-center justify-center rounded text-muted hover:text-red-500"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Prévia de Gravação */}
      {recording && (
        <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs text-ink">
          <div className="flex items-center gap-2 min-w-0">
            <Mic className="size-4 shrink-0 text-brand" />
            <span className="truncate font-medium">Áudio gravado ({clock(recording.seconds)})</span>
            <span className="text-[10px] text-muted shrink-0">({humanSize(recording.blob.size)})</span>
          </div>
          <button
            type="button"
            onClick={clearMedia}
            aria-label="Descartar gravação"
            className="flex size-5 items-center justify-center rounded text-muted hover:text-red-500"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {mediaError && (
        <p role="alert" className="text-xs font-medium text-red-500">
          {mediaError}
        </p>
      )}

      {/* Painel Gravando Áudio */}
      {isRecording && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-xs text-red-600 dark:text-red-300">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono font-bold text-red-600 dark:text-red-200 tabular-nums">
            {clock(elapsed)}
          </span>
          <span className="flex-1 font-medium">Gravando áudio...</span>
          <button
            type="button"
            onClick={cancelRecording}
            className="font-medium text-red-600 dark:text-red-300 hover:underline"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
          >
            <Square className="size-3" />
            <span>Concluir</span>
          </button>
        </div>
      )}

      {/* Campo de Texto Principal */}
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
            ? 'Legenda do anexo (opcional)...'
            : isNote
              ? 'Escreva uma nota interna visível apenas para a equipe...'
              : 'Escreva sua mensagem... (Enter para enviar, Shift+Enter para nova linha)'
        }
        className="w-full resize-none bg-transparent px-1 py-1 text-sm text-ink placeholder:text-muted outline-none disabled:opacity-50 min-h-[44px] max-h-36 leading-relaxed"
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

      {/* Barra de Ferramentas Inferior */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-line-soft">
        <div className="flex items-center gap-1">
          <ToolbarButton
            label="Anexar arquivo"
            disabled={blocked || isRecording || !onSendMedia}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Inserir emoji"
            {...planned('Seleção de emojis')}
          >
            <Smile className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            label={isRecording ? 'Parar gravação' : 'Gravar áudio'}
            disabled={blocked || !onSendMedia}
            onClick={() => (isRecording ? recorderRef.current?.stop() : void startRecording())}
            active={isRecording}
          >
            <Mic className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Agendar mensagem"
            {...planned('Agendamento de mensagem')}
          >
            <CalendarClock className="size-4" />
          </ToolbarButton>
        </div>

        {/* Botão de Envio */}
        <button
          type="submit"
          disabled={blocked || isBusy || !canSubmit}
          className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
            isNote
              ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/25'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-600/30',
          )}
        >
          {isBusy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Enviando...</span>
            </>
          ) : (
            <>
              <span>{isNote ? 'Salvar nota' : 'Enviar'}</span>
              <Send className="size-3.5" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function ToolbarButton({
  children,
  label,
  disabled,
  active,
  onClick,
  title,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly disabled?: boolean;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg transition-all text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none',
        active && 'bg-red-500/20 text-red-500 border border-red-500/30',
      )}
    >
      {children}
    </button>
  );
}
