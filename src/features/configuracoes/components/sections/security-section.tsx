import type { AuditRecord } from '@/core/domain/audit';
import { AuditLogPanel } from './audit-log-panel';

interface SecuritySectionProps {
  readonly auditLog: readonly AuditRecord[];
}

/**
 * Segurança, só com o que funciona hoje: o registro de auditoria.
 *
 * O cartão de 2FA anunciava algo que não existe, e as sessões ativas listavam
 * apenas os navegadores de quem estava olhando, o que não é painel de
 * segurança da conta. Voltam quando existirem de verdade, com escopo de conta.
 */
export function SecuritySection({ auditLog }: SecuritySectionProps) {
  return (
    <div className="flex max-w-4xl flex-col gap-6 pb-16">
      <div className="flex flex-col gap-1 border-b border-line pb-5">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">Segurança</h2>
        <p className="text-sm text-muted">
          Quem acessou a conta, o que mudou e quando. Os registros não podem ser editados nem
          apagados.
        </p>
      </div>

      <AuditLogPanel records={auditLog} />
    </div>
  );
}
