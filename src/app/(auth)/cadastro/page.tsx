import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/features/auth/components/auth-split-layout';
import { SignupForm } from '@/features/auth/components/signup-form';

export const metadata: Metadata = { title: 'Criar conta no Solint CRM' };

export default function CadastroPage() {
  return (
    <AuthSplitLayout>
      <SignupForm />
    </AuthSplitLayout>
  );
}
