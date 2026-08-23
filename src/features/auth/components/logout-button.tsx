'use client';

import { useTransition } from 'react';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { logoutAction } from '@/app/(auth)/actions';

/**
 * Sair.
 *
 * A ação roda no servidor: é lá que o cookie é apagado e a sessão marcada como
 * revogada. Limpar só o cookie no cliente deixaria o token válido — quem o
 * tivesse copiado continuaria dentro.
 */
export function LogoutButton({
  variant = 'icone',
  className,
}: {
  readonly variant?: 'icone' | 'linha';
  readonly className?: string;
}) {
  const [pending, startTransition] = useTransition();

  const sair = () => startTransition(() => void logoutAction());

  if (variant === 'linha') {
    return (
      <button
        type="button"
        onClick={sair}
        disabled={pending}
        className={cn(
          'flex items-center gap-3 rounded-control px-3 py-2.5 text-ui text-muted transition-colors hover:bg-surface-2 hover:text-red-text disabled:opacity-60',
          className,
        )}
      >
        <LogOut className="size-[18px] shrink-0" />
        {pending ? 'Saindo…' : 'Sair da conta'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={sair}
      disabled={pending}
      title="Sair da conta"
      aria-label="Sair da conta"
      className={cn(
        'flex size-9 items-center justify-center rounded-control text-dim transition-colors hover:bg-red-soft hover:text-red-text disabled:opacity-60',
        className,
      )}
    >
      <LogOut className="size-[18px]" />
    </button>
  );
}
