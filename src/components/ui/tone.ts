import type { Tone } from '@/core/domain/label';

/**
 * Mapa unico de tom semantico -> classes de token.
 * Componentes nunca escrevem cor literal: pedem um tom (OCP + consistencia visual).
 */
export const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  amber: 'bg-amber-soft text-amber-text',
  green: 'bg-green-soft text-green-text',
  red: 'bg-red-soft text-red-text',
  violet: 'bg-violet-soft text-violet-text',
  blue: 'bg-blue-soft text-blue-text',
  cyan: 'bg-cyan-soft text-cyan-text',
  slate: 'bg-slate-soft text-slate-text',
  pink: 'bg-pink-soft text-pink-text',
  indigo: 'bg-indigo-soft text-indigo-text',
};

export const TONE_TEXT_CLASSES: Readonly<Record<Tone, string>> = {
  amber: 'text-amber-text',
  green: 'text-green-text',
  red: 'text-red-text',
  violet: 'text-violet-text',
  blue: 'text-blue-text',
  cyan: 'text-cyan-text',
  slate: 'text-slate-text',
  pink: 'text-pink-text',
  indigo: 'text-indigo-text',
};

export const TONE_DOT_CLASSES: Readonly<Record<Tone, string>> = {
  amber: 'bg-amber-text',
  green: 'bg-green-text',
  red: 'bg-red-text',
  violet: 'bg-violet-text',
  blue: 'bg-blue-text',
  cyan: 'bg-cyan-text',
  slate: 'bg-slate-text',
  pink: 'bg-pink-text',
  indigo: 'bg-indigo-text',
};
