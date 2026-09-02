'use client';

import { useState, useTransition } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import type { Account } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { switchWorkspaceAction } from './workspace-actions';

interface WorkspaceSwitcherProps {
  readonly current: Account;
  readonly accounts: readonly Account[];
}

/**
 * A marca da conta, com o recuo que o `Avatar` já sabe fazer.
 *
 * Logo quando existe; senão as iniciais do nome da empresa sobre a cor da
 * marca. É a mesma escada do avatar de pessoa, aplicada à identidade certa.
 */
const marcaDe = (account: Account) => ({
  name: account.name,
  tone: account.brandColor,
  src: account.logoUrl,
});

/**
 * Seletor de workspace.
 *
 * **O distintivo é da empresa, não de quem está logado.** Ele mostrava o rosto
 * do usuário, e isso respondia a pergunta errada: quem está diante da tela sabe
 * quem é: o que ele precisa confirmar num relance, antes de responder um
 * cliente, é *em qual empresa* está escrevendo. Com duas contas abertas em abas
 * diferentes, o mesmo rosto nas duas não distinguia nada — e a foto de perfil
 * da pessoa continua onde sempre esteve, no menu do próprio perfil.
 */
export function WorkspaceSwitcher({ current, accounts }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
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
        <Avatar {...marcaDe(current)} size="sm" />
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
                      {/* A mesma marca da lista e do distintivo: é por ela que
                          se reconhece a conta antes de ler o nome. */}
                      <Avatar {...marcaDe(account)} size="xs" />
                      <span className="min-w-0 flex-1">
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
          </div>
        </>
      ) : null}
    </div>
  );
}
