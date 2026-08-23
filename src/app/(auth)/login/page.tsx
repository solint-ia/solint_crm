import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/features/auth/components/auth-split-layout';
import { LoginForm } from '@/features/auth/components/login-form';

export const metadata: Metadata = { title: 'Entrar no Solint CRM' };

/**
 * O formulário lê `?proximo=` para devolver a pessoa ao destino de onde foi
 * barrada; `useSearchParams` exige uma fronteira de Suspense para que o resto
 * da página continue podendo ser gerado estaticamente.
 */
export default function LoginPage() {
  return (
    <AuthSplitLayout>
      <Suspense fallback={<div className="h-96" aria-hidden="true" />}>
        <LoginForm />
      </Suspense>
    </AuthSplitLayout>
  );
}
