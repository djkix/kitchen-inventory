import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readThemeChoice, resolveTheme, THEME_STORAGE_KEY, writeThemeChoice } from './theme';

/** Simule le réglage du téléphone, que jsdom ne rend pas par défaut. */
function systemPrefers(light: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') ? light : !light,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('thème clair/sombre', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('part en automatique quand rien n’a été choisi', () => {
    expect(readThemeChoice()).toBe('auto');
  });

  it('suit le réglage du téléphone en automatique', () => {
    systemPrefers(true);
    expect(resolveTheme('auto')).toBe('light');
    systemPrefers(false);
    expect(resolveTheme('auto')).toBe('dark');
  });

  it('impose le choix explicite, quel que soit le téléphone', () => {
    systemPrefers(true);
    expect(resolveTheme('dark')).toBe('dark');
    systemPrefers(false);
    expect(resolveTheme('light')).toBe('light');
  });

  it('retient un choix explicite et oublie l’automatique', () => {
    writeThemeChoice('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(readThemeChoice()).toBe('light');
    writeThemeChoice('auto');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemeChoice()).toBe('auto');
  });

  it('ignore une valeur abîmée dans le stockage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'fluo');
    expect(readThemeChoice()).toBe('auto');
  });

  it('reste en automatique si le stockage est refusé', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refusé');
    });
    expect(readThemeChoice()).toBe('auto');
  });

  it('pose le thème sur la racine et accorde la barre d’état', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#111716" /><meta name="color-scheme" content="dark" />';
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f7f5ef');
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('light');
  });
});
