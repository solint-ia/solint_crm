'use client';

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Account, User } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

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
  const [selected, setSelected] = useState(current);

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
        {selected.name}
        <ChevronDown className="size-3.5 text-dim" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            role="listbox"
            className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-surface border border-line bg-surface py-1 shadow-xl"
          >
            {accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={account.id === selected.id}
                  onClick={() => {
                    setSelected(account);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-body transition-colors hover:bg-surface-2',
                    account.id === selected.id ? 'text-brand' : 'text-ink',
                  )}
                >
                  <span>
                    <span className="block font-semibold">{account.name}</span>
                    <span className="block text-meta text-dim capitalize">{account.plan}</span>
                  </span>
                  {account.id === selected.id ? <Check className="size-3.5" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
