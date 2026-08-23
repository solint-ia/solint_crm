'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastTone = 'info' | 'sucesso' | 'alerta' | 'erro';

export interface ToastInput {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  /** Um destino, não um callback: o toast some, o link continua válido. */
  readonly href?: Route;
  readonly actionLabel?: string;
  /** Chave de deduplicação: reemitir a mesma chave reinicia o toast existente. */
  readonly dedupeKey?: string;
  readonly durationMs?: number;
}

interface Toast extends ToastInput {
  readonly id: string;
}

interface ToastApi {
  readonly show: (toast: ToastInput) => void;
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const DEFAULT_DURATION = 7000;
const MAX_VISIBLE = 4;

const TONE_STYLE: Readonly<Record<ToastTone, { readonly bar: string; readonly icon: string }>> = {
  info: { bar: 'bg-brand', icon: 'text-brand' },
  sucesso: { bar: 'bg-status-open', icon: 'text-green-text' },
  alerta: { bar: 'bg-amber-text', icon: 'text-amber-text' },
  erro: { bar: 'bg-red-text', icon: 'text-red-text' },
};

const TONE_ICON: Readonly<Record<ToastTone, typeof Info>> = {
  info: Info,
  sucesso: Check,
  alerta: AlertTriangle,
  erro: AlertTriangle,
};

/**
 * Avisos efêmeros do produto.
 *
 * O barramento SSE já entregava mensagem nova em tempo real, mas só quem
 * estivesse com `/conversas` aberto ficava sabendo. Um toast resolve isso sem
 * roubar o foco: aparece, diz o que aconteceu, oferece o caminho e sai sozinho.
 *
 * Duas decisões que evitam que ele vire ruído: dedupe por chave (dez mensagens
 * da mesma conversa não viram dez cartões) e teto de quatro visíveis.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;

    setToasts((current) => {
      const withoutDuplicate = input.dedupeKey
        ? current.filter((toast) => toast.dedupeKey !== input.dedupeKey)
        : current;
      return [...withoutDuplicate, { ...input, id }].slice(-MAX_VISIBLE);
    });
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Fora do provider o hook devolve um `show` inerte em vez de explodir: um aviso
 * perdido é um bug pequeno, uma tela em branco é um bug grande.
 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return context ?? { show: () => undefined, dismiss: () => undefined };
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  readonly toast: Toast;
  readonly onDismiss: (id: string) => void;
}) {
  const tone = toast.tone ?? 'info';
  const Icon = TONE_ICON[tone];
  const [paused, setPaused] = useState(false);

  // Ler um aviso não deveria ser uma corrida: o cronômetro para sob o cursor.
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs ?? DEFAULT_DURATION);
    return () => clearTimeout(timer);
  }, [paused, toast.id, toast.durationMs, onDismiss]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto relative flex gap-2.5 overflow-hidden rounded-float border border-line bg-surface py-2.5 pr-2.5 pl-3.5 shadow-xl',
        'motion-safe:animate-[toast-in_180ms_ease-out]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-0.5', TONE_STYLE[tone].bar)}
      />
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', TONE_STYLE[tone].icon)} />

      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 line-clamp-2 text-meta text-muted">{toast.description}</p>
        ) : null}
        {toast.href ? (
          <Link
            href={toast.href}
            onClick={() => onDismiss(toast.id)}
            className="mt-1.5 inline-block text-meta font-semibold text-brand hover:underline"
          >
            {toast.actionLabel ?? 'Abrir'}
          </Link>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dispensar aviso: ${toast.title}`}
        className="h-fit rounded-control p-1 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
