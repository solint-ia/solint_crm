import type { ReactNode } from 'react';
import type { Tone } from '@/core/domain/label';
import { cn } from '@/lib/cn';
import { isHexColor, TONE_CLASSES, TONE_DOT_CLASSES } from './tone';

interface BadgeProps {
  readonly tone?: Tone;
  readonly children: ReactNode;
  readonly withDot?: boolean;
  readonly className?: string;
}

export function Badge({ tone = 'slate', children, withDot = false, className }: BadgeProps) {
  const isHex = isHexColor(tone);
  const toneClass = !isHex ? (TONE_CLASSES[tone] ?? TONE_CLASSES.slate) : undefined;
  const dotClass = !isHex ? (TONE_DOT_CLASSES[tone] ?? TONE_DOT_CLASSES.slate) : undefined;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 text-meta font-semibold tracking-tight whitespace-nowrap border transition-colors',
        toneClass,
        className,
      )}
      style={
        isHex
          ? {
              backgroundColor: `${tone}18`,
              borderColor: `${tone}40`,
              color: tone,
            }
          : undefined
      }
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

