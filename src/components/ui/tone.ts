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

export const TONE_CLASSES: Readonly<Record<string, string>> = {
  amber: 'bg-amber-soft text-amber-text border-amber-line/40',
  green: 'bg-green-soft text-green-text border-green-line/40',
  red: 'bg-red-soft text-red-text border-red-line/40',
  violet: 'bg-violet-soft text-violet-text border-violet-line/40',
  blue: 'bg-blue-soft text-blue-text border-blue-line/40',
  cyan: 'bg-cyan-soft text-cyan-text border-cyan-line/40',
  slate: 'bg-slate-soft text-slate-text border-slate-line/40',
  pink: 'bg-pink-soft text-pink-text border-pink-line/40',
  indigo: 'bg-indigo-soft text-indigo-text border-indigo-line/40',
};

export const TONE_TEXT_CLASSES: Readonly<Record<string, string>> = {
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

export const TONE_DOT_CLASSES: Readonly<Record<string, string>> = {
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

export function isHexColor(color?: string): boolean {
  if (!color) return false;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color.trim());
}

