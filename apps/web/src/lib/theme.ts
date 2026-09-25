import { useCallback, useState } from 'react';
import { readStorage, writeStorage } from './storage.ts';

export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'casino-theme';

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'light' ? '#f4efe3' : '#0b2a1f');
}

/** Reads the saved preference (default: dark "green felt" theme). */
export function initTheme(): void {
  const saved = readStorage(THEME_STORAGE_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      writeStorage(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);
  return [theme, toggle];
}
