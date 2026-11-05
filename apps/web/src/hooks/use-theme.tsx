import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyTheme, readThemeChoice, resolveTheme, watchSystemTheme, writeThemeChoice, type ResolvedTheme, type ThemeChoice } from '../lib/theme';

export interface Theme {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  set: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Le choix de thème (2026-10-23), partagé entre la ligne de Réglages qui le
 * change et l'effet qui suit le système tant qu'on est en automatique. Les
 * deux ont besoin du même état : sans contexte, choisir « sombre » à la main
 * laisserait l'écouteur système repasser l'application en clair au matin.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readThemeChoice()));

  useEffect(() => {
    const next = resolveTheme(choice);
    setResolved(next);
    applyTheme(next);
    if (choice !== 'auto') return;
    return watchSystemTheme((system) => {
      setResolved(system);
      applyTheme(system);
    });
  }, [choice]);

  const set = useCallback((next: ThemeChoice) => {
    writeThemeChoice(next);
    setChoice(next);
  }, []);

  const value = useMemo(() => ({ choice, resolved, set }), [choice, resolved, set]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme hors de ThemeProvider');
  return theme;
}
