'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Eye, EyeOff, Lock, Mail, Loader2, ArrowRight } from 'lucide-react';
import { loginAction } from '@/app/(auth)/actions';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('proximo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await loginAction({ email, password });
      if (res.ok) {
        router.refresh();
        router.push((next && next.startsWith('/') ? next : '/dashboard') as Route);
      } else {
        setError(res.error ?? 'Email ou senha inválidos.');
        setLoading(false);
      }
    } catch {
      setError('Ocorreu um erro ao tentar entrar. Verifique sua conexão.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Cabeçalho do formulário */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          Acesse sua conta
        </h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Entre com suas credenciais para acessar a plataforma.
        </p>
      </div>

      {/* Alerta de erro */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="size-4 shrink-0 text-red-500 mt-0.5" />
          <span className="font-medium leading-relaxed">{error}</span>
        </div>
      )}

      {/* Formulário */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Campo E-mail */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-email" className="text-xs font-semibold text-slate-700">
            E-mail de acesso
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Mail className="size-4" />
            </div>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu.email@empresa.com"
              autoComplete="email"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-3.5 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
          </div>
        </div>

        {/* Campo Senha */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-xs font-semibold text-slate-700">
              Senha
            </label>
            <Link
              href="/recuperar-senha"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              Esqueci a senha
            </Link>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Lock className="size-4" />
            </div>
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-10 pl-9 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Lembrar de mim */}
        <div className="flex items-center">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Lembrar meus dados neste dispositivo</span>
          </label>
        </div>

        {/* Botão de Entrar */}
        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:from-blue-700 hover:to-indigo-800 hover:shadow-blue-600/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Entrando...</span>
            </>
          ) : (
            <>
              <span>Entrar na plataforma</span>
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      {/* Rodapé do card */}
      <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
        Não possui uma conta?{' '}
        <Link
          href="/cadastro"
          className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
        >
          Criar conta grátis
        </Link>
      </div>
    </div>
  );
}
