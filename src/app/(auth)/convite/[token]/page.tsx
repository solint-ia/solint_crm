import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthSplitLayout } from '@/features/auth/components/auth-split-layout';
import { AcceptInviteForm } from '@/features/auth/components/accept-invite-form';
import { readInvite } from '@/infrastructure/auth/invites';

export const metadata: Metadata = { title: 'Convite · Solint CRM' };

// O token vem da URL e o convite é consultado no banco: nada aqui pode ser
// resolvido em tempo de build.
export const dynamic = 'force-dynamic';

/**
 * Aceite de convite.
 *
 * Pública de propósito — quem chega aqui ainda não tem sessão nesta empresa. O
 * que protege a página é o próprio token: 32 bytes aleatórios, guardado no
 * banco só como hash, com validade de sete dias e uso único.
 */
export default async function ConvitePage({
  params,
}: {
  readonly params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await readInvite(token);

  // Inexistente, expirado e já usado dão a mesma resposta. Distinguir os casos
  // diria a quem tem o link se ele um dia existiu.
  if (!invite) {
    return (
      <AuthSplitLayout>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            Convite indisponível
          </h2>
          <p className="text-sm text-slate-500">
            Este link não é mais válido. Convites expiram em sete dias e só podem ser usados uma
            vez — peça um novo ao gestor da conta.
          </p>
          <Link
            href="/login"
            className="text-sm font-medium text-slate-900 underline underline-offset-4"
          >
            Ir para o login
          </Link>
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout>
      <AcceptInviteForm
        token={token}
        email={invite.email}
        accountName={invite.accountName}
        userExists={invite.userExists}
      />
    </AuthSplitLayout>
  );
}
