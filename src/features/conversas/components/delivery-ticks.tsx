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
    /**
     * O azul é o do WhatsApp (#53bdeb), à mão e não pelo `text-brand`.
     *
     * Aqui a cor não é decoração: é o único sinal que separa "entregue" de
     * "lido", já que o ícone é o mesmo. Amarrá-la à cor da marca faria o
     * significado mudar junto com o tema — num tema de marca azulada os dois
     * estados ficariam indistinguíveis.
     *
     * Só aparece quando o destinatário deixa: com a confirmação de leitura
     * desligada no aparelho dele, o WhatsApp nunca manda o recibo de leitura e
     * a mensagem fica em "entregue" para sempre. É o comportamento correto —
     * não há como saber, e fingir que sabe seria pior.
     */
    case 'lido':
      return <CheckCheck className="size-3 text-[#53bdeb]" aria-label="Lido" />;
    case 'falha':
      return <AlertCircle className="size-3 text-red-text" aria-label="Falha no envio" />;
  }
}
