import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { BottomNav } from './bottom-nav';

function renderNav(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<p>Écran Stock</p>} />
        <Route path="/recettes" element={<p>Écran Suggestions</p>} />
        <Route path="/recettes/bibliotheque" element={<p>Écran Mes recettes</p>} />
      </Routes>
      <BottomNav />
    </MemoryRouter>,
  );
}

/**
 * Suggestions est désormais l'entrée du module recettes (section 12, EF-26,
 * tâche 13) : la navigation ne doit plus ouvrir « Mes recettes » depuis cet
 * onglet par défaut — sauf si c'est le volet mémorisé (tâche 9).
 */
describe('BottomNav', () => {
  afterEach(() => localStorage.clear());

  it('ouvre Suggestions quand on touche Recettes, sans volet mémorisé (B12)', () => {
    renderNav('/');

    fireEvent.click(screen.getByRole('link', { name: /Recettes/i }));

    expect(screen.getByText('Écran Suggestions')).toBeTruthy();
  });

  it('retombe sur le dernier volet mémorisé (tâche 9)', () => {
    localStorage.setItem('kitchen.recipes.lastTab', 'bibliotheque');
    renderNav('/');

    fireEvent.click(screen.getByRole('link', { name: /Recettes/i }));

    expect(screen.getByText('Écran Mes recettes')).toBeTruthy();
  });

  it('retombe sur Suggestions si le stockage est indisponible (navigation privée)', () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('SecurityError');
    };
    try {
      renderNav('/');
      fireEvent.click(screen.getByRole('link', { name: /Recettes/i }));
      expect(screen.getByText('Écran Suggestions')).toBeTruthy();
    } finally {
      Storage.prototype.getItem = originalGetItem;
    }
  });
});
