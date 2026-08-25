import Link from 'next/link';
import type { Route } from 'next';
import {
  BarChart3,
  Kanban,
  MessageSquarePlus,
  QrCode,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/cn';

interface ShortcutItem {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly icon: React.ElementType;
  readonly colorClass: string;
}

const SHORTCUTS: readonly ShortcutItem[] = [
  {
    title: 'Nova conversa',
    description: 'Iniciar atendimento no WhatsApp',
    href: '/conversas',
    icon: MessageSquarePlus,
    colorClass: 'text-brand bg-blue-500/10 dark:text-blue-400',
  },
  {
    title: 'Novo contato',
    description: 'Cadastrar lead ou cliente',
    href: '/contatos',
    icon: UserPlus,
    colorClass: 'text-violet-600 bg-violet-500/10 dark:text-violet-400',
  },
  {
    title: 'Nova oportunidade',
    description: 'Registrar negócio no funil',
    href: '/kanban',
    icon: Kanban,
    colorClass: 'text-amber-600 bg-amber-500/10 dark:text-amber-400',
  },
  {
    title: 'Relatórios gerenciais',
    description: 'Análise de métricas avançadas',
    href: '/relatorios',
    icon: BarChart3,
    colorClass: 'text-green-600 bg-green-500/10 dark:text-green-400',
  },
  {
    title: 'Conectar WhatsApp',
    description: 'Gerenciar QR Code e canais',
    href: '/configuracoes?secao=integracoes',
    icon: QrCode,
    colorClass: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
  },
];

export function QuickShortcuts() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xs">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-brand" />
        <h2 className="font-display text-sm font-bold text-ink">Atalhos rápidos</h2>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {SHORTCUTS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.title}
              href={item.href as Route}
              className="group flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 p-3 transition-all hover:border-brand/40 hover:bg-surface hover:shadow-2xs active:scale-98"
            >
              <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105', item.colorClass)}>
                <Icon className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-ink group-hover:text-brand">{item.title}</p>
                <p className="truncate text-[11px] text-muted">{item.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
