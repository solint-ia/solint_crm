'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TextInput } from './field';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Campo de senha com o olho que mostra e esconde o que foi digitado. */
export function PasswordInput({ className, ...rest }: PasswordInputProps) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="relative">
      <TextInput
        {...rest}
        type={visivel ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        onClick={() => setVisivel((atual) => !atual)}
        aria-label={visivel ? 'Ocultar senha' : 'Exibir senha'}
        aria-pressed={visivel}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-dim transition-colors hover:text-ink"
      >
        {visivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
