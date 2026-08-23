import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

const CONTROL_BASE =
  'w-full rounded-control border border-line bg-surface px-3.5 text-ui text-ink outline-none transition-all duration-150 placeholder:text-dim/75 focus:border-brand focus:ring-2 focus:ring-brand/15 shadow-2xs disabled:bg-surface-2 disabled:text-dim';

interface FieldProps {
  readonly label: string;
  readonly htmlFor?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-meta font-semibold text-muted tracking-tight">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-meta font-medium text-red-text">
          {error}
        </p>
      ) : hint ? (
        <p className="text-meta text-dim leading-normal">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_BASE, 'h-9.5', className)} {...rest} />;
}

export function TextArea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL_BASE, 'py-2.5 leading-relaxed', className)} {...rest} />;
}

/**
 * Select nativo com a mesma casca dos demais controles.
 * Nativo de propósito: no celular abre a roleta do sistema, que é melhor que
 * qualquer lista customizada, e chega de graça acessível pelo teclado.
 */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL_BASE, 'h-9.5 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
}
