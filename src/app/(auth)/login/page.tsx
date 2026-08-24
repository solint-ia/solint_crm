import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/features/auth/components/auth-split-layout';
import { AuthForm } from '@/features/auth/components/auth-form';

export const metadata: Metadata = { title: 'Entrar no Solint CRM' };

export default function LoginPage() {
  return (
    <AuthSplitLayout>
      <Suspense fallback={<div className="h-96" aria-hidden="true" />}>
        <AuthForm initialMode="login" />
      </Suspense>
    </AuthSplitLayout>
  );
}
