import Image from 'next/image';
import Link from 'next/link';

interface AuthSplitLayoutProps {
  readonly children: React.ReactNode;
}

/**
 * A casca das telas de entrada (login e recuperar senha).
 *
 * **A partir de `xl` (1280 px)** a ilustração da marca ocupa a tela inteira e
 * carrega sozinha o lado esquerdo: logo, WhatsApp, agente de IA e automação.
 * O cartão fica no terço direito, que na imagem é só um brilho azul, então ele
 * nunca cobre nada. A imagem é encaixada inteira (`contain`), ancorada à
 * esquerda: numa tela mais alta sobra faixa em cima e embaixo, numa mais larga
 * sobra à direita, e em nenhum caso a logo é cortada. O fundo da `.auth-backdrop`
 * repete as cores das bordas da imagem para as faixas não aparecerem.
 *
 * O limite em `xl`, e não em `lg`, é conta: os ícones da ilustração vão até
 * ~64% da largura, e abaixo de 1280 px o cartão passaria por cima deles.
 *
 * **Abaixo de `xl`** a ilustração sai de cena (ela não cabe ao lado de um
 * formulário em tela estreita) e fica o gradiente com a logo acima do cartão.
 */
export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="auth-shell relative flex min-h-screen w-full flex-col overflow-hidden xl:flex-row">
      {/* Iluminação ambiente, só onde não há ilustração: sobre ela lavaria as cores. */}
      <div className="auth-aurora xl:hidden" />

      <div
        aria-hidden="true"
        className="auth-backdrop pointer-events-none fixed inset-0 z-0 hidden xl:block"
      >
        <div className="auth-backdrop-art">
          <Image
            src="/solint-crm-login-background.png"
            alt=""
            fill
            priority
            // Abaixo de xl a imagem está escondida: `1px` faz o navegador baixar
            // a menor versão, em vez de gastar o 4G de quem entra pelo celular.
            sizes="(min-width: 1280px) 100vw, 1px"
            className="object-cover"
          />
        </div>
      </div>

      {/* A logo e o nome estão dentro da imagem, que leitor de tela não lê. */}
      <h1 className="sr-only">Solint CRM · Atendimento e vendas pelo WhatsApp</h1>

      {/* ---------- Abaixo de xl: a logo acima do cartão ---------- */}
      <header className="relative z-10 flex justify-center px-6 pt-10 xl:hidden">
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
            className="h-12 w-auto drop-shadow-md sm:h-14"
          />
          <span className="hidden rounded-full border border-white/20 bg-white/10 px-3.5 py-1 text-xs font-semibold tracking-wide text-sky-100 shadow-sm sm:inline-flex">
            Para Empresas
          </span>
        </Link>
      </header>

      {/* ---------- xl: a coluna da ilustração, vazia de propósito ---------- */}
      <div className="hidden xl:block xl:flex-1" />

      {/* ---------- O cartão ---------- */}
      <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-4 py-10 sm:px-8 xl:w-[34%] xl:flex-none xl:px-4">
        <div className="auth-panel w-full max-w-[440px] xl:max-w-[400px] 2xl:max-w-[440px]">
          {children}
        </div>
        {/* Só sobre a ilustração: no gradiente do celular o rodapé cairia na
            parte clara e sumiria. */}
        <p className="hidden text-xs text-white/85 drop-shadow-sm xl:block">
          © 2026 Solint CRM · Todos os direitos reservados
        </p>
      </section>
    </div>
  );
}
