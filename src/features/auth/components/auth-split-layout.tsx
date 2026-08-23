import Image from 'next/image';
import Link from 'next/link';
import { Bot, MessageSquareText, TrendingUp } from 'lucide-react';
import { InboxVignette } from './inbox-vignette';

interface AuthSplitLayoutProps {
  readonly children: React.ReactNode;
}

/** Provas curtas, em linguagem de operação — não adjetivos de marketing. */
const PROOFS = [
  { icon: MessageSquareText, label: 'WhatsApp, Instagram, e-mail e webchat numa fila só' },
  { icon: Bot, label: 'Agentes de IA que sabem a hora de chamar um humano' },
  { icon: TrendingUp, label: 'Funil, SLA e satisfação medidos no mesmo lugar' },
] as const;

/**
 * Casca das telas de entrada.
 *
 * Antes eram duas metades: gradiente de marca em 44% da largura e o fundo claro
 * do app no resto, com uma emenda vertical dura no meio. Agora é **uma
 * superfície só** — o gradiente atravessa a página na diagonal e o formulário
 * flutua sobre ele em vidro. O que separa marca de formulário passou a ser
 * elevação e desfoque, não uma linha onde a cor troca.
 *
 * O escopo de tokens em `.auth-shell` (ver `globals.css`) faz os mesmos
 * componentes de formulário do produto renderizarem em modo escuro aqui, sem
 * que nenhum deles tenha sido alterado.
 */
export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="auth-shell relative flex min-h-screen w-full flex-col overflow-hidden lg:flex-row">
      <div className="auth-grid" />
      <div className="auth-aurora" />

      {/* ---------- Marca ---------- */}
      <section className="relative flex flex-col justify-between gap-10 px-6 pt-10 pb-6 lg:w-[54%] lg:px-14 lg:py-12 xl:px-20">
        <Link
          href="/login"
          aria-label="Solint CRM"
          className="auth-rise inline-flex w-fit items-center transition-opacity hover:opacity-85"
          style={{ animationDelay: '60ms' }}
        >
          <Image
            src="/logo.png"
            alt="Solint CRM"
            width={2246}
            height={600}
            priority
            className="auth-logo h-7 w-auto lg:h-9"
          />
        </Link>

        <div className="flex flex-col gap-7">
          <div>
            <p
              className="auth-rise font-mono text-micro tracking-[0.22em] text-cyan-200/80 uppercase"
              style={{ animationDelay: '160ms' }}
            >
              Solint CRM · atendimento omnichannel
            </p>

            <h1
              className="auth-rise mt-3 max-w-[16ch] font-display text-display leading-[1.05] font-bold tracking-tight text-white lg:text-hero"
              style={{ animationDelay: '240ms' }}
            >
              Nenhuma conversa
              <span className="block bg-gradient-to-r from-cyan-200 via-sky-200 to-white bg-clip-text text-transparent">
                fica sem resposta.
              </span>
            </h1>

            <p
              className="auth-rise mt-4 max-w-md text-ui leading-relaxed text-sky-100/75"
              style={{ animationDelay: '320ms' }}
            >
              Toda mensagem que chega vira um atendimento com dono, prazo e histórico. O resto —
              funil, campanhas, relatórios — nasce daí.
            </p>
          </div>

          <ul className="auth-rise flex flex-col gap-2.5" style={{ animationDelay: '400ms' }}>
            {PROOFS.map((proof) => (
              <li key={proof.label} className="flex items-center gap-2.5 text-body text-sky-100/70">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-control border border-white/12 bg-white/6">
                  <proof.icon className="size-3 text-cyan-200" />
                </span>
                {proof.label}
              </li>
            ))}
          </ul>

          <div className="auth-rise hidden lg:block" style={{ animationDelay: '520ms' }}>
            <InboxVignette />
          </div>
        </div>

        <p className="auth-rise text-meta text-sky-100/45" style={{ animationDelay: '600ms' }}>
          © 2026 Solint CRM · Termos de uso · Privacidade
        </p>
      </section>

      {/* ---------- Formulário ---------- */}
      <section className="relative flex flex-1 items-center justify-center px-5 pt-2 pb-12 lg:px-10 lg:py-12">
        <div
          className="auth-rise auth-panel w-full max-w-[420px] rounded-float p-6 sm:p-8"
          style={{ animationDelay: '340ms' }}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
