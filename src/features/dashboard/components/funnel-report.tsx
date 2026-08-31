import type { ConversionRate, LossReason } from '@/core/domain/analytics';
import { Section } from '@/components/ui/section';
import { EmptyHint } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';

interface FunnelReportProps {
  readonly conversions: readonly ConversionRate[];
  readonly lossReasons: readonly LossReason[];
}

/** "62%" → 62; "—" → 0, sem passar `NaN` para a barra. */
const percentualDe = (texto: string): number => {
  const valor = Number.parseInt(texto, 10);
  return Number.isFinite(valor) ? valor : 0;
};

export function FunnelReport({ conversions, lossReasons }: FunnelReportProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Conversão por etapa" hint="quanto de cada etapa segue para a seguinte">
        {conversions.length === 0 ? (
          <EmptyHint>
            O funil comercial ainda não tem etapas com negócios para comparar.
          </EmptyHint>
        ) : (
          <ul className="flex flex-col gap-3">
            {conversions.map((conversion) => (
              <li key={conversion.stage}>
                <div className="mb-1 flex items-center justify-between gap-2 text-body">
                  <span className="min-w-0 truncate text-ink">{conversion.stage}</span>
                  <span className="shrink-0 font-semibold text-brand tabular-nums">
                    {conversion.rate}
                  </span>
                </div>
                <ProgressBar
                  value={percentualDe(conversion.rate)}
                  label={`Conversão ${conversion.stage}`}
                />
                <p className="mt-1 text-meta text-dim">
                  Parado em média há {conversion.average}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/*
        Antes esta seção se chamava "Motivos de perda" e listava Preço, Prazo e
        Concorrência com percentuais fixos — o sistema não pergunta o motivo da
        perda em lugar nenhum, então aqueles números não vinham de nada. O que o
        funil de fato sabe é onde os negócios estão parados, e é isso que ele
        mostra agora.
      */}
      <Section
        title="Onde os negócios estão parados"
        hint="distribuição do pipeline por etapa"
        className="lg:border-l lg:border-line lg:pl-6"
      >
        {lossReasons.length === 0 ? (
          <EmptyHint>Nenhum negócio aberto no funil comercial.</EmptyHint>
        ) : (
          <ul className="flex flex-col gap-3">
            {lossReasons.map((reason) => (
              <li key={reason.reason}>
                <div className="mb-1 flex items-center justify-between gap-2 text-body">
                  <span className="min-w-0 truncate text-ink">{reason.reason}</span>
                  <span className="shrink-0 text-muted tabular-nums">{reason.percentage}%</span>
                </div>
                <ProgressBar
                  value={reason.percentage}
                  label={reason.reason}
                  colorVar="var(--color-brand-amber)"
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
