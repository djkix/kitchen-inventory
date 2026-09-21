import type { ProductDto } from '@kitchen/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmSheet, type ConfirmTarget } from './confirm-sheet';

const product = (overrides: Partial<ProductDto> = {}): ProductDto => ({
  id: 'p1',
  barcode: '3017620422003',
  name: 'Nutella',
  originalName: null,
  brand: 'Ferrero',
  categoryId: null,
  category: null,
  defaultUnit: 'PIECE',
  netContent: null,
  netContentUnit: null,
  afterOpeningDays: null,
  minThreshold: null,
  imagePath: null,
  recognitionSource: 'OPEN_FOOD_FACTS',
  confidence: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  ...overrides,
});

const target = (overrides: Partial<ConfirmTarget> = {}): ConfirmTarget => ({
  product: product(),
  source: 'off',
  barcode: '3017620422003',
  ...overrides,
});

describe('ConfirmSheet', () => {
  it('n’affiche rien tant qu’aucun produit n’a été scanné', () => {
    const { container } = render(<ConfirmSheet target={null} locationName="Placard" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('présente le produit reconnu et l’emplacement de destination', () => {
    render(<ConfirmSheet target={target()} locationName="Placard" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Nutella')).toBeTruthy();
    expect(screen.getByText(/Ferrero/)).toBeTruthy();
    expect(screen.getByText(/Sera rangé dans Placard/)).toBeTruthy();
    expect(screen.getByText(/3017620422003/)).toBeTruthy();
  });

  it('ajoute la quantité affichée, 1 par défaut, seulement après validation', () => {
    const onConfirm = vi.fn();
    render(<ConfirmSheet target={target()} locationName="Placard" busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(onConfirm).toHaveBeenCalledWith(1);
  });

  it('incrémente par pas d’unité et ne descend pas sous un pas', () => {
    const onConfirm = vi.fn();
    render(<ConfirmSheet target={target()} locationName="Placard" busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Augmenter la quantité' }));
    fireEvent.click(screen.getByRole('button', { name: 'Augmenter la quantité' }));
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(onConfirm).toHaveBeenCalledWith(3);
    const minus = screen.getByRole('button', { name: 'Diminuer la quantité' });
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect((minus as HTMLButtonElement).disabled).toBe(true);
  });

  it('part du pas de l’unité pour les masses, puis incrémente du même pas', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmSheet target={target({ product: product({ defaultUnit: 'GRAM' }) })} locationName="Placard" busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Augmenter la quantité' }));
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(onConfirm).toHaveBeenCalledWith(200);
  });

  it('accepte une quantité saisie à la main, virgule comprise', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmSheet target={target({ product: product({ defaultUnit: 'LITER' }) })} locationName="Cellier" busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Quantité en l/), { target: { value: '1,5' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
    expect(onConfirm).toHaveBeenCalledWith(1.5);
  });

  it('refuse de valider une quantité nulle ou absente', () => {
    render(<ConfirmSheet target={target()} locationName="Placard" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Quantité en pièce/), { target: { value: '' } });
    expect((screen.getByRole('button', { name: /Ajouter/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('permet d’ignorer l’article sans rien enregistrer', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmSheet target={target()} locationName="Placard" busy={false} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ignorer' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('verrouille les actions pendant l’enregistrement', () => {
    render(<ConfirmSheet target={target()} locationName="Placard" busy onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Ignorer' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Augmenter la quantité' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
