'use client';

import { ArrowUpRight, Download, FileText } from 'lucide-react';
import type { BillingInfo } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatNumber } from '@/lib/format';
import { useToast } from '@/components/ui/toast';

interface BillingSectionProps {
  readonly billing: BillingInfo;
}

export function BillingSection({ billing }: BillingSectionProps) {
  const { show } = useToast();

  const handleDownload = (ref: string) => {
    show({
      tone: 'sucesso',
      title: 'Download iniciado',
      description: `Fatura ${ref} exportada em formato PDF.`,
    });
  };

  const handleUpgrade = () => {
    show({
      tone: 'info',
      title: 'Planos Solint CRM',
      description: 'Entre em contato com o suporte comercial para expandir seus limites.',
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl pb-16 animate-in fade-in duration-200">
      {/* ============================================================ */}
      {/* CABEÇALHO                                                    */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-1 border-b border-line pb-5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            Faturamento e plano
          </h2>
        </div>
        <p className="text-sm text-muted">
          Acompanhe o consumo dos recursos, gerencie sua assinatura e acesse notas fiscais e faturas.
        </p>
      </div>

      {/* ============================================================ */}
      {/* CARD DESTACADO DO PLANO ATUAL                                */}
      {/* ============================================================ */}
      <div className="relative overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-6 sm:p-7 text-white shadow-xl">
        {/* Background visual accents */}
        <div className="pointer-events-none absolute -right-12 -top-12 size-60 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 -bottom-12 size-60 rounded-full bg-blue-400/20 blur-2xl" />

        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-white/20 px-3 py-1 font-mono text-xs font-bold tracking-wide uppercase backdrop-blur-md">
                {billing.planName}
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-300">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                Assinatura ativa
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
                {billing.priceLabel}
              </span>
              <span className="text-sm text-white/80 font-medium">/ mês</span>
            </div>

            <p className="mt-2 text-xs sm:text-sm text-white/85">
              {billing.renewalLabel}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <Button
              variant="secondary"
              size="md"
              icon={<ArrowUpRight className="size-4" />}
              onClick={handleUpgrade}
              className="bg-white text-blue-900 hover:bg-white/90 border-0 font-bold shadow-md"
            >
              Fazer upgrade / Alterar plano
            </Button>
            <span className="text-[11px] text-white/70">
              Pagamento automático via cartão corporativo
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* SEÇÃO DE USO E LIMITES DO PLANO                              */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h3 className="font-display text-base font-bold text-ink">
              Consumo e limites do período
            </h3>
            <p className="text-xs text-muted">
              Recursos disponíveis e contratados no seu ciclo mensal atual.
            </p>
          </div>
          <span className="text-xs font-semibold text-brand">
            Renovação em 12 dias
          </span>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {billing.usage.map((item) => {
            const percent = Math.min(100, Math.round((item.used / (item.limit || 1)) * 100));
            return (
              <div
                key={item.label}
                className="flex flex-col justify-between rounded-xl border border-line-soft bg-surface-2/50 p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ink">{item.label}</span>
                    <span className="font-mono text-xs font-semibold text-muted">
                      {formatNumber(item.used)} / {formatNumber(item.limit)}
                    </span>
                  </div>

                  <div className="mt-3">
                    <ProgressBar value={item.used} max={item.limit} label={item.label} />
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between text-[11px] text-dim">
                  <span>{percent}% utilizado</span>
                  <span>{item.limit - item.used > 0 ? `${formatNumber(item.limit - item.used)} disponíveis` : 'Limite atingido'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============================================================ */}
      {/* HISTÓRICO DE FATURAS E NOTAS FISCAIS                         */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-2xs">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h3 className="font-display text-base font-bold text-ink">
              Histórico de pagamentos
            </h3>
            <p className="text-xs text-muted">
              Comprovantes fiscais e recibos das últimas cobranças.
            </p>
          </div>
        </div>

        <div className="mt-3 overflow-hidden">
          <div className="divide-y divide-line-soft">
            {billing.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-surface-2/40 px-2 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-dim">
                    <FileText className="size-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-ink block">
                      Fatura de {invoice.reference}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {invoice.amountLabel}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <Badge tone={invoice.status === 'paga' ? 'green' : 'amber'}>
                    {invoice.status === 'paga' ? 'Paga com sucesso' : 'Pendente'}
                  </Badge>

                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Download className="size-3.5" />}
                    onClick={() => handleDownload(invoice.reference)}
                  >
                    Baixar PDF
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
