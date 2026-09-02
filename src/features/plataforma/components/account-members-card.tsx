import { ShieldCheck, User } from 'lucide-react';

export interface AccountMember {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly roleSlug: string;
  readonly roleName: string;
  readonly availability: string;
  readonly joinedAt: string;
  readonly lastActiveAt?: string;
}

const TOM_DO_PAPEL: Readonly<Record<string, string>> = {
  administrador: 'border-brand/30 bg-brand/10 text-brand',
  supervisor: 'border-violet-500/30 bg-violet-500/10 text-violet-600',
  colaborador: 'border-line bg-surface-2 text-muted',
};

const data = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(iso));

/**
 * Todo mundo que alcança a conta, num lugar só.
 *
 * Somente leitura, de propósito. Mexer em quem entra e em qual papel cada um
 * tem é o trabalho do administrador do cliente, na tela de equipe dele — e essa
 * tela já existe, com as travas certas (não deixar a conta sem administrador,
 * supervisor não alcançar administrador). Reimplementar isso aqui criaria um
 * segundo caminho para a mesma decisão, livre para divergir do primeiro na
 * próxima regra que alguém acrescentar de um lado só.
 *
 * Quando o superadministrador precisa mesmo alterar um acesso, ele entra na
 * conta — onde usa a tela do cliente, com as travas do cliente, e a auditoria
 * registra que foi a plataforma quem fez.
 */
export function AccountMembersCard({ members }: { readonly members: readonly AccountMember[] }) {
  const admins = members.filter((m) => m.roleSlug === 'administrador').length;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-sm font-bold text-ink">Membros</h2>
          <p className="text-[11px] text-muted">
            {members.length} pessoa(s), {admins} com acesso de administrador.
          </p>
        </div>
        <p className="text-[11px] text-dim">
          Para alterar acessos, entre na conta e use a tela de equipe.
        </p>
      </div>

      {members.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted">
          Nenhuma pessoa vinculada a esta conta.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {members.map((membro) => (
            <li key={membro.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-dim">
                {membro.roleSlug === 'administrador' ? (
                  <ShieldCheck className="size-4" />
                ) : (
                  <User className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{membro.name}</p>
                <p className="truncate text-[11px] text-muted">{membro.email}</p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  TOM_DO_PAPEL[membro.roleSlug] ?? 'border-line bg-surface-2 text-muted'
                }`}
              >
                {membro.roleName}
              </span>
              <div className="shrink-0 text-right text-[11px] text-dim">
                <p>Desde {data(membro.joinedAt)}</p>
                <p>{membro.lastActiveAt ? `Ativo ${membro.lastActiveAt}` : 'Nunca entrou'}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
