import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Não encontrado dentro do workspace.
 *
 * Fica no grupo `(workspace)` de propósito: o usuário mantém a navigation rail
 * e continua dentro do produto, em vez de cair numa página órfã sem saída.
 */
export default function WorkspaceNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-app p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-surface bg-surface-2 text-dim">
        <SearchX className="size-6" />
      </span>
      <h1 className="font-display text-metric font-bold tracking-tight text-ink">
        Não encontramos o que você procurava
      </h1>
      <p className="max-w-sm text-body text-muted">
        O registro pode ter sido removido, resolvido por outro atendente ou o endereço está
        incorreto.
      </p>
      <Link href="/conversas" className="mt-1">
        <Button size="sm">Ir para a caixa de entrada</Button>
      </Link>
    </main>
  );
}
