import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BottomNav } from './bottom-nav';

/**
 * Suggestions est désormais l'entrée du module recettes (section 12, EF-26,
 * tâche 13) : la navigation ne doit plus ouvrir « Mes recettes » depuis cet
 * onglet.
 */
describe('BottomNav', () => {
  it('ouvre Suggestions quand on touche Recettes (B12)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<p>Écran Stock</p>} />
          <Route path="/recettes" element={<p>Écran Suggestions</p>} />
        </Routes>
        <BottomNav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: /Recettes/i }));

    expect(screen.getByText('Écran Suggestions')).toBeTruthy();
  });
});
