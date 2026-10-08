import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { RecipeTabSwitch } from './recipe-tab-switch';

function renderSwitch(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/recettes"
          element={
            <>
              <p>Écran Suggestions</p>
              <RecipeTabSwitch />
            </>
          }
        />
        <Route
          path="/recettes/bibliotheque"
          element={
            <>
              <p>Écran Mes recettes</p>
              <RecipeTabSwitch />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RecipeTabSwitch', () => {
  afterEach(() => localStorage.clear());

  it('bascule de Suggestions vers Mes recettes', () => {
    renderSwitch('/recettes');
    fireEvent.click(screen.getByRole('link', { name: 'Mes recettes' }));
    expect(screen.getByText('Écran Mes recettes')).toBeTruthy();
  });

  it('bascule de Mes recettes vers Suggestions', () => {
    renderSwitch('/recettes/bibliotheque');
    fireEvent.click(screen.getByRole('link', { name: 'Suggestions' }));
    expect(screen.getByText('Écran Suggestions')).toBeTruthy();
  });

  it('annonce le volet actif par aria-current, pas seulement par la couleur', () => {
    renderSwitch('/recettes/bibliotheque');
    expect(screen.getByRole('link', { name: 'Mes recettes' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Suggestions' }).getAttribute('aria-current')).toBeNull();
  });

  it('mémorise le dernier volet ouvert pour que l’onglet Recettes y retombe', () => {
    renderSwitch('/recettes/bibliotheque');
    expect(localStorage.getItem('kitchen.recipes.lastTab')).toBe('bibliotheque');
  });
});
