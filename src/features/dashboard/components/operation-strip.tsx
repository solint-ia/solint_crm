import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/cn';

export interface OperationSignal {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** `alerta` pinta o número — é o que precisa de decisão agora. */
  readonly severity: 'neutro' | 'atencao' | 'alerta';
  readonly hint?: string;
  readonly href?: Route;
}

const SEVERITY_TEXT = {
  neutro: 'text-ink',
  atencao: 'text-amber-text',
  alerta: 'text-red-text',
} as const;

const SEVERITY_RULE = {
  neutro: 'bg-line',
  atencao: 'bg-amber-text',
  alerta: 'bg-red-text',
} as const;

/**
 * Faixa 1 do dashboard: o estado da operação agora.
 *
 * É a primeira coisa que um supervisor lê ao abrir o produto, e a pergunta que
 * ele faz não é "quais são meus cinco números do mês" — é "o que precisa de mim
 * agora?". Por isso vem antes dos indicadores de período, sem card, com uma
 * faixa de severidade que responde num relance.
 */
export function OperationStrip({ signals }: { readonly signals: readonly OperationSignal[] }) {
  return (
    <section
      aria-label="Estado da operação agora"
      className="grid grid-cols-2 gap-px overflow-hidden border-y border-line bg-line md:grid-cols-4"
    >
      {signals.map((signal) => {
        const body = (
          <>
            <span
              aria-hidden="true"
              className={cn('absolute inset-x-0 top-0 h-0.5', SEVERITY_RULE[signal.severity])}
            />
            <span className="text-meta font-medium tracking-tight text-muted">
              {signal.label}
            </span>
            <span
              className={cn(
                'font-display text-display leading-none font-bold tracking-tight tabular-nums',
                SEVERITY_TEXT[signal.severity],
              )}
            >
              {signal.value}
            </span>
            {signal.hint ? (
              <span className="text-meta text-dim">{signal.hint}</span>
            ) : null}
          </>
        );

        const shell = 'relative flex flex-col gap-1.5 bg-surface px-4 pt-4 pb-3.5';

        return signal.href ? (
          <Link
            key={signal.id}
            href={signal.href}
            className={cn(shell, 'transition-colors hover:bg-surface-2')}
          >
            {body}
          </Link>
        ) : (
          <div key={signal.id} className={shell}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
