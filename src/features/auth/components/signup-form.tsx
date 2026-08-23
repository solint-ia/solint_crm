'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
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
  const strengthLabels = ['', 'fraca', 'média', 'forte'];

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
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-display font-bold text-ink">Criar conta</h2>
        <p className="mt-1 text-ui text-muted">
          Comece grátis, sem necessidade de cartão de crédito.
        </p>
      </div>

      {error ? (
        <div className="rounded-control border border-red-line bg-red-soft p-3 text-body text-red-text">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <Field label="Seu nome" htmlFor="signup-name">
          <TextInput
            id="signup-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo"
          />
        </Field>

        <Field label="Email de trabalho" htmlFor="signup-email">
          <TextInput
            id="signup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="você@empresa.com"
          />
        </Field>

        <Field label="Nome da empresa" htmlFor="signup-company">
          <TextInput
            id="signup-company"
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Sua empresa"
          />
        </Field>

        <div>
          <Field label="Senha" htmlFor="signup-password">
            <TextInput
              id="signup-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              placeholder="Mínimo 10 caracteres, com letra e número"
            />
          </Field>

          {password.length > 0 ? (
            <div className="mt-2 flex items-center gap-1.5">
              <div
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= 1 ? 'bg-amber-text' : 'bg-surface-2',
                )}
              />
              <div
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= 2 ? 'bg-brand' : 'bg-surface-2',
                )}
              />
              <div
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  strength >= 3 ? 'bg-green-text' : 'bg-surface-2',
                )}
              />
              <span className="ml-1 text-meta font-semibold text-dim">
                {strengthLabels[strength]}
              </span>
            </div>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={loading}
          variant="gradient"
          className="mt-2 w-full justify-center h-10 text-title"
        >
          {loading ? 'Criando conta...' : 'Criar conta e continuar'}
        </Button>
      </form>

      <div className="mt-2 text-center text-body text-muted">
        Já tem uma conta?{' '}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Entrar
        </Link>
      </div>
    </div>
  );
}
