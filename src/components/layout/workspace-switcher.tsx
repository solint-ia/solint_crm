'use client';

import { useState, useTransition } from 'react';
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react';
import type { Account, User } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { CreateWorkspaceModal } from './create-workspace-modal';
import { switchWorkspaceAction } from './workspace-actions';

interface WorkspaceSwitcherProps {
  readonly current: Account;
  readonly accounts: readonly Account[];
  /**
   * Quem está logado — é o rosto que este botão mostra.
   *
   * O menu troca de **conta**, mas o distintivo que fica sempre visível ao
   * lado do sininho é a identidade de quem está usando o sistema, não da
   * empresa ativa — é esse distintivo que a foto de perfil precisa alcançar
   * assim que alguém a envia.
   */
  readonly user: Pick<User, 'name' | 'avatarTone' | 'avatarUrl'>;
}

export function WorkspaceSwitcher({ current, accounts, user }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [criando, setCriando] = useState(false);
  const [trocando, setTrocando] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { show } = useToast();

  /**
   * A conta ativa vem do servidor, sempre.
   *
   * Antes havia um `useState(current)` aqui e o clique só o atualizava: o menu
   * marcava a conta escolhida, e o resto da tela continuava na anterior. A
   * troca de verdade reassina o cookie e recarrega o layout, então não existe
   * nada de conta ativa para guardar no cliente.
   */
  const trocar = (accountId: string) => {
    if (accountId === current.id) {
      setOpen(false);
      return;
    }
    setTrocando(accountId);
    startTransition(async () => {
      // No sucesso a ação redireciona e nada abaixo executa.
      const result = await switchWorkspaceAction({ accountId });
      setTrocando(null);
      if (!result.ok) {
        show({
          tone: 'erro',
          title: 'Não foi possível trocar de workspace',
          description: result.error ?? 'Tente de novo em instantes.',
        });
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-body font-semibold text-ink transition-colors hover:bg-surface-2"
      >
        <Avatar name={user.name} tone={user.avatarTone} src={user.avatarUrl} size="sm" />
        {current.name}
        <ChevronDown className="size-3.5 text-dim" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-surface border border-line bg-surface py-1 shadow-xl">
            <ul role="listbox" aria-label="Workspaces">
              {accounts.map((account) => {
                const ativo = account.id === current.id;
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={ativo}
                      disabled={pending}
                      onClick={() => trocar(account.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body transition-colors hover:bg-surface-2 disabled:opacity-60',
                        ativo ? 'text-brand' : 'text-ink',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{account.name}</span>
                        <span className="block text-meta capitalize text-dim">{account.plan}</span>
                      </span>
                      {trocando === account.id ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-dim" />
                      ) : ativo ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-1 border-t border-line-soft pt-1">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setCriando(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
              >
                <Plus className="size-3.5" />
                Criar novo workspace
              </button>
            </div>
          </div>
        </>
      ) : null}

      <CreateWorkspaceModal open={criando} onClose={() => setCriando(false)} />
    </div>
  );
}
