import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../hooks/use-theme';
import { THEME_STORAGE_KEY } from '../../lib/theme';
import { ThemeRow } from './theme-row';

function renderRow() {
  return render(
    <ThemeProvider>
      <ThemeRow />
    </ThemeProvider>,
  );
}

describe('ThemeRow', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('arrive en automatique', () => {
    renderRow();
    expect(screen.getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true');
  });

  it('applique le choix à la racine et le retient', () => {
    renderRow();
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: 'Clair' }).getAttribute('aria-checked')).toBe('true');
  });

  it('revenir en automatique oublie le choix', () => {
    renderRow();
    fireEvent.click(screen.getByRole('radio', { name: 'Sombre' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/Suit le réglage du téléphone/)).toBeTruthy();
  });
});
