import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Cabeçalho de seção de conteúdo.
 *
 * Substitui o card como recipiente padrão. Quando todo bloco da tela mora na
 * mesma caixa — mesma borda, mesma sombra, mesmo raio — a caixa deixa de
 * carregar informação. Aqui a hierarquia vem de um fio de 1px e do peso
 * tipográfico; o card fica reservado ao que é, de fato, uma unidade acionável.
 */
export function SectionTitle({
  title,
  hint,
  action,
  className,
}: {
  readonly title: string;
  /** Qualificador do título (período, recorte, unidade). */
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-3 flex items-baseline justify-between gap-3 border-b border-line pb-1.5',
        className,
      )}
    >
      <h2 className="font-display text-ui font-bold tracking-tight text-ink">
        {title}
        {hint ? <span className="ml-2 font-sans font-normal text-dim">{hint}</span> : null}
      </h2>
      {action}
    </div>
  );
}

/** Bloco de conteúdo com título. Separação por fio, não por moldura. */
export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={className}>
      <SectionTitle title={title} hint={hint} action={action} />
      {children}
    </section>
  );
}
