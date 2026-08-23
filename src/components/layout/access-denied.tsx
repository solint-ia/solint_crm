import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import type { Permission } from '@/core/domain/user';
import { Button } from '@/components/ui/button';

/**
 * Tela de acesso negado.
 *
 * Não é `notFound()` de propósito. "Não encontramos esta página" mentiria: a
 * página existe, quem está pedindo é que não alcança. Dizer a verdade evita
 * que a pessoa fique procurando um link quebrado que não existe — e o nome da
 * permissão dá ao administrador exatamente o que conceder.
 */
export function AccessDenied({ permission }: { readonly permission: Permission }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-app p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-surface bg-surface-2 text-dim">
        <ShieldOff className="size-6" />
      </span>
      <h1 className="font-display text-metric font-bold tracking-tight text-ink">
        Seu papel não alcança esta tela
      </h1>
      <p className="max-w-sm text-body text-muted">
        É preciso a permissão{' '}
        <code className="rounded-control bg-surface-2 px-1.5 py-0.5 font-mono text-meta text-ink">
          {permission}
        </code>
        . Peça a um administrador da conta.
      </p>
      <Link href="/conversas" className="mt-1">
        <Button size="sm">Ir para a caixa de entrada</Button>
      </Link>
    </main>
  );
}
