'use client';

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Account } from '@/core/domain/user';
import { cn } from '@/lib/cn';

interface WorkspaceSwitcherProps {
  readonly current: Account;
  readonly accounts: readonly Account[];
}

export function WorkspaceSwitcher({ current, accounts }: WorkspaceSwitcherProps) {
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
        <span className="flex size-5 items-center justify-center rounded bg-brand-gradient text-micro font-bold text-white">
          {selected.name.charAt(0)}
        </span>
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
