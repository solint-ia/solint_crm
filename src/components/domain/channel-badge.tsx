import type { Channel } from '@/core/domain/channel';
import { describeChannel } from '@/core/domain/channel';
import { Badge } from '@/components/ui/badge';
import { CHANNEL_COLOR_VAR, CHANNEL_TONE } from './presentation-maps';

export function ChannelBadge({ channel }: { readonly channel: Channel }) {
  return <Badge tone={CHANNEL_TONE(channel)}>{describeChannel(channel).label}</Badge>;
}

/** Ponto colorido do canal, usado em listas densas. */
export function ChannelDot({ channel }: { readonly channel: Channel }) {
  const descriptor = describeChannel(channel);
  return (
    <span
      title={descriptor.label}
      aria-label={descriptor.label}
      className="inline-block size-2 rounded-full"
      // Canal removido do registro ainda pode vir de linha antiga do banco: sem
      // o padrão, o ponto ficaria transparente e sumia da lista.
      style={{ backgroundColor: CHANNEL_COLOR_VAR[channel] ?? 'var(--color-dim)' }}
    />
  );
}
