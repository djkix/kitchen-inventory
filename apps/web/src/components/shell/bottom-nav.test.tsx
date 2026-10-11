import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
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
 * Suggestions est l'écran d'entrée du module recettes, toujours (A1,
 * décision D1) : la mémorisation du dernier volet est retirée, pas
 * seulement ignorée.
 */
describe('BottomNav', () => {
  it('ouvre toujours Suggestions quand on touche Recettes', () => {
    renderNav('/');

    fireEvent.click(screen.getByRole('link', { name: /Recettes/i }));

    expect(screen.getByText('Écran Suggestions')).toBeTruthy();
  });

  it('reste actif sur l’onglet Recettes depuis « Mes recettes »', () => {
    renderNav('/recettes/bibliotheque');

    expect(screen.getByRole('link', { name: /Recettes/i }).getAttribute('aria-current')).toBe('page');
  });
});
