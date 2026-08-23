import { ArrowUpRight, Download } from 'lucide-react';
import type { BillingInfo } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatNumber } from '@/lib/format';
import { planned } from '@/components/ui/planned';

interface BillingSectionProps {
  readonly billing: BillingInfo;
}

export function BillingSection({ billing }: BillingSectionProps) {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between rounded-surface bg-brand-gradient p-5 text-white shadow-xs">
        <div>
          <span className="text-meta font-medium tracking-wide uppercase opacity-85">
            Plano atual
          </span>
          <h3 className="font-display text-metric font-bold">
            {billing.planName} · {billing.priceLabel}
          </h3>
          <p className="mt-1 text-body opacity-90">{billing.renewalLabel}</p>
        </div>
        <Button variant="secondary" size="sm" icon={<ArrowUpRight className="size-3.5" />} {...planned('Alterar o plano da conta')}>
          Fazer upgrade
        </Button>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <h4 className="font-display text-ui font-semibold text-ink">
          Consumo e limites do período
        </h4>
        <div className="flex flex-col gap-4">
          {billing.usage.map((item) => (
            <div key={item.label}>
              <div className="mb-1.5 flex justify-between text-body">
                <span className="font-medium text-ink">{item.label}</span>
                <span className="font-mono text-muted">
                  {formatNumber(item.used)} / {formatNumber(item.limit)}
                </span>
              </div>
              <ProgressBar value={item.used} max={item.limit} label={item.label} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h4 className="font-display text-ui font-semibold text-ink">
          Histórico de faturas
        </h4>
        <div className="divide-y divide-line-soft">
          {billing.invoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-ui font-semibold text-ink">{invoice.reference}</div>
                <div className="font-mono text-body text-muted">{invoice.amountLabel}</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={invoice.status === 'paga' ? 'green' : 'amber'}>
                  {invoice.status === 'paga' ? 'Paga' : 'Pendente'}
                </Badge>
                <Button variant="ghost" size="sm" icon={<Download className="size-3.5" />} {...planned('Baixar a fatura em PDF')}>
                  PDF
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
