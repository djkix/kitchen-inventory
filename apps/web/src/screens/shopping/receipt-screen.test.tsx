import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDto, ReceiptDto, ReceiptLineDto } from '@kitchen/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientError } from '../../lib/api';
import { receiptsApi } from '../../lib/receipts-api';
import { writeScanLocation } from '../../lib/scan-session';
import { ReceiptScreen } from './receipt-screen';

/** Écran du ticket de caisse (EF-29). Le réseau est doublé : aucune requête réelle. */
vi.mock('../../lib/receipts-api', () => ({
  receiptsApi: { read: vi.fn(), validate: vi.fn(), pendingLabels: vi.fn(), pendingLabelCount: vi.fn(), attachLabel: vi.fn() },
}));
const api = vi.mocked(receiptsApi);

const product = (id: string, name: string): ProductDto => ({
  id, barcode: null, name, originalName: null, brand: null, categoryId: null, defaultUnit: 'PIECE', netContent: null, netContentUnit: null,
  afterOpeningDays: null, minThreshold: null, imagePath: null, recognitionSource: 'MANUAL', confidence: null, createdAt: '', updatedAt: '',
});
const line = (over: Partial<ReceiptLineDto> & Pick<ReceiptLineDto, 'id' | 'position' | 'rawLabel' | 'state'>): ReceiptLineDto => ({
  quantity: 1, product: null, candidates: [], currentQuantity: 0, ...over,
});

const RECEIPT: ReceiptDto = {
  id: 'r1',
  locationId: 'loc1',
  // Volontairement désordonné : l'écran doit suivre `position`, pas l'ordre de réception.
  lines: [
    line({ id: 'l3', position: 2, rawLabel: 'ZZ INCONNU 500G', state: 'UNKNOWN' }),
    line({ id: 'l1', position: 0, rawLabel: 'YAOURT NAT', state: 'MATCHED', quantity: 1, currentQuantity: 2, product: product('p1', 'Yaourt nature') }),
    line({
      id: 'l2', position: 1, rawLabel: 'OLIVE NOIRE', state: 'AMBIGUOUS',
      // L'API met le candidat partiel en tête : l'écran doit remonter celui qui couvre le libellé.
      candidates: [product('p9', 'Olive verte'), product('p2', 'Olive noire')],
    }),
  ],
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ReceiptScreen />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function photograph(receipt: Promise<ReceiptDto> | ReceiptDto = RECEIPT) {
  api.read.mockImplementation(() => Promise.resolve(receipt));
  renderScreen();
  fireEvent.change(screen.getByTestId('receipt-file'), { target: { files: [new File(['x'], 't.jpg', { type: 'image/jpeg' })] } });
}

beforeEach(() => {
  localStorage.clear();
  writeScanLocation({ id: 'loc1', name: 'Frigo' });
  Object.values(api).forEach((m) => m.mockReset());
  api.pendingLabels.mockResolvedValue([]);
  api.validate.mockResolvedValue({ added: 1 });
});

describe('ReceiptScreen (EF-29)', () => {
  it('sans emplacement choisi, la prise de photo est indisponible', () => {
    localStorage.clear();
    renderScreen();
    expect((screen.getByRole('button', { name: 'Photographier le ticket' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('affiche les lignes dans l’ordre du ticket, reconnues et inconnues mêlées', async () => {
    await photograph();
    await screen.findByText('Yaourt nature');
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const at = (text: string) => rows.findIndex((r) => r.includes(text));
    expect(at('YAOURT NAT')).toBeLessThan(at('OLIVE NOIRE'));
    expect(at('OLIVE NOIRE')).toBeLessThan(at('ZZ INCONNU'));
  });

  it('coche une ligne MATCHED, pas une AMBIGUOUS ni une UNKNOWN, qui n’offre aucune case', async () => {
    await photograph();
    await screen.findByText('Yaourt nature');
    expect((screen.getByRole('checkbox', { name: 'Ajouter Yaourt nature' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Ajouter OLIVE NOIRE' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('Nouveau')).toBeTruthy();
  });

  it('affiche « 2 → 3 » sur une ligne MATCHED et le suit quand la quantité change', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    fireEvent.change(screen.getByRole('textbox', { name: 'Quantité de Yaourt nature' }), { target: { value: '3' } });
    expect(screen.getByText('2 → 5')).toBeTruthy();
  });

  it('envoie la quantité corrigée à la validation', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    fireEvent.change(screen.getByRole('textbox', { name: 'Quantité de Yaourt nature' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter 1 produit' }));
    await waitFor(() => expect(api.validate).toHaveBeenCalledTimes(1));
    expect(api.validate.mock.calls[0]?.[1].lines).toEqual([{ id: 'l1', productId: 'p1', quantity: 3, clientOpId: expect.any(String) }]);
  });

  it('choisir un candidat sur une ligne ambiguë la coche, et propose d’abord celui qui couvre le libellé', async () => {
    await photograph();
    await screen.findByText('Yaourt nature');
    const group = screen.getByRole('group', { name: 'Produit pour OLIVE NOIRE' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Olive noire', 'Olive verte']);
    fireEvent.click(within(group).getByRole('button', { name: 'Olive noire' }));
    expect((screen.getByRole('checkbox', { name: 'Ajouter Olive noire' }) as HTMLInputElement).checked).toBe(true);
  });

  it('annonce le nombre de produits à ajouter', async () => {
    await photograph();
    await screen.findByRole('button', { name: 'Ajouter 1 produit' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Produit pour OLIVE NOIRE' })).getByRole('button', { name: 'Olive noire' }));
    expect((screen.getByRole('button', { name: 'Ajouter 2 produits' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('une quantité invalide bloque la validation', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    // Une autre ligne reste valide : seul le refus de la quantité fautive peut bloquer.
    fireEvent.click(within(screen.getByRole('group', { name: 'Produit pour OLIVE NOIRE' })).getByRole('button', { name: 'Olive noire' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Quantité de Yaourt nature' }), { target: { value: '0' } });
    expect((screen.getByRole('button', { name: /^Ajouter/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('un ticket illisible affiche le message du serveur, pas une liste vide', async () => {
    api.read.mockRejectedValue(new ApiClientError(422, 'provider_invalid_response', 'Ticket illisible : reprenez la photo à plat.'));
    renderScreen();
    fireEvent.change(screen.getByTestId('receipt-file'), { target: { files: [new File(['x'], 't.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText('Ticket illisible : reprenez la photo à plat.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
