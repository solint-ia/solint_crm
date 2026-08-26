'use client';

import Link from 'next/link';
import type { Route } from 'next';
import {
  BookOpen,
  Building2,
  CreditCard,
  Inbox,
  Layers,
  MessageSquare,
  ShieldCheck,
  Sliders,
  Tag,
  Users,
  Zap,
} from 'lucide-react';
import type { SettingsSectionId } from '@/config/navigation';
import { cn } from '@/lib/cn';

interface SettingsNavProps {
  readonly current: SettingsSectionId;
}

interface NavSectionGroup {
  readonly title: string;
  readonly items: readonly {
    readonly id: SettingsSectionId;
    readonly label: string;
    readonly icon: React.ElementType;
  }[];
}

const SECTION_GROUPS: readonly NavSectionGroup[] = [
  {
    title: 'Atendimento',
    items: [
      { id: 'caixas', label: 'Caixas de entrada', icon: Inbox },
      { id: 'equipe', label: 'Equipe e Permissões', icon: Users },
      { id: 'respostas', label: 'Respostas rápidas', icon: MessageSquare },
      { id: 'etiquetas', label: 'Etiquetas', icon: Tag },
    ],
  },
  {
    title: 'Automação',
    items: [
      { id: 'automacoes', label: 'Automações e Regras', icon: Zap },
    ],
  },
  {
    title: 'Integrações',
    items: [
      { id: 'integracoes', label: 'Integrações e Conexões', icon: Layers },
    ],
  },
  {
    title: 'Organização',
    items: [
      { id: 'conhecimento', label: 'Base de conhecimento', icon: BookOpen },
      { id: 'atributos', label: 'Atributos personalizados', icon: Sliders },
      { id: 'empresa', label: 'Empresa', icon: Building2 },
    ],
  },
  {
    title: 'Conta e segurança',
    items: [
      { id: 'faturamento', label: 'Faturamento e Plano', icon: CreditCard },
      { id: 'seguranca', label: 'Segurança', icon: ShieldCheck },
    ],
  },
];

export function SettingsNav({ current }: SettingsNavProps) {
  return (
    <nav
      aria-label="Seções de configuração"
      className="shrink-0 border-b border-line bg-surface lg:w-64 lg:border-r lg:border-b-0 lg:p-3 overflow-y-auto"
    >
      {/* Visualização Desktop: Menu agrupado moderno */}
      <div className="hidden lg:flex lg:flex-col lg:gap-4">
        {SECTION_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <span className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-dim">
              {group.title}
            </span>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.id === current;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={`/configuracoes?secao=${item.id}` as Route}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-ui font-medium transition-all',
                        active
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                          : 'text-muted hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-lg transition-colors',
                          active
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-dim group-hover:text-ink',
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Visualização Mobile / Tablet: Faixa horizontal rolável com badges e ícones */}
      <div className="flex lg:hidden gap-1.5 overflow-x-auto px-3 py-2.5 scrollbar-none">
        {SECTION_GROUPS.flatMap((g) => g.items).map((item) => {
          const active = item.id === current;
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={`/configuracoes?secao=${item.id}` as Route}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-meta font-medium whitespace-nowrap transition-all',
                active
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold shadow-2xs border border-blue-500/20'
                  : 'border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Icon className={cn('size-3.5', active ? 'text-blue-600 dark:text-blue-400' : 'text-dim')} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
