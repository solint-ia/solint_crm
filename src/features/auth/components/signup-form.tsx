'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Building,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react';
import { MIN_PASSWORD_LENGTH, STRONG_PASSWORD_LENGTH } from '@/core/domain/user';
import { signupAction } from '@/app/(auth)/actions';
import { cn } from '@/lib/cn';

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Um botão só governa os dois campos.
   *
   * Confirmar senha existe para pegar erro de digitação, e quem está vendo o
   * que digita consegue conferir os dois de uma vez. Dois botões separados
   * deixariam mostrar um e esconder o outro — o estado em que a conferência
   * não serve para nada.
   */
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const getStrength = (pwd: string) => {
    if (pwd.length === 0) return 0;
    if (pwd.length < 6) return 1;
    if (pwd.length < STRONG_PASSWORD_LENGTH) return 2;
    return 3;
  };

  const strength = getStrength(password);
  const strengthLabels = ['', 'Fraca', 'Média', 'Forte'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    // O `required` do HTML garante que os dois foram preenchidos; a igualdade
    // é nossa. Barrar aqui evita criar a conta com a senha que a pessoa não
    // quis — e que ela não conseguiria mais adivinhar para entrar.
    if (password !== confirmPassword) {
      setError('As senhas não conferem. Digite a mesma senha nos dois campos.');
      return;
    }

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
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-10 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-confirm-password" className="text-xs font-semibold text-slate-700">
            Confirmar senha
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <ShieldCheck className="size-4" />
            </div>
            <input
              id="signup-confirm-password"
              type={showPassword ? 'text' : 'password'}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? 'signup-confirm-error' : undefined}
              placeholder="Repita a senha"
              className={cn(
                'w-full rounded-xl border bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:bg-white focus:ring-4',
                mismatch
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500/10'
                  : 'border-slate-200 focus:border-blue-600 focus:ring-blue-600/10',
              )}
            />
          </div>

          {/* O aviso aparece enquanto se digita, não só depois de enviar: quem
              errou uma letra descobre na hora, e não ao voltar do servidor. */}
          {mismatch && (
            <span id="signup-confirm-error" className="text-[11px] font-semibold text-red-600">
              As senhas não conferem.
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || mismatch}
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
