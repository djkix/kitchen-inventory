/**
 * Thème clair ou sombre (2026-10-23). Trois choix : `auto` suit le réglage du
 * téléphone, `light` et `dark` l'imposent.
 *
 * « Selon la luminosité » au sens strict n'est pas atteignable sur le web :
 * l'API du capteur de lumière ambiante n'est exposée nulle part sur iOS et
 * reste derrière un drapeau ailleurs. `prefers-color-scheme` est ce qui s'en
 * approche — le système, lui, bascule à l'heure ou au capteur selon ce que
 * l'utilisateur y a réglé.
 *
 * La préférence vit dans `localStorage`, pas en base : c'est un réglage
 * d'appareil, pas du foyer. Le téléphone dans le cellier et le portable au
 * bureau n'ont aucune raison de partager leur luminosité.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'kitchen.theme';

/** Couleur de la barre d'état, par thème : `--color-ink`, en dur car lue avant la feuille de style. */
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#111716', light: '#f7f5ef' };

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    // Navigation privée, stockage refusé : l'application marche quand même.
    return 'auto';
  }
}

export function writeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Sans stockage, le choix ne survit pas au rechargement : tant pis, il s'applique tout de suite.
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'auto' ? systemTheme() : choice;
}

/** Pose le thème résolu sur `<html>` et accorde la barre d'état du téléphone. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
}

/**
 * Suit le réglage du système tant que le choix est `auto` ; rend la fonction
 * de désabonnement. Sans cela, basculer le téléphone en sombre à la tombée de
 * la nuit ne changerait rien tant que l'application reste ouverte.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia('(prefers-color-scheme: light)');
  const handler = (event: MediaQueryListEvent) => onChange(event.matches ? 'light' : 'dark');
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}
