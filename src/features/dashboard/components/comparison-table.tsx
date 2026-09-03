import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ComparisonRow, PeriodKey } from '@/core/domain/analytics';
import { compareRow, PERIOD_LABELS, PREVIOUS_PERIOD_LABELS } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';

const format = (row: ComparisonRow, value: number): string =>
  `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: row.decimals ?? 0,
    maximumFractionDigits: row.decimals ?? 0,
  })}${row.unit ? ` ${row.unit}` : ''}`;

/**
 * Comparação entre períodos (§13).
 *
 * A barra de proporção é a razão entre as duas janelas, não um percentual do
 * total: é a única leitura que responde "isso subiu ou desceu, e quanto?" sem
 * o leitor fazer a conta de cabeça.
 *
 * `lowerIsBetter` existe para indicadores como conversas sem resposta, que
 * melhoram ao cair.
 */
export function ComparisonTable({
  rows,
  period,
}: {
  readonly rows: readonly ComparisonRow[];
  readonly period: PeriodKey;
}) {
  const widthOf = (row: ComparisonRow, value: number): string => {
    const ceiling = Math.max(row.current, row.previous, 1);
    return `${Math.round((value / ceiling) * 100)}%`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <caption className="sr-only">
          Comparação entre {PERIOD_LABELS[period].toLowerCase()} e{' '}
          {PREVIOUS_PERIOD_LABELS[period].toLowerCase()}
        </caption>
        <thead>
          <tr className="border-b border-line text-micro tracking-wide text-dim uppercase">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Indicador
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              {PERIOD_LABELS[period]}
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              {PREVIOUS_PERIOD_LABELS[period]}
            </th>
            <th scope="col" className="w-40 py-2 font-semibold">
              Variação
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const verdict = compareRow(row);
            const Icon =
              verdict.direction === 'neutro'
                ? Minus
                : row.current > row.previous
                  ? TrendingUp
                  : TrendingDown;

            return (
              <tr key={row.id} className="border-b border-line-soft last:border-0">
                <th scope="row" className="py-2.5 pr-3 text-body font-medium text-ink">
                  {row.label}
                </th>
                <td className="py-2.5 pr-3 text-right font-mono text-body font-semibold text-ink tabular-nums">
                  {format(row, row.current)}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-body text-dim tabular-nums">
                  {format(row, row.previous)}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex w-20 shrink-0 items-center gap-1 font-mono text-meta font-semibold tabular-nums',
                        verdict.direction === 'positivo' && 'text-green-text',
                        verdict.direction === 'negativo' && 'text-red-text',
                        verdict.direction === 'neutro' && 'text-dim',
                      )}
                    >
                      <Icon className="size-3 shrink-0" />
                      {verdict.label}
                    </span>

                    {/* Duas barras na mesma escala: a comparação vira forma. */}
                    <span aria-hidden="true" className="flex min-w-16 flex-1 flex-col gap-0.5">
                      <span className="h-1 rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full bg-brand"
                          style={{ width: widthOf(row, row.current) }}
                        />
                      </span>
                      <span className="h-1 rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full bg-line"
                          style={{ width: widthOf(row, row.previous) }}
                        />
                      </span>
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
