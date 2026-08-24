'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Building, Lock, Mail, User, Loader2 } from 'lucide-react';
import { signupAction } from '@/app/(auth)/actions';
import { cn } from '@/lib/cn';

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getStrength = (pwd: string) => {
    if (pwd.length === 0) return 0;
    if (pwd.length < 6) return 1;
    if (pwd.length < 10) return 2;
    return 3;
  };

  const strength = getStrength(password);
  const strengthLabels = ['', 'Fraca', 'Média', 'Forte'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await signupAction({ name, email, company, password });
      if (res.ok) {
        router.refresh();
        router.push('/onboarding');
      } else {
        setError(res.error ?? 'Erro ao criar conta.');
        setLoading(false);
      }
    } catch {
      setError('Ocorreu um erro ao processar o cadastro.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          Criar sua conta
        </h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Comece grátis, sem necessidade de cartão de crédito.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="size-4 shrink-0 text-red-500 mt-0.5" />
          <span className="font-medium leading-relaxed">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-name" className="text-xs font-semibold text-slate-700">
            Seu nome completo
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <User className="size-4" />
            </div>
            <input
              id="signup-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: João da Silva"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-email" className="text-xs font-semibold text-slate-700">
            E-mail de trabalho
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Mail className="size-4" />
            </div>
            <input
              id="signup-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-company" className="text-xs font-semibold text-slate-700">
            Nome da empresa
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Building className="size-4" />
            </div>
            <input
              id="signup-company"
              type="text"
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Ex: Acme Corp"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-password" className="text-xs font-semibold text-slate-700">
            Senha segura
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Lock className="size-4" />
            </div>
            <input
              id="signup-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              placeholder="Mínimo 10 caracteres"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
          </div>

          {password.length > 0 && (
            <div className="mt-1 flex items-center gap-1.5">
              <div
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= 1 ? 'bg-amber-500' : 'bg-slate-200',
                )}
              />
              <div
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= 2 ? 'bg-blue-600' : 'bg-slate-200',
                )}
              />
              <div
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= 3 ? 'bg-emerald-500' : 'bg-slate-200',
                )}
              />
              <span className="ml-1 text-[11px] font-semibold text-slate-500">
                {strengthLabels[strength]}
              </span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:from-blue-700 hover:to-indigo-800 hover:shadow-blue-600/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Criando conta...</span>
            </>
          ) : (
            <>
              <span>Criar conta e continuar</span>
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
        Já possui uma conta?{' '}
        <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">
          Entrar
        </Link>
      </div>
    </div>
  );
}
