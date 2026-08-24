import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/features/auth/components/auth-split-layout';
import { AuthForm } from '@/features/auth/components/auth-form';

export const metadata: Metadata = { title: 'Recuperar senha' };

export default function RecuperarSenhaPage() {
  return (
    <AuthSplitLayout>
      <Suspense fallback={<div className="h-96" aria-hidden="true" />}>
        <AuthForm initialMode="recuperar" />
      </Suspense>
    </AuthSplitLayout>
  );
}
