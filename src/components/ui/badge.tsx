import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from '@/core/domain/label';
import { cn } from '@/lib/cn';
import { isHexColor, TONE_CLASSES, TONE_DOT_CLASSES } from './tone';

interface BadgeProps {
  readonly tone?: Tone;
  readonly children: ReactNode;
  readonly withDot?: boolean;
  readonly className?: string;
}

/**
 * Dois caminhos de pintura, um peso visual só.
 *
 * O tom da paleta usa os tokens do tema (`bg-amber-soft` e companhia), que são
 * escolhidos a mão e continuam sendo a referência. A cor livre do seletor não
 * tem token, e antes era pintada aqui mesmo com `hex18` de fundo, `hex40` de
 * borda e o hexadecimal cru no texto — uma receita bem mais leve que a da
 * paleta. Lado a lado na lista de etiquetas, a recém-criada aparecia lavada e
 * de contraste baixo ao lado das que vieram do seed, com a mesma caixa e outro
 * peso.
 *
 * Agora a cor livre entra por `--chip` e a proporção mora em `.chip-tone`, no
 * CSS, onde o tema claro e o escuro podem inverter a direção do ajuste (no
 * claro o texto escurece, no escuro clareia) — coisa que um `style` inline não
 * consegue fazer sem saber o tema.
 */
export function Badge({ tone = 'slate', children, withDot = false, className }: BadgeProps) {
  const isHex = isHexColor(tone);
  const toneClass = !isHex ? (TONE_CLASSES[tone] ?? TONE_CLASSES.slate) : undefined;
  const dotClass = !isHex ? (TONE_DOT_CLASSES[tone] ?? TONE_DOT_CLASSES.slate) : undefined;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 text-meta font-semibold tracking-tight whitespace-nowrap border transition-colors',
        isHex ? 'chip-tone' : toneClass,
        className,
      )}
      style={isHex ? ({ '--chip': tone } as CSSProperties) : undefined}
    >
      {withDot ? (
        <span
          className={cn('size-1.5 rounded-full shrink-0', dotClass)}
          style={isHex ? { backgroundColor: tone } : undefined}
        />
      ) : null}
      {children}
    </span>
  );
}
