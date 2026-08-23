import type { Id } from './shared';

/** Paleta semântica disponível para etiquetas e badges (mapeada em tokens de tema). */
export const TONES = [
  'amber',
  'green',
  'red',
  'violet',
  'blue',
  'cyan',
  'slate',
  'pink',
  'indigo',
] as const;
export type Tone = (typeof TONES)[number];

export interface Label {
  readonly id: Id;
  readonly accountId: Id;
  readonly name: string;
  readonly tone: Tone;
  readonly description?: string;
  readonly usageCount?: number;
}
