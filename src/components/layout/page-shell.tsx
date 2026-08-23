import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Container padrão de conteúdo com rolagem propria (a janela nunca rola). */
export function PageShell({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <main className={cn('flex-1 overflow-auto bg-app p-4 md:p-6', className)}>
      <div className="mx-auto w-full max-w-[1400px]">{children}</div>
    </main>
  );
}
