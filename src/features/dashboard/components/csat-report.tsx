import type { CsatBucket, CsatComment } from '@/core/domain/analytics';
import { Section } from '@/components/ui/section';
import { EmptyHint } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';

const TONE_COLOR = {
  green: 'var(--color-status-open)',
  amber: 'var(--color-brand-amber)',
  red: 'var(--color-status-danger)',
} as const;

interface CsatReportProps {
  readonly distribution: readonly CsatBucket[];
  readonly comments: readonly CsatComment[];
}

export function CsatReport({ distribution, comments }: CsatReportProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Distribuição de notas">
        <ul className="flex flex-col gap-3">
          {distribution.map((bucket) => (
            <li key={bucket.stars} className="flex items-center gap-3">
              <span className="w-14 text-meta text-amber-text">
                {'\u2605'.repeat(bucket.stars)}
              </span>
              <ProgressBar
                className="flex-1"
                value={bucket.percentage}
                label={`Percentual de notas ${bucket.stars}`}
                colorVar={TONE_COLOR[bucket.tone as keyof typeof TONE_COLOR] ?? undefined}
              />
              <span className="w-10 text-right text-meta text-muted">
                {bucket.percentage}%
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Comentários recentes" className="lg:border-l lg:border-line lg:pl-6">
        {comments.length === 0 ? (
          <EmptyHint>Nenhum cliente deixou comentário no período selecionado.</EmptyHint>
        ) : null}
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-control border border-line p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-body font-semibold text-ink">{comment.contactName}</span>
                <span className="text-meta text-amber-text">
                  {'\u2605'.repeat(comment.stars)}
                </span>
              </div>
              <p className="text-body text-muted">{comment.comment}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
