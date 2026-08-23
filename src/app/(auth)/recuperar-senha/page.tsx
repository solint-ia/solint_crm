import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/features/auth/components/auth-split-layout';
import { RecoverForm } from '@/features/auth/components/recover-form';

export const metadata: Metadata = { title: 'Recuperar senha' };

export default function RecuperarSenhaPage() {
  return (
    <AuthSplitLayout>
      <RecoverForm />
    </AuthSplitLayout>
  );
}
