import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Une classes condicionais resolvendo conflitos do Tailwind. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
