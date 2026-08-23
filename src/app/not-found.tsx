import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-mono text-body text-dim">404</p>
      <h1 className="font-display text-display font-semibold text-ink">Página não encontrada</h1>
      <p className="max-w-sm text-ui text-muted">
        O endereço acessado não existe ou foi movido. Volte para a caixa de entrada e continue o
        atendimento.
      </p>
      <Link href="/conversas" className="mt-2">
        <Button>Ir para a caixa de entrada</Button>
      </Link>
    </main>
  );
}
