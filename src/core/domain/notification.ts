import type { Id } from './shared';

export type NotificationKind = 'atribuicao' | 'sla' | 'campanha' | 'mencao' | 'sistema';

export interface AppNotification {
  readonly id: Id;
  readonly accountId: Id;
  readonly kind: NotificationKind;
  readonly text: string;
  readonly timeLabel: string;
  readonly read: boolean;
  readonly href?: string;
}
