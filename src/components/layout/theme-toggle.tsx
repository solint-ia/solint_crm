'use client';

import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_STORAGE_KEY, type ThemePreference } from '@/lib/theme';

const readTheme = (): ThemePreference =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/** Alterna o tema e persiste a preferencia por navegador. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>('light');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = useCallback(() => {
    const next: ThemePreference = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Armazenamento indisponivel: o tema vale apenas para esta sessão.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
      className="flex size-9 items-center justify-center rounded-control text-dim transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
