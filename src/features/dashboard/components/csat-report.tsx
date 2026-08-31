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
  /** Quantas notas sustentam a distribuição. */
  readonly responseCount: number;
}

/**
 * Satisfação do cliente, com o tamanho da amostra à vista.
 *
 * A distribuição sozinha mente por omissão: "60% deram 5 estrelas" lido sem o
 * denominador soa como uma medição, e pode ser três respostas. O total fica no
 * cabeçalho, e quando ele é zero as barras dão lugar a uma explicação de como
 * ligar a coleta — antes elas apareciam preenchidas com números de exemplo.
 */
export function CsatReport({ distribution, comments, responseCount }: CsatReportProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section
        title="Distribuição de notas"
        hint={
          responseCount === 0
            ? 'sem respostas'
            : `${responseCount.toLocaleString('pt-BR')} ${responseCount === 1 ? 'resposta' : 'respostas'}`
        }
      >
        {responseCount === 0 ? (
          <EmptyHint>
            Nenhum cliente avaliou o atendimento neste período. A pesquisa é enviada no
            encerramento da conversa e precisa estar ligada em Configurações → Caixas de entrada →
            Pesquisa de satisfação.
          </EmptyHint>
        ) : (
          <ul className="flex flex-col gap-3">
            {distribution.map((bucket) => (
              <li key={bucket.stars} className="flex items-center gap-3">
                <span className="w-14 text-meta text-amber-text">
                  {'★'.repeat(bucket.stars)}
                </span>
                <ProgressBar
                  className="flex-1"
                  value={bucket.percentage}
                  label={`Percentual de notas ${bucket.stars}`}
                  colorVar={TONE_COLOR[bucket.tone as keyof typeof TONE_COLOR] ?? undefined}
                />
                <span className="w-10 text-right text-meta text-muted tabular-nums">
                  {bucket.percentage}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Respostas recentes" className="lg:border-l lg:border-line lg:pl-6">
        {comments.length === 0 ? (
          <EmptyHint>
            {responseCount === 0
              ? 'As respostas dos clientes aparecem aqui assim que a pesquisa começar a rodar.'
              : 'As notas do período vieram sem texto junto.'}
          </EmptyHint>
        ) : null}
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-control border border-line p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-body font-semibold text-ink">
                  {comment.contactName}
                </span>
                <span className="shrink-0 text-meta text-amber-text">
                  {'★'.repeat(comment.stars)}
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
