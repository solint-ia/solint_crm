'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Fronteira de erro global.
 * Nunca exibe stack trace ao usuário: detalhes vao para o observability do servidor.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('[solint-crm] erro não tratado', { digest: error.digest });
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-display font-semibold text-ink">Algo deu errado</h1>
      <p className="max-w-sm text-ui text-muted">
        Não conseguimos carregar esta tela. Tente novamente; se o erro persistir, acione o suporte
        informando o codigo abaixo.
      </p>
      {error.digest ? <code className="font-mono text-body text-dim">{error.digest}</code> : null}
      <Button className="mt-2" onClick={reset}>
        Tentar novamente
      </Button>
    </main>
  );
}
