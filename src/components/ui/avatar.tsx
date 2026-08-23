'use client';

import { useEffect, useState } from 'react';
import type { AvailabilityStatus } from '@/core/domain/user';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/cn';

const SIZES = {
  xs: 'size-6 text-micro',
  sm: 'size-8 text-meta',
  md: 'size-10 text-ui',
  lg: 'size-14 text-metric',
} as const;

const AVAILABILITY_COLOR: Readonly<Record<AvailabilityStatus, string>> = {
  disponivel: 'bg-status-open',
  ocupado: 'bg-status-danger',
  ausente: 'bg-status-pending',
};

interface AvatarProps {
  readonly name: string;
  readonly tone?: string;
  /** Foto real (ex.: perfil do WhatsApp). Cai para as iniciais se falhar ao carregar. */
  readonly src?: string;
  readonly size?: keyof typeof SIZES;
  readonly availability?: AvailabilityStatus;
  readonly className?: string;
}

export function Avatar({ name, tone, src, size = 'md', availability, className }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-full font-semibold text-white',
          SIZES[size],
        )}
        style={{ backgroundColor: tone ?? 'var(--color-brand)' }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          initialsOf(name)
        )}
      </span>
      <span className="sr-only">{name}</span>
      {availability ? (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface',
            AVAILABILITY_COLOR[availability],
          )}
        />
      ) : null}
    </span>
  );
}
