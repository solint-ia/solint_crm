'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { recoverPasswordAction } from '@/app/(auth)/actions';

export function RecoverForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await recoverPasswordAction({ email });
      if (res.ok) {
        setSent(true);
      } else {
        setError(res.error ?? 'Erro ao enviar email de recuperação.');
      }
    } catch {
      setError('Ocorreu um erro ao processar a solicitação.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="font-display text-display font-bold text-ink">Recuperar senha</h2>
        </div>

        <div className="flex items-start gap-3 rounded-control border border-green-line bg-green-soft p-4 text-ui text-green-text leading-relaxed">
          <CheckCircle2 className="size-5 shrink-0 text-green-text mt-0.5" />
          <div>
            Enviamos um link de redefinição para <strong className="font-semibold">{email}</strong>.
            Verifique sua caixa de entrada e a pasta de spam.
          </div>
        </div>

        <Link href="/login">
          <Button variant="secondary" className="w-full justify-center h-10 text-title">
            Voltar para o login
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-display font-bold text-ink">Recuperar senha</h2>
        <p className="mt-1 text-ui text-muted">
          Informe seu email e enviaremos as instruções para redefinir sua senha.
        </p>
      </div>

      {error ? (
        <div className="rounded-control border border-red-line bg-red-soft p-3 text-body text-red-text">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="recover-email">
          <TextInput
            id="recover-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="você@empresa.com"
          />
        </Field>

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 w-full justify-center h-10 text-title"
        >
          {loading ? 'Enviando...' : 'Enviar link de recuperação'}
        </Button>
      </form>

      <div className="mt-2 text-center text-body">
        <Link
          href="/login"
          className="inline-flex items-center gap-1 font-semibold text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para o login
        </Link>
      </div>
    </div>
  );
}
