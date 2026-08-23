import type { AppNotification } from '@/core/domain/notification';
import { ACCOUNT_ID } from './workspace';

export const NOTIFICATIONS: readonly AppNotification[] = [
  {
    id: 'nt-1', accountId: ACCOUNT_ID, kind: 'atribuicao',
    text: 'Nova conversa atribuída a você: Mariana Costa', timeLabel: 'Há 8 min', read: false,
    href: '/conversas',
  },
  {
    id: 'nt-2', accountId: ACCOUNT_ID, kind: 'sla',
    text: 'SLA prestes a estourar: João Pedro Silva (faltam 18 min)', timeLabel: 'Há 22 min',
    read: false, href: '/conversas',
  },
  {
    id: 'nt-3', accountId: ACCOUNT_ID, kind: 'campanha',
    text: 'Campanha Reativação Agosto concluída · 94% entregue', timeLabel: 'Há 1h',
    read: false, href: '/campanhas',
  },
  {
    id: 'nt-4', accountId: ACCOUNT_ID, kind: 'mencao',
    text: 'Você foi mencionado por Camila em uma nota interna', timeLabel: 'Ontem', read: true,
    href: '/conversas',
  },
];
