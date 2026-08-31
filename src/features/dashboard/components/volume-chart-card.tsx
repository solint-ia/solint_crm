'use client';

import { useMemo, useState } from 'react';
import type { TimeSeriePoint } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';

interface VolumeChartCardProps {
  readonly points: readonly TimeSeriePoint[];
  readonly periodLabel: string;
}

type SerieId = 'recebidas' | 'respondidas' | 'resolvidas' | 'sem_resposta';

/**
 * As quatro séries, na ordem fixa em que recebem cor.
 *
 * Ordem fixa e nunca reciclada: esconder "Respondidas" na legenda não pode
 * repintar "Resolvidas" com a cor que sobrou — a cor pertence à série, não à
 * posição dela na lista do momento. O traço (`dash`) é a codificação
 * secundária: no modo escuro o par azul/violeta fica no piso de separação sob
 * daltonismo, e a forma da linha resolve o que a cor sozinha não resolve.
 */
const SERIES: readonly {
  readonly id: SerieId;
  readonly label: string;
  readonly colorVar: string;
  readonly dash?: string;
  readonly read: (point: TimeSeriePoint) => number;
}[] = [
  {
    id: 'recebidas',
    label: 'Recebidas',
    colorVar: 'var(--color-chart-1)',
    read: (point) => point.value,
  },
  {
    id: 'respondidas',
    label: 'Respondidas',
    colorVar: 'var(--color-chart-2)',
    dash: '6 3',
    read: (point) => point.answered ?? 0,
  },
  {
    id: 'resolvidas',
    label: 'Resolvidas',
    colorVar: 'var(--color-chart-3)',
    read: (point) => point.resolved ?? 0,
  },
  {
    id: 'sem_resposta',
    label: 'Sem resposta',
    colorVar: 'var(--color-chart-4)',
    dash: '2 3',
    read: (point) => point.abandoned ?? 0,
  },
];

/** Área de desenho em unidades do viewBox. */
const W = 720;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 26, left: 40 } as const;
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/**
 * Um teto de eixo que termina em número redondo.
 *
 * Um eixo que vai até 137 põe as linhas de grade em 34,25 — e ninguém lê um
 * gráfico contra 34,25. Sobe para o próximo passo "bonito" (1, 2, 5 × 10ⁿ).
 */
const escalaDe = (max: number): number => {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const passo of [1, 2, 2.5, 5, 10]) {
    const teto = passo * magnitude;
    if (teto >= max) return Math.ceil(teto);
  }
  return Math.ceil(max);
};

export function VolumeChartCard({ points, periodLabel }: VolumeChartCardProps) {
  // Todas visíveis é ruído; "recebidas × resolvidas" é a leitura que o painel
  // existe para dar. As outras duas entram por clique na legenda.
  const [visiveis, setVisiveis] = useState<readonly SerieId[]>(['recebidas', 'resolvidas']);
  const [hover, setHover] = useState<number | null>(null);

  const series = SERIES.filter((serie) => visiveis.includes(serie.id));

  const escala = useMemo(() => {
    const maior = Math.max(
      1,
      ...points.flatMap((point) => series.map((serie) => serie.read(point))),
    );
    return escalaDe(maior);
  }, [points, series]);

  const totais = useMemo(
    () =>
      SERIES.map((serie) => ({
        ...serie,
        total: points.reduce((soma, point) => soma + serie.read(point), 0),
      })),
    [points],
  );

  const x = (index: number): number =>
    points.length <= 1 ? PAD.left + PLOT_W / 2 : PAD.left + (index / (points.length - 1)) * PLOT_W;
  const y = (value: number): number => PAD.top + (1 - value / escala) * PLOT_H;

  const caminho = (serie: (typeof SERIES)[number]): string =>
    points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(serie.read(point))}`).join(' ');

  const area = (serie: (typeof SERIES)[number]): string =>
    points.length < 2
      ? ''
      : `${caminho(serie)} L ${x(points.length - 1)} ${PAD.top + PLOT_H} L ${x(0)} ${PAD.top + PLOT_H} Z`;

  const linhasDeGrade = [0, 0.25, 0.5, 0.75, 1];
  const total = totais.find((serie) => serie.id === 'recebidas')?.total ?? 0;

  // Um rótulo a cada N para o eixo não virar um borrão em 30 dias.
  const passoRotulo = Math.max(1, Math.ceil(points.length / 8));
  const pontoEmFoco = hover === null ? undefined : points[hover];

  const alternar = (id: SerieId) =>
    setVisiveis((atual) =>
      atual.includes(id)
        ? // Nunca zero séries: um gráfico vazio não é um estado que alguém quis.
          atual.length === 1
          ? atual
          : atual.filter((item) => item !== id)
        : [...atual, id],
    );

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-base font-bold text-ink">Volume de conversas</h2>
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
            {periodLabel}
          </span>
        </div>
        <p className="text-xs text-muted">
          {total === 0 ? (
            'Nenhuma conversa aberta neste período.'
          ) : (
            <>
              <strong className="font-bold text-ink tabular-nums">
                {total.toLocaleString('pt-BR')}
              </strong>{' '}
              {total === 1 ? 'conversa recebida' : 'conversas recebidas'} no período
            </>
          )}
        </p>
      </div>

      {/* Legenda — também o filtro. É ela que dá identidade por texto, e não só
          por cor, às séries de contraste mais baixo. */}
      <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2">
        {totais.map((serie) => {
          const ativa = visiveis.includes(serie.id);
          return (
            <button
              key={serie.id}
              type="button"
              onClick={() => alternar(serie.id)}
              aria-pressed={ativa}
              className={cn(
                'flex items-center gap-1.5 rounded-lg text-xs transition-opacity',
                ativa ? 'opacity-100' : 'opacity-40 hover:opacity-70',
              )}
            >
              <span
                aria-hidden
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={{
                  backgroundColor: serie.colorVar,
                  ...(serie.dash
                    ? {
                        backgroundImage: `repeating-linear-gradient(90deg, ${serie.colorVar} 0 4px, transparent 4px 7px)`,
                        backgroundColor: 'transparent',
                      }
                    : {}),
                }}
              />
              <span className="font-semibold text-muted">{serie.label}</span>
              <span className="font-bold text-ink tabular-nums">
                {serie.total.toLocaleString('pt-BR')}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          // `xMidYMid meet` e não `none`: com escala não uniforme os marcadores
          // circulares viravam elipses achatadas e os rótulos dos eixos
          // esticavam junto com a largura da janela. A altura sai do próprio
          // `viewBox`, então o gráfico acompanha a largura do cartão sem
          // distorcer nada.
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Volume de conversas por ${periodLabel.toLowerCase()}`}
          className="h-auto w-full"
          onMouseLeave={() => setHover(null)}
        >
          {/* Grade e escala do eixo Y — o gráfico não tinha eixo nenhum antes,
              então nenhuma altura na tela correspondia a um número. */}
          {linhasDeGrade.map((fracao) => {
            const valor = Math.round(escala * (1 - fracao));
            const posY = PAD.top + fracao * PLOT_H;
            return (
              <g key={fracao}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={posY}
                  y2={posY}
                  stroke="var(--color-chart-grid)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={PAD.left - 8}
                  y={posY + 3}
                  textAnchor="end"
                  className="fill-dim text-[10px] tabular-nums"
                  style={{ fontSize: 10 }}
                >
                  {valor}
                </text>
              </g>
            );
          })}

          <defs>
            <linearGradient id="areaRecebidas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Só a série de base ganha preenchimento. Quatro áreas empilhadas
              esconderiam umas às outras — as demais são linha. */}
          {visiveis.includes('recebidas') && points.length > 1 ? (
            <path d={area(SERIES[0]!)} fill="url(#areaRecebidas)" />
          ) : null}

          {series.map((serie) => (
            <path
              key={serie.id}
              d={caminho(serie)}
              fill="none"
              stroke={serie.colorVar}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              {...(serie.dash ? { strokeDasharray: serie.dash } : {})}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Fio-guia do ponto sob o cursor. */}
          {hover !== null ? (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="var(--color-dim)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              {series.map((serie) => (
                <circle
                  key={serie.id}
                  cx={x(hover)}
                  cy={y(serie.read(points[hover]!))}
                  r={4}
                  fill={serie.colorVar}
                  // Anel da cor da superfície: onde duas séries se cruzam, é ele
                  // que impede os marcadores de virarem uma mancha só.
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          ) : null}

          {/* Faixas de captura do mouse, uma por ponto. */}
          {points.map((point, index) => (
            <rect
              key={`${point.label}-${index}`}
              x={index === 0 ? PAD.left : x(index) - PLOT_W / (points.length - 1 || 1) / 2}
              y={PAD.top}
              width={PLOT_W / (points.length - 1 || 1)}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}

          {/* Eixo X */}
          {points.map((point, index) =>
            index % passoRotulo === 0 || index === points.length - 1 ? (
              <text
                key={`rot-${point.label}-${index}`}
                x={x(index)}
                y={H - 8}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                className="fill-dim text-[10px]"
                style={{ fontSize: 10 }}
              >
                {point.label}
              </text>
            ) : null,
          )}
        </svg>

        {pontoEmFoco ? (
          <div
            className="pointer-events-none absolute top-2 z-20 min-w-36 rounded-xl border border-line bg-surface p-2.5 shadow-lg"
            style={{
              left: `${(x(hover!) / W) * 100}%`,
              transform:
                (hover ?? 0) > points.length / 2 ? 'translateX(-105%)' : 'translateX(10px)',
            }}
          >
            <p className="mb-1.5 text-[11px] font-bold text-ink">{pontoEmFoco.label}</p>
            <ul className="flex flex-col gap-1">
              {series.map((serie) => (
                <li key={serie.id} className="flex items-center gap-2 text-[11px] whitespace-nowrap">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: serie.colorVar }}
                  />
                  <span className="flex-1 text-muted">{serie.label}</span>
                  <span className="font-bold text-ink tabular-nums">
                    {serie.read(pontoEmFoco).toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
