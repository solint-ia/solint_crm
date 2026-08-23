import type { ReactNode } from 'react';
import type { Tone } from '@/core/domain/label';
import { cn } from '@/lib/cn';
import { TONE_CLASSES, TONE_DOT_CLASSES } from './tone';

interface BadgeProps {
  readonly tone?: Tone;
  readonly children: ReactNode;
  readonly withDot?: boolean;
  readonly className?: string;
}

export function Badge({ tone = 'slate', children, withDot = false, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 text-meta font-semibold tracking-tight whitespace-nowrap transition-colors',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {withDot ? (
        <span className={cn('size-1.5 rounded-full shrink-0', TONE_DOT_CLASSES[tone])} />
      ) : null}
      {children}
    </span>
  );
}
