import { MessageSquareShare, Radio } from 'lucide-react';
import type { ChannelShare } from '@/core/domain/analytics';
import { ProgressBar } from '@/components/ui/progress-bar';

interface ChannelDistributionCardProps {
  readonly channels: readonly ChannelShare[];
}

export function ChannelDistributionCard({ channels }: ChannelDistributionCardProps) {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div>
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-brand">
              <MessageSquareShare className="size-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-ink">Distribuição por canal</h2>
              <p className="text-[11px] text-muted">Origem das conversas no período</p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-600 dark:text-green-400">
            <Radio className="size-3 animate-pulse" /> Ativo
          </span>
        </div>

        <ul className="mt-4 flex flex-col gap-3.5">
          {channels.map((channel) => (
            <li key={channel.channelLabel} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: channel.colorVar }}
                  />
                  {channel.channelLabel}
                </span>

                <div className="flex items-center gap-2 tabular-nums">
                  {channel.count !== undefined && (
                    <span className="text-[11px] text-muted">{channel.count} msgs</span>
                  )}
                  <span className="font-bold text-ink">{channel.percentage}%</span>
                </div>
              </div>

              <ProgressBar
                value={channel.percentage}
                label={`Participação do canal ${channel.channelLabel}`}
                colorVar={channel.colorVar}
              />
            </li>
          ))}
        </ul>
      </div>

      {channels.length === 1 && (
        <div className="mt-4 rounded-xl bg-surface-2 p-2.5 text-center text-[11px] text-muted">
          Canal principal <strong className="text-ink">{channels[0]?.channelLabel}</strong> concentrando 100% dos atendimentos.
        </div>
      )}
    </div>
  );
}
