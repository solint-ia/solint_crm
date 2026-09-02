import { CheckCircle2, PauseCircle, Trash2 } from 'lucide-react';

/**
 * O estado da conta, com forma além da cor.
 *
 * Cada estado leva ícone próprio porque a diferença entre suspensa e excluída
 * decide o que a pessoa vai clicar em seguida, e distinguir só por matiz falha
 * para quem não separa âmbar de vermelho — numa tela cuja função é evitar o
 * clique errado.
 */
const ESTADOS = {
  ativa: {
    label: 'Ativa',
    icone: CheckCircle2,
    classe: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  },
  suspensa: {
    label: 'Suspensa',
    icone: PauseCircle,
    classe: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  },
  excluida: {
    label: 'Excluída',
    icone: Trash2,
    classe: 'border-rose-500/30 bg-rose-500/10 text-rose-600',
  },
} as const;

export function AccountStatusBadge({ status }: { readonly status: string }) {
  // Um estado desconhecido no banco não deve sumir da tela: mostrar o valor cru
  // é como se descobre que uma migração deixou lixo para trás.
  const estado = ESTADOS[status as keyof typeof ESTADOS];
  if (!estado) {
    return (
      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted">
        {status}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${estado.classe}`}
    >
      <estado.icone className="size-3" />
      {estado.label}
    </span>
  );
}
