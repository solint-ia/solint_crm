'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, Lock, Mail, User } from 'lucide-react';
import { acceptInviteAction } from '@/app/(auth)/convite/actions';

interface AcceptInviteFormProps {
  readonly token: string;
  readonly email: string;
  readonly accountName: string;
  /**
   * A pessoa já tem cadastro no sistema?
   *
   * Muda o formulário inteiro: quem já tem prova quem é com a senha que já usa
   * e só ganha o vínculo com a empresa nova; quem não tem escolhe nome e senha
   * agora. É a mesma identidade atendendo em dois lugares — o e-mail é único no
   * sistema, e o seletor de workspace passa a mostrar as duas empresas.
   */
  readonly userExists: boolean;
}

export function AcceptInviteForm({
  token,
  email,
  accountName,
  userExists,
}: AcceptInviteFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await acceptInviteAction({
        token,
        password,
        ...(userExists ? {} : { name }),
      });
      if (res.ok) {
        router.refresh();
        router.push('/conversas');
        return;
      }
      setError(res.error ?? 'Não foi possível aceitar o convite.');
      setLoading(false);
    } catch {
      setError('Ocorreu um erro ao aceitar o convite.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          {userExists ? `Entrar em ${accountName}` : `Bem-vindo à ${accountName}`}
        </h2>
        <p className="mt-1.5 text-sm text-slate-500">
          {userExists
            ? 'Você já tem uma conta. Confirme sua senha para atender também nesta empresa.'
            : 'Defina seu nome e uma senha para acessar sua caixa de entrada.'}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/*
          E-mail travado, e não um campo editável.
          Ele vem do convite: quem o criou escolheu quem entra. Deixá-lo editável
          permitiria a qualquer pessoa com o link redirecionar o acesso para si.
        */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">E-mail</label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="email"
              value={email}
              readOnly
              aria-readonly="true"
              className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-500"
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">Definido pelo convite.</p>
        </div>

        {!userExists && (
          <div>
            <label htmlFor="convite-nome" className="mb-1.5 block text-sm font-medium text-slate-700">
              Seu nome
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="convite-nome"
                type="text"
                required
                autoComplete="name"
                placeholder="Como você aparece para a equipe"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="convite-senha" className="mb-1.5 block text-sm font-medium text-slate-700">
            {userExists ? 'Sua senha atual' : 'Crie uma senha'}
          </label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="convite-senha"
              type="password"
              required
              autoComplete={userExists ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              {userExists ? 'Entrar' : 'Criar acesso'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
