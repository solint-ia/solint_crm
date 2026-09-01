'use client';

import { useEffect, useState } from 'react';
import { Check, Pipette } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ColorPickerProps {
  readonly value: string;
  readonly onChange: (color: string) => void;
  readonly label?: string;
  readonly className?: string;
}

/** Cores pré-definidas modernas como atalhos rápidos */
export const POPULAR_COLORS = [
  { hex: '#3B82F6', name: 'Azul' },
  { hex: '#10B981', name: 'Verde Esmeralda' },
  { hex: '#F59E0B', name: 'Âmbar' },
  { hex: '#EF4444', name: 'Vermelho' },
  { hex: '#8B5CF6', name: 'Violeta' },
  { hex: '#EC4899', name: 'Rosa' },
  { hex: '#06B6D4', name: 'Ciano' },
  { hex: '#6366F1', name: 'Índigo' },
  { hex: '#F97316', name: 'Laranja' },
  { hex: '#14B8A6', name: 'Teal' },
  { hex: '#64748B', name: 'Cinza' },
  { hex: '#1E293B', name: 'Grafite' },
] as const;

/** Mapeamento de tons legados para valores HEX */
export const TONE_TO_HEX: Record<string, string> = {
  blue: '#3B82F6',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  violet: '#8B5CF6',
  cyan: '#06B6D4',
  pink: '#EC4899',
  slate: '#64748B',
  indigo: '#6366F1',
};

/** Normaliza qualquer valor de cor para HEX #RRGGBB */
export function normalizeToHex(color: string): string {
  if (!color) return '#3B82F6';
  const trimmed = color.trim().toLowerCase();
  if (TONE_TO_HEX[trimmed]) return TONE_TO_HEX[trimmed]!;
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) {
      // #RGB -> #RRGGBB
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toUpperCase();
    }
    if (trimmed.length === 7) return trimmed.toUpperCase();
  }
  // Se for código HEX sem #
  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }
  return '#3B82F6';
}

export function ColorPicker({ value, onChange, label, className }: ColorPickerProps) {
  const currentHex = normalizeToHex(value);
  const [hexInput, setHexInput] = useState(currentHex);

  useEffect(() => {
    setHexInput(normalizeToHex(value));
  }, [value]);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    setHexInput(raw);
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
      onChange(withHash.toUpperCase());
    }
  };

  const handleNativeColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = e.target.value.toUpperCase();
    setHexInput(newHex);
    onChange(newHex);
  };

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {label ? <span className="text-body font-semibold text-ink">{label}</span> : null}

      {/* Linha Principal: Seletor Visual de Gradiente + Input Hexadecimal */}
      <div className="flex items-center gap-2.5">
        {/* Caixa de Cor com gatilho nativo para o quadro de espectro */}
        <div className="relative group flex items-center justify-center size-9 shrink-0 rounded-xl border border-line shadow-2xs overflow-hidden cursor-pointer transition-transform hover:scale-105">
          <div
            className="absolute inset-0 transition-colors"
            style={{ backgroundColor: currentHex }}
          />
          <Pipette className="relative z-10 size-4 text-white drop-shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
          <input
            type="color"
            aria-label="Escolher cor no espectro livre"
            value={currentHex}
            onChange={handleNativeColorChange}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full p-0 border-0"
            title="Clique para abrir a paleta de cores livre"
          />
        </div>

        {/* Campo de Código Hexadecimal */}
        <div className="relative flex-1 flex items-center">
          <span className="pointer-events-none absolute left-2.5 font-mono text-xs font-semibold text-dim">
            #
          </span>
          <input
            type="text"
            value={hexInput.replace(/^#/, '')}
            onChange={handleHexChange}
            placeholder="3B82F6"
            maxLength={6}
            className="h-9 w-full rounded-control border border-line bg-surface pr-3 pl-6 font-mono text-body font-semibold uppercase text-ink outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/20"
          />
        </div>

        {/* Pré-visualização da Cor */}
        <div
          className="flex h-9 items-center justify-center rounded-control border px-3 text-xs font-semibold shadow-2xs"
          style={{
            backgroundColor: `${currentHex}18`,
            borderColor: `${currentHex}40`,
            color: currentHex,
          }}
        >
          Exemplo
        </div>
      </div>

      {/* Atalhos de Cores Populares */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-dim">Cores sugeridas:</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {POPULAR_COLORS.map((c) => {
            const isSelected = currentHex.toUpperCase() === c.hex.toUpperCase();
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => {
                  setHexInput(c.hex);
                  onChange(c.hex);
                }}
                title={`${c.name} (${c.hex})`}
                className={cn(
                  'relative size-6 shrink-0 rounded-lg border transition-all duration-150 flex items-center justify-center',
                  isSelected
                    ? 'border-brand ring-2 ring-brand/30 scale-110'
                    : 'border-line hover:scale-105 hover:border-ink/40',
                )}
                style={{ backgroundColor: c.hex }}
              >
                {isSelected ? <Check className="size-3 text-white drop-shadow-sm" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
