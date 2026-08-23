import type { ChannelShare } from '@/core/domain/analytics';
import { ProgressBar } from '@/components/ui/progress-bar';

export function ChannelDistribution({ channels }: { readonly channels: readonly ChannelShare[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {channels.map((channel) => (
        <li key={channel.channelLabel}>
          <div className="mb-1 flex items-center justify-between text-meta">
            <span className="flex items-center gap-1.5 text-ink">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: channel.colorVar }}
              />
              {channel.channelLabel}
            </span>
            <span className="font-semibold text-muted">{channel.percentage}%</span>
          </div>
          <ProgressBar
            value={channel.percentage}
            label={`Participação do canal ${channel.channelLabel}`}
            colorVar={channel.colorVar}
          />
        </li>
      ))}
    </ul>
  );
}
