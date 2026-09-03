'use client';

// Componente de cliente por causa de uma linha: a moeda do valor exibido vem
// da preferência da conta, que vive num contexto. Ele não faz nada de
// servidor — recebe `stages` pronto e desenha — então a fronteira só desce um
// nível na árvore do painel.
import Link from 'next/link';
import { ArrowUpRight, Kanban } from 'lucide-react';
import type { FunnelStageSummary } from '@/core/domain/analytics';
import { useFormatarMoeda } from '@/components/layout/regional-provider';

interface FunnelSummaryCardProps {
  readonly stages: readonly FunnelStageSummary[];
}

/**
 * O funil comercial — desenhado como funil.
 *
 * Antes era uma lista de linhas com uma bolinha colorida, um número e um valor:
 * a informação estava toda lá e a **forma** não dizia nada. A pergunta que se
 * faz a um funil é "onde ele estrangula?", e ela se responde comparando a
 * largura de uma etapa com a da anterior — que é exatamente o que uma lista
 * alinhada à esquerda esconde.
 *
 * A barra é proporcional à maior etapa, não ao total: com cinco etapas, dividir
 * pelo total deixaria todas abaixo de um terço da largura e o estrangulamento
 * some no arredondamento.
 */
export function FunnelSummaryCard({ stages }: FunnelSummaryCardProps) {
  const formatarMoeda = useFormatarMoeda();
  const valorTotal = stages.reduce((total, stage) => total + stage.amountInCents, 0);
  const negocios = stages.reduce((total, stage) => total + stage.count, 0);
  const maior = Math.max(1, ...stages.map((stage) => stage.count));

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Kanban className="size-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold text-ink">Funil de oportunidades</h2>
            <p className="text-[11px] text-muted">Pipeline comercial em andamento</p>
          </div>
        </div>

        <Link
          href="/kanban"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand transition-colors hover:text-brand/80"
        >
          Ver Kanban
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="my-3.5 grid grid-cols-2 gap-3 rounded-xl bg-surface-2/60 p-3">
        <div>
          <span className="text-[11px] font-medium text-muted">Pipeline ativo</span>
          <p className="font-display text-base font-bold text-ink tabular-nums">
            {formatarMoeda(valorTotal)}
          </p>
        </div>
        <div className="text-right">
          <span className="text-[11px] font-medium text-muted">Total de negócios</span>
          <p className="font-display text-base font-bold text-brand tabular-nums">
            {negocios} {negocios === 1 ? 'oportunidade' : 'oportunidades'}
          </p>
        </div>
      </div>

      {stages.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          Nenhuma etapa configurada no funil comercial.
        </p>
      ) : (
        <ul className="flex flex-1 flex-col gap-2">
          {stages.map((stage) => {
            const fracao = stage.count / maior;
            return (
              <li key={stage.stage}>
                <Link
                  href="/kanban"
                  className="group flex flex-col gap-1 rounded-lg p-1 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-ink group-hover:text-brand">
                        {stage.stage}
                      </span>
                      {stage.conversionRate ? (
                        <span
                          className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-semibold text-muted tabular-nums"
                          title="Quanto desta etapa seguiu para a próxima"
                        >
                          →{stage.conversionRate}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] font-bold text-ink tabular-nums">
                      {formatarMoeda(stage.amountInCents)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(stage.count > 0 ? 3 : 0, fracao * 100)}%`,
                          backgroundColor: stage.colorVar,
                        }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-[11px] font-semibold text-muted tabular-nums">
                      {stage.count}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 border-t border-line pt-2.5 text-center text-[11px] text-dim">
        A largura da barra compara cada etapa com a mais cheia do funil.
      </p>
    </div>
  );
}
