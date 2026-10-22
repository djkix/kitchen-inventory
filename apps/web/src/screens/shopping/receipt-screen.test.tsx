import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDto, ReceiptDto, ReceiptLineDto } from '@kitchen/shared';
import { ToastProvider } from '../../components/ui/toast';
import { api, ApiClientError } from '../../lib/api';
import { receiptsApi } from '../../lib/receipts-api';
import { writeScanLocation } from '../../lib/scan-session';
import { ReceiptScreen } from './receipt-screen';

/** Écran du ticket de caisse (EF-29). Le réseau est doublé : aucune requête réelle. */
vi.mock('../../lib/receipts-api', () => ({
  receiptsApi: { read: vi.fn(), validate: vi.fn(), pendingLabels: vi.fn(), pendingLabelCount: vi.fn(), attachLabel: vi.fn() },
}));
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), api: { get: vi.fn() } }));
const api_ = vi.mocked(receiptsApi);
const locationNode = (id: string, name: string) => ({ id, name, parentId: null, path: name, depth: 0, kind: null, temperature: null, sortOrder: 0, itemCount: 0, children: [] });

const product = (id: string, name: string, defaultUnit: ProductDto['defaultUnit'] = 'PIECE'): ProductDto => ({
  id, barcode: null, name, originalName: null, brand: null, categoryId: null, defaultUnit, netContent: null, netContentUnit: null,
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
      candidates: [product('p9', 'Olive verte', 'GRAM'), product('p2', 'Olive noire')],
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
  api_.read.mockImplementation(() => Promise.resolve(receipt));
  await pickFile();
}

/** La liste des emplacements valide celui mémorisé : on n'envoie rien avant. */
async function pickFile() {
  renderScreen();
  await waitFor(() => expect((screen.getByRole('button', { name: 'Photographier le ticket' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByTestId('receipt-file'), { target: { files: [new File(['x'], 't.jpg', { type: 'image/jpeg' })] } });
}

beforeEach(() => {
  localStorage.clear();
  writeScanLocation({ id: 'loc1', name: 'Frigo' });
  Object.values(api_).forEach((m) => m.mockReset());
  api_.pendingLabels.mockResolvedValue([]);
  api_.validate.mockResolvedValue({ added: 1 });
  vi.mocked(api.get).mockResolvedValue([locationNode('loc1', 'Frigo'), locationNode('loc2', 'Cellier')]);
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
    await waitFor(() => expect(api_.validate).toHaveBeenCalledTimes(1));
    expect(api_.validate.mock.calls[0]?.[1].lines).toEqual([{ id: 'l1', productId: 'p1', quantity: 3, clientOpId: expect.any(String) }]);
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
    api_.read.mockRejectedValue(new ApiClientError(422, 'provider_invalid_response', 'Ticket illisible : reprenez la photo à plat.'));
    await pickFile();
    expect(await screen.findByText('Ticket illisible : reprenez la photo à plat.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('une ligne MATCHED montre la flèche, une ligne ambiguë choisie montre l’ajout seul', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    fireEvent.click(within(screen.getByRole('group', { name: 'Produit pour OLIVE NOIRE' })).getByRole('button', { name: 'Olive noire' }));
    expect(screen.getByText('+1')).toBeTruthy();
    // Une seule flèche : celle de la ligne reconnue. Jamais « 0 → 1 » sur la ligne choisie.
    expect(screen.getAllByText(/→/)).toHaveLength(1);
  });

  it('affiche l’unité d’un produit choisi qui n’est pas compté à la pièce', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    fireEvent.click(within(screen.getByRole('group', { name: 'Produit pour OLIVE NOIRE' })).getByRole('button', { name: 'Olive verte' }));
    expect(screen.getByText('+1 g')).toBeTruthy();
  });

  it('n’envoie jamais une ligne inconnue à la validation', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    fireEvent.click(within(screen.getByRole('group', { name: 'Produit pour OLIVE NOIRE' })).getByRole('button', { name: 'Olive noire' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter 2 produits' }));
    await waitFor(() => expect(api_.validate).toHaveBeenCalled());
    expect(api_.validate.mock.calls[0]?.[1].lines.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
  });

  it('rafraîchit les libellés en attente après une validation et après une lecture', async () => {
    await photograph();
    await screen.findByText('2 → 3');
    // Après la lecture : première relecture. Après la validation : seconde.
    await waitFor(() => expect(api_.pendingLabels.mock.calls.length).toBeGreaterThanOrEqual(2));
    const afterRead = api_.pendingLabels.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter 1 produit' }));
    await waitFor(() => expect(api_.pendingLabels.mock.calls.length).toBeGreaterThan(afterRead));
  });

  it('ne réécrit pas l’emplacement du scan quand on en choisit un autre', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Changer'));
    fireEvent.click(await screen.findByRole('button', { name: /Cellier/ }));
    expect(localStorage.getItem('kitchen.scan.locationId')).toBe('loc1');
  });

  it('refuse avant la photo un emplacement mémorisé qui n’existe plus', async () => {
    writeScanLocation({ id: 'disparu', name: 'Ancien' });
    renderScreen();
    // Attendre la liste des emplacements : avant elle, le bouton est désactivé quoi qu'il arrive.
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText('Choisir l’emplacement')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Photographier le ticket' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
