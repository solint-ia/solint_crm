'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  CheckCircle2,
  Inbox,
  MessageCircle,
  XCircle,
} from 'lucide-react';

import type { TimeSeriePoint } from '@/core/domain/analytics';
import { cn } from '@/lib/cn';

interface VolumeChartCardProps {
  readonly points: readonly TimeSeriePoint[];
  readonly periodLabel: string;
}

type VolumeMetric = 'recebidas' | 'respondidas' | 'resolvidas' | 'abandonadas';

const METRIC_TABS: readonly {
  id: VolumeMetric;
  label: string;
  icon: React.ElementType;
  colorVar: string;
}[] = [
  { id: 'recebidas', label: 'Recebidas', icon: Inbox, colorVar: 'var(--color-brand)' },
  { id: 'respondidas', label: 'Respondidas', icon: MessageCircle, colorVar: 'var(--color-blue-text)' },
  { id: 'resolvidas', label: 'Resolvidas', icon: CheckCircle2, colorVar: 'var(--color-status-open)' },
  { id: 'abandonadas', label: 'Abandonadas', icon: XCircle, colorVar: 'var(--color-status-danger)' },
];

export function VolumeChartCard({ points, periodLabel }: VolumeChartCardProps) {
  const [metric, setMetric] = useState<VolumeMetric>('recebidas');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const seriesData = useMemo(() => {
    return points.map((p) => {
      let val = p.value;
      if (metric === 'respondidas') val = p.answered ?? Math.round(p.value * 0.92);
      if (metric === 'resolvidas') val = p.resolved ?? Math.round(p.value * 0.85);
      if (metric === 'abandonadas') val = p.abandoned ?? Math.max(0, Math.round(p.value * 0.04));
      return { label: p.label, value: val };
    });
  }, [points, metric]);

  const totalVolume = useMemo(
    () => seriesData.reduce((acc, curr) => acc + curr.value, 0),
    [seriesData],
  );

  const values = seriesData.map((d) => d.value);
  const maxValue = Math.max(...values, 1);
  const peakIndex = values.indexOf(Math.max(...values));

  const height = 160;
  const paddingY = 20;

  const getX = useCallback(
    (index: number) => {
      if (seriesData.length <= 1) return 50;
      return (index / (seriesData.length - 1)) * 100;
    },
    [seriesData.length],
  );

  const getY = useCallback(
    (value: number) => {
      return paddingY + (1 - value / maxValue) * (height - paddingY * 2);
    },
    [maxValue],
  );

  const pathD = useMemo(() => {
    if (seriesData.length < 2) return '';
    return seriesData
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.value)}`)
      .join(' ');
  }, [seriesData, getX, getY]);

  const areaD = useMemo(() => {
    if (seriesData.length < 2) return '';
    const firstX = getX(0);
    const lastX = getX(seriesData.length - 1);
    return `${pathD} L ${lastX} ${height} L ${firstX} ${height} Z`;
  }, [pathD, seriesData.length, getX]);


  const activeColor = METRIC_TABS.find((m) => m.id === metric)?.colorVar || 'var(--color-brand)';

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xs">
      {/* Cabeçalho com Tabs */}
      <div className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-bold text-ink">Volume de conversas</h2>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
              {periodLabel}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Total acumulado no período: <strong className="font-bold text-ink tabular-nums">{totalVolume.toLocaleString('pt-BR')}</strong>
          </p>
        </div>

        {/* Alternador de Métricas */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface-2 p-1">
          {METRIC_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = metric === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMetric(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                  active
                    ? 'bg-surface text-ink shadow-2xs font-bold'
                    : 'text-muted hover:text-ink',
                )}
              >
                <Icon className="size-3.5" style={{ color: active ? tab.colorVar : undefined }} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Gráfico Interativo */}
      <div className="relative mt-5 h-44 w-full">
        {/* Linhas de Grade */}
        <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
          <div className="border-b border-line-soft/80" />
          <div className="border-b border-line-soft/80" />
          <div className="border-b border-line-soft/80" />
          <div className="border-b border-line-soft/80" />
        </div>

        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          className="relative h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={activeColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={activeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Área com gradiente */}
          {areaD && <path d={areaD} fill="url(#chartGradient)" />}

          {/* Linha principal do gráfico */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={activeColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Pontos de destaque no gráfico */}
          {seriesData.map((pt, i) => {
            const isHovered = hoverIndex === i;
            const isPeak = i === peakIndex;
            const isLast = i === seriesData.length - 1;

            if (!isHovered && !isPeak && !isLast) return null;

            return (
              <circle
                key={pt.label}
                cx={getX(i)}
                cy={getY(pt.value)}
                r={isHovered ? 4.5 : 3}
                fill="var(--color-surface)"
                stroke={activeColor}
                strokeWidth={isHovered ? 2.5 : 1.5}
                vectorEffect="non-scaling-stroke"
                className="transition-all"
              />
            );
          })}
        </svg>

        {/* Hover detection zones */}
        <div className="absolute inset-0 flex justify-between">
          {seriesData.map((pt, i) => (
            <div
              key={pt.label}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              className="group relative h-full flex-1 cursor-pointer"
            >
              {hoverIndex === i && (
                <div
                  className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-ink shadow-sm tabular-nums whitespace-nowrap"
                  style={{ top: `${(getY(pt.value) / height) * 100 - 30}%` }}
                >
                  <span className="font-medium text-muted">{pt.label}: </span>
                  {pt.value} {metric}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rótulos do Eixo X */}
      <div className="mt-2 flex justify-between border-t border-line-soft pt-2 text-[11px] font-medium text-muted">
        {seriesData.map((pt, i) => {
          const step = Math.ceil(seriesData.length / 8);
          const show = i === 0 || i === seriesData.length - 1 || i % step === 0;
          return (
            <span key={pt.label} className={cn(i === seriesData.length - 1 && 'font-bold text-ink')}>
              {show ? pt.label : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
