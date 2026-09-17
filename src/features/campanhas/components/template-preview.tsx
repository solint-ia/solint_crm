import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';

interface TemplatePreviewProps {
  readonly preview: string;
  readonly inboxLabel?: string;
  readonly audienceLabel?: string;
  readonly recipients?: number;
  readonly templateName?: string;
  readonly scheduleLabel?: string;
}

/** A mensagem como chega no aparelho, com o resumo do que foi escolhido até aqui. */
export function TemplatePreview({
  preview,
  inboxLabel,
  audienceLabel,
  recipients,
  templateName,
  scheduleLabel,
}: TemplatePreviewProps) {
  return (
    <Card>
      <p className="mb-2 text-meta font-semibold tracking-wide text-dim uppercase">
        Pré-visualização
      </p>
      <div className="rounded-surface bg-chat p-3">
        <p className="rounded-bubble rounded-bl-sm border border-line bg-surface px-3 py-2 text-body whitespace-pre-wrap text-ink shadow-sm">
          {preview || 'Selecione um template para visualizar a mensagem.'}
        </p>
      </div>
      <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-meta">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Sai pelo número</dt>
          <dd className="text-right text-ink">{inboxLabel ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Template</dt>
          <dd className="font-mono text-ink">{templateName ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Público</dt>
          <dd className="text-right text-ink">{audienceLabel ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Destinatários</dt>
          <dd className="text-ink">
            {typeof recipients === 'number' ? formatNumber(recipients) : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Disparo</dt>
          <dd className="text-ink">{scheduleLabel ?? 'imediato'}</dd>
        </div>
      </dl>
    </Card>
  );
}
