import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { NewAccountForm } from '@/features/plataforma/components/new-account-form';

export const metadata: Metadata = { title: 'Nova conta' };

export default function NovaContaPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/plataforma"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Todas as contas
        </Link>
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Nova conta</h1>
          <p className="text-xs text-muted">
            A empresa e o primeiro administrador dela nascem juntos.
          </p>
        </div>
      </div>

      <NewAccountForm />
    </div>
  );
}
