'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pipette } from 'lucide-react';
import { hexToHsv, hsvToHex } from '@/lib/color';
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

  const areaRef = useRef<HTMLDivElement>(null);
  const matizRef = useRef<HTMLDivElement>(null);
  const [arrastandoArea, setArrastandoArea] = useState(false);
  const [arrastandoMatiz, setArrastandoMatiz] = useState(false);

  /**
   * A matiz é guardada aqui, e não derivada do hex a cada render.
   *
   * Cinza, preto e branco não têm matiz definida: `hexToHsv('#000000')` devolve
   * 0 porque não há o que devolver. Sem esta memória, arrastar o brilho até o
   * fundo do quadro jogaria o ponteiro da faixa de matiz para o vermelho, e
   * subir de volta traria uma cor diferente da que a pessoa estava ajustando.
   */
  const [matiz, setMatiz] = useState(() => hexToHsv(currentHex).h);
  // Memorizado porque os handlers dependem dele: recriado a cada render, cada
  // `useCallback` abaixo também seria, e o `useCallback` deixaria de servir.
  const hsv = useMemo(() => {
    const derivado = hexToHsv(currentHex);
    return { h: derivado.s === 0 ? matiz : derivado.h, s: derivado.s, v: derivado.v };
  }, [currentHex, matiz]);

  const aplicar = useCallback(
    (proximo: { h: number; s: number; v: number }) => {
      const hex = hsvToHex(proximo);
      setMatiz(proximo.h);
      setHexInput(hex);
      onChange(hex);
    },
    [onChange],
  );

  const pararArrasto = useCallback(() => {
    setArrastandoArea(false);
    setArrastandoMatiz(false);
  }, []);

  /**
   * O gesto usa Pointer Events, não Mouse Events.
   *
   * Um único caminho atende mouse, toque e caneta — e `setPointerCapture` é o
   * que faz o arrasto continuar valendo quando o dedo sai do quadro, que é o
   * caso comum ao buscar o canto de saturação máxima.
   */
  const aoArrastarArea = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      const caixa = areaRef.current?.getBoundingClientRect();
      if (!caixa) return;
      if (evento.type === 'pointerdown') {
        setArrastandoArea(true);
        areaRef.current?.setPointerCapture(evento.pointerId);
      }
      const s = Math.min(1, Math.max(0, (evento.clientX - caixa.left) / caixa.width));
      const v = 1 - Math.min(1, Math.max(0, (evento.clientY - caixa.top) / caixa.height));
      aplicar({ h: hsv.h, s, v });
    },
    [aplicar, hsv.h],
  );

  const aoArrastarMatiz = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      const caixa = matizRef.current?.getBoundingClientRect();
      if (!caixa) return;
      if (evento.type === 'pointerdown') {
        setArrastandoMatiz(true);
        matizRef.current?.setPointerCapture(evento.pointerId);
      }
      const proporcao = Math.min(1, Math.max(0, (evento.clientX - caixa.left) / caixa.width));
      aplicar({ h: proporcao * 360, s: hsv.s, v: hsv.v });
    },
    [aplicar, hsv.s, hsv.v],
  );

  /** Setas ajustam sem mouse: os dois blocos são `role="slider"` e recebem foco. */
  const aoTeclarNaArea = useCallback(
    (evento: React.KeyboardEvent<HTMLDivElement>) => {
      const passo = evento.shiftKey ? 0.1 : 0.02;
      const mapa: Record<string, { s: number; v: number }> = {
        ArrowRight: { s: passo, v: 0 },
        ArrowLeft: { s: -passo, v: 0 },
        ArrowUp: { s: 0, v: passo },
        ArrowDown: { s: 0, v: -passo },
      };
      const delta = mapa[evento.key];
      if (!delta) return;
      evento.preventDefault();
      aplicar({
        h: hsv.h,
        s: Math.min(1, Math.max(0, hsv.s + delta.s)),
        v: Math.min(1, Math.max(0, hsv.v + delta.v)),
      });
    },
    [aplicar, hsv],
  );

  const aoTeclarNaMatiz = useCallback(
    (evento: React.KeyboardEvent<HTMLDivElement>) => {
      const passo = evento.shiftKey ? 30 : 5;
      const delta =
        evento.key === 'ArrowRight' ? passo : evento.key === 'ArrowLeft' ? -passo : undefined;
      if (delta === undefined) return;
      evento.preventDefault();
      aplicar({ h: (hsv.h + delta + 360) % 360, s: hsv.s, v: hsv.v });
    },
    [aplicar, hsv],
  );

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

      {/* Quadro de saturação e brilho, arrastável.

          O `<input type="color">` acima abre o seletor do sistema operacional,
          que muda de navegador para navegador e no Windows é uma caixa de
          diálogo pobre. Este quadro é o mesmo gesto sem sair da página: arrastar
          o ponto escolhe saturação (eixo X) e brilho (eixo Y), e a faixa
          embaixo escolhe a matiz. */}
      <div className="flex flex-col gap-2">
        <div
          ref={areaRef}
          role="slider"
          tabIndex={0}
          aria-label="Saturação e brilho"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={`Saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
          onPointerDown={aoArrastarArea}
          onPointerMove={arrastandoArea ? aoArrastarArea : undefined}
          onPointerUp={pararArrasto}
          onKeyDown={aoTeclarNaArea}
          className="relative h-28 w-full cursor-crosshair touch-none rounded-xl border border-line shadow-2xs outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
        >
          {/* Branco na horizontal e preto na vertical: os dois gradientes
              sobrepostos desenham exatamente o plano saturação × brilho. */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-white to-transparent" />
          <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black to-transparent" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/30"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              backgroundColor: currentHex,
            }}
          />
        </div>

        <div
          ref={matizRef}
          role="slider"
          tabIndex={0}
          aria-label="Matiz"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onPointerDown={aoArrastarMatiz}
          onPointerMove={arrastandoMatiz ? aoArrastarMatiz : undefined}
          onPointerUp={pararArrasto}
          onKeyDown={aoTeclarNaMatiz}
          className="relative h-3.5 w-full cursor-ew-resize touch-none rounded-full border border-line shadow-2xs outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          style={{
            background:
              'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/30"
            style={{
              left: `${(hsv.h / 360) * 100}%`,
              backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }),
            }}
          />
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
