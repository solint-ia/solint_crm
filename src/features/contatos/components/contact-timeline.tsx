import type { TimelineEvent } from '@/core/domain/contact';
import type { Tone } from '@/core/domain/label';
import { TONE_CLASSES } from '@/components/ui/tone';
import { EmptyState } from '@/components/ui/empty-state';

const TYPE_TONE: Readonly<Record<TimelineEvent['type'], Tone>> = {
  conversa: 'blue',
  nota: 'amber',
  funil: 'violet',
  campanha: 'cyan',
  cadastro: 'slate',
};

const TYPE_LABEL: Readonly<Record<TimelineEvent['type'], string>> = {
  conversa: 'Conversa',
  nota: 'Nota',
  funil: 'Funil',
  campanha: 'Campanha',
  cadastro: 'Cadastro',
};

export function ContactTimeline({ events }: { readonly events: readonly TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="Sem interações registradas"
        description="Assim que este contato conversar com a equipe, o histórico aparece aqui."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-micro font-bold ${TONE_CLASSES[TYPE_TONE[event.type]]}`}
          >
            {TYPE_LABEL[event.type].charAt(0)}
          </span>
          <div className="min-w-0 flex-1 border-b border-line-soft pb-3 last:border-0">
            <p className="text-body text-ink">{event.title}</p>
            {event.description ? (
              <p className="text-meta text-muted">{event.description}</p>
            ) : null}
            <p className="mt-0.5 text-meta text-dim">{event.occurredAt}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
