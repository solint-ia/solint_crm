'use client';

import { useTransition } from 'react';
import { LogOut, ShieldAlert } from 'lucide-react';
import { leaveAccountAction } from '@/app/(platform)/plataforma/session-actions';

/**
 * A faixa que avisa, o tempo inteiro, em nome de quem se está agindo.
 *
 * **Não se fecha, de propósito.** Um aviso dispensável seria dispensado no
 * primeiro minuto, e o que ele previne acontece depois: escrever para o cliente
 * de outra empresa achando que está na própria. Enquanto a sessão for de
 * plataforma, esta linha ocupa espaço na tela — o custo é uma faixa de 32
 * pixels, e o que ela evita é uma mensagem enviada pela conta errada.
 *
 * Fica acima de tudo, inclusive da rail, porque o contexto que ela dá vale para
 * a tela inteira e não para uma área dela.
 */
export function PlatformBanner({
  accountName,
  actorName,
}: {
  readonly accountName: string;
  readonly actorName: string;
}) {
  const [saindo, startTransition] = useTransition();

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 md:px-4"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ShieldAlert className="size-3.5 shrink-0" />
        <span className="truncate">
          <strong className="font-semibold">{actorName}</strong> está operando a conta{' '}
          <strong className="font-semibold">{accountName}</strong> como administrador da plataforma.
          Tudo o que for feito aqui fica registrado.
        </span>
      </span>

      <button
        type="button"
        disabled={saindo}
        onClick={() => startTransition(() => void leaveAccountAction())}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/50 px-2 py-1 font-semibold transition-colors hover:bg-amber-500/20 disabled:opacity-60"
      >
        <LogOut className="size-3" />
        {saindo ? 'Saindo…' : 'Sair da conta'}
      </button>
    </div>
  );
}
