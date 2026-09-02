import { Building2, Inbox, MessagesSquare, Send, Users } from 'lucide-react';

interface AccountOverviewProps {
  readonly plan: string;
  readonly document?: string;
  readonly createdAt: string;
  readonly lastActivityAt?: string;
  readonly numeros: {
    readonly membros: number;
    readonly caixas: number;
    readonly contatos: number;
    readonly conversas: number;
    readonly mensagens: number;
  };
}

const data = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(iso));

const dataHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * O tamanho da conta em cinco números.
 *
 * Serve a uma pergunta prática: esta conta está sendo usada? Uma empresa com
 * três caixas e nenhuma mensagem é um cadastro abandonado; a mesma empresa com
 * quarenta mil mensagens é um cliente em produção, e as duas exigem decisões
 * opostas de quem está prestes a suspendê-la. A última atividade é o número que
 * resolve a dúvida quando os outros não resolvem.
 */
export function AccountOverview({
  plan,
  document,
  createdAt,
  lastActivityAt,
  numeros,
}: AccountOverviewProps) {
  const cartoes = [
    { label: 'Pessoas', valor: numeros.membros, icone: Users },
    { label: 'Caixas', valor: numeros.caixas, icone: Inbox },
    { label: 'Contatos', valor: numeros.contatos, icone: Building2 },
    { label: 'Conversas', valor: numeros.conversas, icone: MessagesSquare },
    { label: 'Mensagens', valor: numeros.mensagens, icone: Send },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cartoes.map((cartao) => (
          <div
            key={cartao.label}
            className="rounded-2xl border border-line bg-surface p-4 shadow-2xs"
          >
            <cartao.icone className="size-4 text-brand" />
            <p className="mt-2 font-display text-lg font-bold tabular-nums text-ink">
              {cartao.valor.toLocaleString('pt-BR')}
            </p>
            <p className="text-[11px] text-muted">{cartao.label}</p>
          </div>
        ))}
      </div>

      <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line text-xs sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
          <dt className="text-muted">Plano</dt>
          <dd className="font-semibold capitalize text-ink">{plan}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
          <dt className="text-muted">CNPJ</dt>
          <dd className="font-mono text-ink">{document || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
          <dt className="text-muted">Criada em</dt>
          <dd className="text-ink">{data(createdAt)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
          <dt className="text-muted">Última atividade</dt>
          <dd className="text-ink">
            {lastActivityAt ? dataHora(lastActivityAt) : 'Nenhuma conversa ainda'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
