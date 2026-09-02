import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { readSuperAdmin } from '@/infrastructure/auth/session';
import { logoutAction } from '@/app/(auth)/actions';

export const metadata: Metadata = {
  title: { default: 'Plataforma', template: '%s · Plataforma Solint' },
};

/**
 * Área do superadministrador — fora do CRM, de propósito.
 *
 * Não é um grupo de rotas do workspace com uma permissão a mais: é outro
 * produto, com outro público (uma pessoa) e outro escopo (todas as contas).
 * Por isso não herda `NavigationRail`/`Topbar` — nenhum item daquela barra faz
 * sentido aqui, e reaproveitá-la sugeriria que esta tela pertence a alguma
 * conta em particular.
 *
 * A guarda mora no layout e não em cada página: uma página nova criada depois
 * já nasce protegida, em vez de depender de alguém lembrar de copiar a
 * checagem. O `readSuperAdmin()` é memorizado por requisição, então repeti-lo
 * numa página filha que precise do nome não custa uma segunda ida ao banco.
 */
export default async function PlatformLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const admin = await readSuperAdmin();
  // Quem não é superadministrador não recebe "acesso negado": recebe o CRM.
  // Dizer "existe uma área aqui, você não entra" é informação que ninguém de
  // fora precisa ter.
  if (!admin) redirect('/conversas');

  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <Link href="/plataforma" className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <span className="block font-display text-sm font-bold text-ink">
              Plataforma Solint
            </span>
            <span className="block truncate text-[11px] text-muted">
              Contas, acessos e integrações de todos os clientes
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <span className="hidden truncate text-xs text-muted sm:block">{admin.email}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Sair
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}
