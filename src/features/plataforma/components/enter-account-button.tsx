'use client';

import { useState, useTransition } from 'react';
import { LogIn } from 'lucide-react';
import { enterAccountAction } from '@/app/(platform)/plataforma/session-actions';
import { cn } from '@/lib/cn';

/**
 * Abre o CRM de uma conta com poderes completos.
 *
 * **Confirma antes.** Entrar numa conta é passar a agir dentro dos dados de um
 * cliente, e o registro em auditoria começa no clique. Um botão que faz isso
 * direto seria o mesmo peso visual de "abrir ficha", que só lê — e a diferença
 * entre os dois é justamente o que precisa ficar clara.
 */
export function EnterAccountButton({
  accountId,
  accountName,
  className,
}: {
  readonly accountId: string;
  readonly accountName: string;
  readonly className?: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [entrando, startTransition] = useTransition();

  if (confirmando) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={entrando}
          onClick={() => startTransition(() => void enterAccountAction({ accountId }))}
          className="rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          {entrando ? 'Entrando…' : `Entrar em ${accountName}`}
        </button>
        <button
          type="button"
          disabled={entrando}
          onClick={() => setConfirmando(false)}
          className="rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-60"
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirmando(true)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:border-brand/40 hover:bg-surface-2',
        className,
      )}
    >
      <LogIn className="size-3" />
      Entrar na conta
    </button>
  );
}
