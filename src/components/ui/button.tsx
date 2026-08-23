import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-xs active:scale-[0.98]',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2 shadow-xs active:scale-[0.98]',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink active:scale-[0.98]',
  gradient: 'bg-brand-gradient text-white shadow-sm hover:opacity-95 active:scale-[0.98]',
  danger: 'bg-red-soft text-red-text border border-red-line/50 hover:bg-red-soft/80 active:scale-[0.98]',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-body gap-1.5',
  md: 'h-9.5 px-4 text-ui gap-2',
  lg: 'h-11 px-5 text-ui gap-2.5',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: keyof typeof VARIANTS;
  readonly size?: keyof typeof SIZES;
  readonly icon?: ReactNode;
  readonly fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold tracking-tight transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
