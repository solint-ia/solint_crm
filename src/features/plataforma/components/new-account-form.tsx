'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { AlertCircle, Loader2 } from 'lucide-react';
import { MIN_PASSWORD_LENGTH } from '@/core/domain/user';
import { createAccountAction } from '@/app/(platform)/plataforma/account-actions';

const campo =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink placeholder:text-dim outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20';
const rotulo = 'text-[11px] font-semibold text-muted';

/**
 * Criar a empresa e o primeiro administrador dela, na mesma tela.
 *
 * Os dois num formulário só porque são uma decisão só: uma conta sem
 * administrador não abre para ninguém, e separar em duas etapas produziria
 * exatamente esse estado intermediário inútil, esperando alguém lembrar da
 * segunda metade.
 */
export function NewAccountForm() {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string>();

  const enviar = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    setErro(undefined);

    startTransition(async () => {
      const resultado = await createAccountAction({
        name: String(dados.get('name') ?? ''),
        document: String(dados.get('document') ?? ''),
        adminName: String(dados.get('adminName') ?? ''),
        adminEmail: String(dados.get('adminEmail') ?? ''),
        adminPassword: String(dados.get('adminPassword') ?? ''),
      });

      if (!resultado.ok || !resultado.accountId) {
        setErro(resultado.error ?? 'Não foi possível criar a conta.');
        return;
      }
      // Direto para a ficha da conta nova: é de lá que sai o próximo passo
      // (parear o WhatsApp, conferir os membros), e voltar para a lista faria a
      // pessoa procurar de novo o que ela acabou de criar.
      router.push(`/plataforma/${resultado.accountId}` as Route);
    });
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-2xs">
        <h2 className="font-display text-sm font-bold text-ink">A empresa</h2>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Nome do workspace</span>
          <input name="name" required maxLength={60} placeholder="Ex.: Solint Engenharia" className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>CNPJ (opcional)</span>
          <input name="document" maxLength={24} placeholder="00.000.000/0001-00" className={campo} />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-2xs">
        <div>
          <h2 className="font-display text-sm font-bold text-ink">O administrador</h2>
          <p className="text-[11px] text-muted">
            Esta pessoa entra com acesso total à conta e é quem cadastra supervisores e
            colaboradores lá dentro.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Nome completo</span>
          <input name="adminName" required minLength={2} maxLength={120} className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>E-mail de acesso</span>
          <input name="adminEmail" type="email" required maxLength={160} className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Senha inicial</span>
          <input
            name="adminPassword"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
            className={campo}
          />
          {/* Dito aqui porque é a única chance: a senha não fica recuperável do
              lado de cá, e quem cria precisa saber que tem de repassá-la. */}
          <span className="text-[11px] text-dim">
            Anote e repasse ao cliente. Ele pode trocá-la no perfil depois de entrar.
          </span>
        </label>
      </section>

      {erro ? (
        <p className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-600">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pendente}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
      >
        {pendente ? <Loader2 className="size-4 animate-spin" /> : null}
        Criar conta
      </button>
    </form>
  );
}
