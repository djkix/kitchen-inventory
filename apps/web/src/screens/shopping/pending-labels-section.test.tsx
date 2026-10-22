import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { receiptsApi } from '../../lib/receipts-api';
import { PendingLabelsSection } from './pending-labels-section';

vi.mock('../../lib/receipts-api', () => ({ receiptsApi: { pendingLabels: vi.fn(), pendingLabelCount: vi.fn(), attachLabel: vi.fn() } }));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), api: { get: vi.fn() } }));

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <PendingLabelsSection />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(receiptsApi.pendingLabels).mockResolvedValue([{ label: 'PQ FILTRE', seenAt: '2026-10-22T10:00:00.000Z', count: 3 }]);
  vi.mocked(receiptsApi.attachLabel).mockResolvedValue(undefined);
  vi.mocked(api.get).mockResolvedValue({ items: [{ id: 'p1', name: 'Café filtre', brand: null }], total: 1, page: 1, limit: 20 });
});

describe('PendingLabelsSection (EF-29)', () => {
  it('compte des lignes par libellé et rattache un libellé à un produit', async () => {
    renderSection();
    expect(await screen.findByText('vu sur 3 lignes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rattacher PQ FILTRE' }));
    fireEvent.change(screen.getByLabelText('Rechercher un produit'), { target: { value: 'caf' } });
    fireEvent.click(await screen.findByRole('button', { name: /Café filtre/ }));
    await waitFor(() => expect(receiptsApi.attachLabel).toHaveBeenCalledWith({ label: 'PQ FILTRE', productId: 'p1' }));
  });

  it('n’affiche rien quand aucun libellé n’attend', async () => {
    vi.mocked(receiptsApi.pendingLabels).mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(receiptsApi.pendingLabels).toHaveBeenCalled());
    expect(screen.queryByText(/Libellés à rattacher/)).toBeNull();
  });
});
