'use client';

import { useState, useTransition } from 'react';
import { LogOut } from 'lucide-react';
import { logoutAllSessionsAction } from '@/app/(workspace)/perfil/actions';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';

export function LogoutAllSessionsButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    startTransition(() => void logoutAllSessionsAction());
  };

  return (
    <>
      <Button
        variant="danger"
        size="sm"
        icon={<LogOut className="size-3.5" />}
        onClick={() => setOpen(true)}
      >
        Sair de todas as sessões
      </Button>

      <ConfirmModal
        open={open}
        title="Sair de todas as sessões"
        description="Todos os seus acessos neste e nos demais dispositivos serão encerrados imediatamente. Você precisará entrar novamente com sua senha."
        confirmLabel="Encerrar todos os acessos"
        variant="danger"
        icon="warning"
        isLoading={pending}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
      />
    </>
  );
}
