'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { loginAction } from '@/app/(auth)/actions';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // O middleware guarda o destino em `proximo` para devolver a pessoa ao lugar
  // de onde ela foi barrada, em vez de despejá-la sempre no painel.
  const next = params.get('proximo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        // `refresh` antes de navegar: sem ele o Next serve o layout do cache,
        // renderizado quando ainda não havia sessão.
        router.refresh();
        router.push((next && next.startsWith('/') ? next : '/dashboard') as Route);
      } else {
        setError(res.error ?? 'Email ou senha inválidos.');
        setLoading(false);
      }
    } catch {
      setError('Ocorreu um erro ao tentar entrar.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-display font-bold text-ink">Entrar</h2>
        <p className="mt-1 text-ui text-muted">
          Acesse sua conta para continuar o atendimento.
        </p>
      </div>

      {error ? (
        <div className="flex items-center gap-2.5 rounded-control border border-red-line bg-red-soft p-3 text-body text-red-text">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="login-email">
          <TextInput
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="você@empresa.com"
            autoComplete="email"
          />
        </Field>

        <Field label="Senha" htmlFor="login-password">
          <div className="relative">
            <TextInput
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-dim hover:text-ink transition-colors"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between text-body">
          <label className="flex items-center gap-2 cursor-pointer text-muted">
            <input type="checkbox" defaultChecked className="accent-brand rounded" />
            <span>Lembrar de mim</span>
          </label>
          <Link
            href="/recuperar-senha"
            className="font-semibold text-brand hover:underline"
          >
            Esqueci minha senha
          </Link>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 w-full justify-center h-10 text-title"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </Button>
      </form>

      <div className="mt-2 text-center text-body text-muted">
        Ainda não tem conta?{' '}
        <Link href="/cadastro" className="font-semibold text-brand hover:underline">
          Criar conta grátis
        </Link>
      </div>
    </div>
  );
}
