import Image from 'next/image';
import Link from 'next/link';
import { AbstractGraphic } from './abstract-graphic';

interface AuthSplitLayoutProps {
  readonly children: React.ReactNode;
}

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="auth-shell relative flex min-h-screen w-full flex-col overflow-hidden lg:flex-row">
      {/* Iluminação ambiente suave */}
      <div className="auth-aurora" />

      {/* ---------- Lado Esquerdo: Branding Institucional & Tecnologia ---------- */}
      <section className="relative z-10 flex flex-col justify-between gap-10 px-6 pt-10 pb-8 lg:w-[52%] lg:px-14 lg:py-14 xl:px-20">
        <div>
          {/* Logotipo Solint com escala ampliada e grande presença */}
          <Link
            href="/login"
            aria-label="Solint CRM"
            className="inline-flex items-center gap-4 transition-opacity hover:opacity-90"
          >
            <Image
              src="/logo.png"
              alt="Solint CRM"
              width={2246}
              height={600}
              priority
              className="h-14 w-auto sm:h-16 lg:h-20 drop-shadow-md transition-all"
            />
            <span className="hidden sm:inline-flex rounded-full border border-white/20 bg-white/10 px-3.5 py-1 text-xs font-semibold text-sky-100 tracking-wide shadow-sm">
              Para Empresas
            </span>
          </Link>
        </div>

        <div className="flex flex-col gap-8 my-auto max-w-xl">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300 uppercase font-mono">
              Solint CRM · Atendimento & Vendas
            </p>

            <h1 className="mt-4 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.14]">
              Conecte sua operação.
              <span className="block mt-1 bg-gradient-to-r from-cyan-200 via-sky-200 to-white bg-clip-text text-transparent">
                Potencialize seus resultados.
              </span>
            </h1>

            <p className="mt-4 text-sm sm:text-base leading-relaxed text-sky-100/85">
              A plataforma completa para centralizar conversas do WhatsApp, organizar o contato com seus clientes e acelerar as vendas da sua equipe em um único lugar.
            </p>
          </div>

          {/* Gráfico abstrato estático com termos claros */}
          <div className="hidden lg:block">
            <AbstractGraphic />
          </div>
        </div>

        <div className="text-xs text-sky-200/60">
          © 2026 Solint CRM · Todos os direitos reservados
        </div>
      </section>

      {/* ---------- Lado Direito: Card Branco Centralizado com Formulário ---------- */}
      <section className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:px-12 lg:py-16">
        <div className="auth-panel w-full max-w-[440px]">
          {children}
        </div>
      </section>
    </div>
  );
}
