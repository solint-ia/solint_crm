import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import type { DeliveryStatus } from '@/core/domain/message';

/** Checks de entrega no padrão WhatsApp (SKILL.md secao 4.3). */
export function DeliveryTicks({ status }: { readonly status: DeliveryStatus }) {
  switch (status) {
    case 'enviando':
      return <Clock className="size-3 text-accent-soft-meta" aria-label="Enviando" />;
    case 'enviado':
      return <Check className="size-3 text-accent-soft-meta" aria-label="Enviado" />;
    case 'entregue':
      return <CheckCheck className="size-3 text-accent-soft-meta" aria-label="Entregue" />;
    case 'lido':
      return <CheckCheck className="size-3 text-brand" aria-label="Lido" />;
    case 'falha':
      return <AlertCircle className="size-3 text-red-text" aria-label="Falha no envio" />;
  }
}
