'use client';

import { useEffect, useReducer } from 'react';
import { Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * O produto se demonstrando na tela de entrada.
 *
 * A alternativa óbvia aqui seria a de sempre: manchas coloridas flutuando. Elas
 * não dizem nada — servem a um CRM, a um banco e a uma corretora de cripto sem
 * mudar um pixel. Esta vinheta mostra a única coisa que o Solint faz: mensagem
 * chega, alguém responde, a conversa fecha. Quem está na tela de login vê o
 * trabalho acontecendo antes de entrar.
 *
 * O laço é curto e volta ao início: é uma vinheta, não um vídeo. E quem pediu
 * menos movimento recebe o estado final direto, sem animação nenhuma.
 */

interface Turn {
  readonly id: number;
  readonly from: 'cliente' | 'agente';
  readonly name: string;
  readonly text: string;
  readonly time: string;
}

const TURNS: readonly Turn[] = [
  {
    id: 1,
    from: 'cliente',
    name: 'Mariana Costa',
    text: 'Oi! Meu pedido saiu para entrega?',
    time: '09:41',
  },
  {
    id: 2,
    from: 'agente',
    name: 'Camila · Suporte',
    text: 'Saiu sim, Mariana. Chega hoje até as 18h 🙂',
    time: '09:41',
  },
  {
    id: 3,
    from: 'cliente',
    name: 'Mariana Costa',
    text: 'Perfeito, obrigada!',
    time: '09:42',
  },
];

const STEP_MS = 1500;
const HOLD_MS = 2600;

type State = { readonly shown: number; readonly resolved: boolean };
type Action = { readonly type: 'avancar' } | { readonly type: 'resolver' } | { readonly type: 'reiniciar' };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'avancar':
      return { ...state, shown: Math.min(state.shown + 1, TURNS.length) };
    case 'resolver':
      return { ...state, resolved: true };
    case 'reiniciar':
      return { shown: 0, resolved: false };
  }
};

const prefersStill = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function InboxVignette() {
  const [state, dispatch] = useReducer(reducer, { shown: 0, resolved: false });

  useEffect(() => {
    if (prefersStill()) {
      dispatch({ type: 'avancar' });
      dispatch({ type: 'avancar' });
      dispatch({ type: 'avancar' });
      dispatch({ type: 'resolver' });
      return;
    }

    // Um único cronômetro por etapa, reagendado a cada mudança de estado:
    // um `setInterval` continuaria disparando durante a pausa final.
    const next = () => {
      if (state.shown < TURNS.length) return { delay: STEP_MS, action: 'avancar' as const };
      if (!state.resolved) return { delay: STEP_MS, action: 'resolver' as const };
      return { delay: HOLD_MS, action: 'reiniciar' as const };
    };

    const { delay, action } = next();
    const timer = setTimeout(() => dispatch({ type: action }), delay);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <figure
      className="m-0 w-full max-w-md rounded-float border border-white/12 bg-white/6 p-3.5 backdrop-blur-md"
      /* Decorativo: o texto real da promessa está no `h1` ao lado. */
      aria-hidden="true"
    >
      <header className="mb-3 flex items-center gap-2 px-1">
        <span className="auth-live-dot size-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-micro tracking-wider text-cyan-100/70 uppercase">
          Caixa de entrada · ao vivo
        </span>
        <span
          className={cn(
            'ml-auto rounded-control px-1.5 py-0.5 font-mono text-micro font-semibold transition-colors duration-500',
            state.resolved
              ? 'bg-emerald-400/15 text-emerald-300'
              : 'bg-amber-300/15 text-amber-200',
          )}
        >
          {state.resolved ? 'resolvida' : 'aguardando'}
        </span>
      </header>

      <div className="flex min-h-44 flex-col justify-end gap-2">
        {TURNS.slice(0, state.shown).map((turn) => {
          const mine = turn.from === 'agente';
          return (
            <div
              key={turn.id}
              className={cn('auth-bubble flex max-w-[85%] flex-col gap-0.5', mine && 'self-end')}
            >
              <span
                className={cn(
                  'px-1 font-mono text-micro text-white/45',
                  mine && 'self-end',
                )}
              >
                {turn.name}
              </span>
              <span
                className={cn(
                  'rounded-bubble px-3 py-2 text-body leading-relaxed',
                  mine
                    ? 'bg-brand/85 text-white shadow-lg shadow-brand/20'
                    : 'bg-white/10 text-white/90',
                )}
              >
                {turn.text}
              </span>
              <span
                className={cn(
                  'flex items-center gap-1 px-1 font-mono text-micro text-white/40',
                  mine && 'self-end',
                )}
              >
                {turn.time}
                {mine ? (
                  state.resolved ? (
                    <CheckCheck className="size-3 text-cyan-300" />
                  ) : (
                    <Check className="size-3" />
                  )
                ) : null}
              </span>
            </div>
          );
        })}

        {state.shown < TURNS.length ? (
          <span className="flex items-center gap-1 px-1 pb-1 text-micro text-white/40">
            <Dot delay={0} />
            <Dot delay={160} />
            <Dot delay={320} />
          </span>
        ) : null}
      </div>
    </figure>
  );
}

function Dot({ delay }: { readonly delay: number }) {
  return (
    <span
      className="auth-live-dot size-1 rounded-full bg-white/50"
      style={{ animationDelay: `${delay}ms`, animationDuration: '1.2s' }}
    />
  );
}
