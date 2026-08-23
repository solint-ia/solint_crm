import { cn } from '@/lib/cn';

interface SparklineProps {
  readonly points: readonly number[];
  /** Cor da linha. Aceita token CSS — nunca hex literal na UI. */
  readonly colorVar?: string;
  readonly className?: string;
  readonly label?: string;
}

const W = 100;
const H = 28;
const PAD = 2;

/**
 * Série compacta embutida no próprio indicador.
 *
 * Um número sozinho diz onde a operação está; a forma diz para onde ela vai.
 * Sem eixo, sem grade, sem rótulo: quem precisa do valor exato lê o número
 * grande ao lado — a linha existe só para dar a direção num relance.
 */
export function Sparkline({ points, colorVar = 'var(--color-brand)', className, label }: SparklineProps) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const x = (index: number) => PAD + (index / (points.length - 1)) * (W - PAD * 2);
  const y = (value: number) => H - PAD - ((value - min) / span) * (H - PAD * 2);

  const line = points.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const area = `${PAD},${H} ${line} ${W - PAD},${H}`;

  const lastIndex = points.length - 1;
  const lastValue = points[lastIndex] as number;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      className={cn('h-7 w-full overflow-visible', className)}
    >
      <polygon points={area} fill={colorVar} opacity="0.12" />
      <polyline
        points={line}
        fill="none"
        stroke={colorVar}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* O ponto final é o presente: é ele que o operador está lendo. */}
      <circle cx={x(lastIndex)} cy={y(lastValue)} r="2" fill={colorVar} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
