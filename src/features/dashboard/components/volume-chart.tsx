import type { TimeSeriePoint } from '@/core/domain/analytics';

const H = 120;
const PAD_TOP = 14;
const GRID_LINES = 3;
/** Acima disso os rótulos do eixo colidem: passa a mostrar um a cada N. */
const MAX_LABELS = 8;

interface VolumeChartProps {
  readonly points: readonly TimeSeriePoint[];
  /** Mesma janela no período anterior. Desenhada como linha de referência. */
  readonly previous?: readonly TimeSeriePoint[];
  readonly previousLabel?: string;
}

/**
 * Volume por dia.
 *
 * A versão anterior escrevia o valor sobre cada barra — se todo ponto precisa
 * do número escrito, a forma não está fazendo trabalho nenhum. Aqui a área
 * preenchida carrega o volume, a grade discreta dá a escala, e só o pico e o
 * último ponto recebem rótulo. Quem quer a tabela completa tem o `figcaption`,
 * que também é o que o leitor de tela lê.
 *
 * A série anterior, quando pedida, entra como linha tracejada atrás da atual:
 * comparar exige as duas no mesmo eixo, não dois gráficos lado a lado.
 */
export function VolumeChart({ points, previous, previousLabel }: VolumeChartProps) {
  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const previousValues = previous?.map((point) => point.value) ?? [];
  const max = Math.max(...values, ...previousValues);
  const peakIndex = values.indexOf(Math.max(...values));
  const lastIndex = points.length - 1;
  const labelStep = Math.ceil(points.length / MAX_LABELS);

  const x = (index: number) => (index / lastIndex) * 100;
  const y = (value: number) => PAD_TOP + (1 - value / (max || 1)) * (H - PAD_TOP);

  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const area = `0,${H} ${line} 100,${H}`;
  const previousLine =
    previous && previous.length === points.length
      ? previous.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
      : undefined;

  return (
    <figure className="m-0">
      <div className="relative" aria-hidden="true">
        {/* Grade: referência de escala, não decoração. */}
        <div className="absolute inset-0 flex flex-col justify-between">
          {Array.from({ length: GRID_LINES + 1 }, (_, index) => (
            <span key={index} className="h-px w-full bg-line-soft" />
          ))}
        </div>

        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          className="relative h-30 w-full overflow-visible"
        >
          {previousLine ? (
            <polyline
              points={previousLine}
              fill="none"
              stroke="var(--color-dim)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          <polygon points={area} fill="var(--color-brand)" opacity="0.1" />
          <polyline
            points={line}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((point, index) =>
            index === peakIndex || index === lastIndex ? (
              <circle
                key={point.label}
                cx={x(index)}
                cy={y(point.value)}
                r={index === lastIndex ? 3 : 2.5}
                fill={index === lastIndex ? 'var(--color-brand)' : 'var(--color-surface)'}
                stroke="var(--color-brand)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}
        </svg>

        {/* Rótulos só onde carregam informação: o pico e o agora. */}
        {[peakIndex, lastIndex].map((index, position) => {
          const point = points[index];
          if (!point || (position === 1 && index === peakIndex)) return null;
          return (
            <span
              key={point.label}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full font-mono text-meta font-semibold text-ink tabular-nums"
              style={{ left: `${x(index)}%`, top: `${(y(point.value) / H) * 100}%` }}
            >
              {point.value}
            </span>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between" aria-hidden="true">
        {points.map((point, index) => {
          const show = index === lastIndex || index % labelStep === 0;
          return (
            <span
              key={`${point.label}-${index}`}
              className={
                index === lastIndex
                  ? 'text-meta font-semibold text-ink'
                  : 'text-meta text-dim'
              }
            >
              {show ? point.label : ' '}
            </span>
          );
        })}
      </div>

      {previousLine ? (
        <p className="mt-2 flex items-center gap-3 text-meta text-dim" aria-hidden="true">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-brand" />
            Período atual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-dim" />
            {previousLabel ?? 'Período anterior'}
          </span>
        </p>
      ) : null}

      <figcaption className="sr-only">
        Volume de conversas por dia:{' '}
        {points.map((point) => `${point.label}: ${point.value}`).join(', ')}.
        {previous && previous.length > 0
          ? ` ${previousLabel ?? 'Período anterior'}: ${previous
              .map((point) => `${point.label}: ${point.value}`)
              .join(', ')}.`
          : ''}
      </figcaption>
    </figure>
  );
}
