import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { receiptsApi } from '../../lib/receipts-api';
import { BottomNav } from './bottom-nav';

vi.mock('../../lib/receipts-api', () => ({ receiptsApi: { pendingLabelCount: vi.fn().mockResolvedValue({ count: 0 }) } }));

function renderNav(initialPath: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<p>Écran Stock</p>} />
        <Route path="/recettes" element={<p>Écran Suggestions</p>} />
        <Route path="/recettes/bibliotheque" element={<p>Écran Mes recettes</p>} />
      </Routes>
      <BottomNav />
    </MemoryRouter>
    </QueryClientProvider>,
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

  it('la pastille de l’onglet Courses porte le nombre de libellés en attente (EF-29)', async () => {
    vi.mocked(receiptsApi.pendingLabelCount).mockResolvedValueOnce({ count: 4 });
    renderNav('/');

    expect((await screen.findByLabelText('4 libellés en attente')).textContent).toBe('4');
  });
});
