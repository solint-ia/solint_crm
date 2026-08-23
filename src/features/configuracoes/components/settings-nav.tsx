'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@/config/navigation';
import { cn } from '@/lib/cn';

interface SettingsNavProps {
  readonly current: SettingsSectionId;
}

/**
 * Índice das seções.
 *
 * Em telas largas é uma coluna; abaixo de `lg` vira uma faixa rolável na
 * horizontal. Onze seções empilhadas no celular empurrariam o conteúdo para
 * baixo da dobra — o índice ocuparia a tela inteira antes de mostrar qualquer
 * configuração.
 */
export function SettingsNav({ current }: SettingsNavProps) {
  return (
    <nav
      aria-label="Seções de configuração"
      className="shrink-0 border-b border-line bg-surface lg:w-56 lg:border-r lg:border-b-0 lg:p-3"
    >
      <h2 className="hidden px-2 pb-3 font-display text-ui font-semibold text-ink lg:block">
        Configurações
      </h2>

      <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-x-visible lg:px-0 lg:py-0">
        {SETTINGS_SECTIONS.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <Link
                href={`/configuracoes?secao=${section.id}` as Route}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-control px-3 py-2 text-body font-medium whitespace-nowrap transition-colors lg:whitespace-normal',
                  active
                    ? 'bg-accent-soft font-semibold text-brand'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
