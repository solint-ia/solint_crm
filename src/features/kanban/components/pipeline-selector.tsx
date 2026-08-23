import Link from 'next/link';
import type { Route } from 'next';
import type { Pipeline } from '@/core/domain/pipeline';
import { cn } from '@/lib/cn';

export function PipelineSelector({
  pipelines,
  currentId,
}: {
  readonly pipelines: readonly Pipeline[];
  readonly currentId: string;
}) {
  return (
    <nav aria-label="Selecionar funil" className="inline-flex gap-1 rounded-control bg-surface-2 p-1">
      {pipelines.map((pipeline) => (
        <Link
          key={pipeline.id}
          href={`/kanban?funil=${pipeline.id}` as Route}
          aria-current={pipeline.id === currentId ? 'true' : undefined}
          className={cn(
            'rounded-control px-3 py-1.5 text-body font-semibold transition-colors',
            pipeline.id === currentId
              ? 'bg-surface text-brand shadow-sm'
              : 'text-muted hover:text-ink',
          )}
        >
          {pipeline.name}
        </Link>
      ))}
    </nav>
  );
}
