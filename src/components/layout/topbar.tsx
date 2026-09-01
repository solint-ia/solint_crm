import type { AppNotification } from '@/core/domain/notification';
import type { Account } from '@/core/domain/user';
import { NAV_ITEMS, reachesNavItem } from '@/config/navigation';
import { GlobalSearch } from '@/features/busca/components/global-search';
import { container } from '@/infrastructure/container';
import { NotificationsMenu } from './notifications-menu';
import { WorkspaceSwitcher } from './workspace-switcher';

interface TopbarProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly account: Account;
  readonly accounts: readonly Account[];
  readonly notifications: readonly AppNotification[];
  readonly actions?: React.ReactNode;
}

/** Topbar presente em todas as telas, exceto /conversas (layout de 4 colunas). */
export async function Topbar({
  title,
  subtitle,
  account,
  accounts,
  notifications,
  actions,
}: TopbarProps) {
  // A paleta de busca só oferece telas que o papel do usuário alcança (RBAC no servidor).
  const session = await container.session.getCurrentSession();
  const navItems = NAV_ITEMS.filter((item) => reachesNavItem(session.permissions, item));

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 shadow-2xs md:h-15 md:gap-4 md:px-6">
      <div className="min-w-0">
        <h1 className="font-display text-title font-bold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="truncate text-meta text-muted">{subtitle}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 md:gap-2.5">
        <GlobalSearch navItems={navItems} />
        {actions}
        <NotificationsMenu notifications={notifications} />
        <WorkspaceSwitcher current={account} accounts={accounts} user={session.user} />
      </div>
    </header>
  );
}
