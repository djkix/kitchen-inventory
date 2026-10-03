import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CookSheetView, type CookableRecipe } from './cook-sheet';

const recipe: CookableRecipe = {
  id: 'r1', title: 'Riz', servings: 4,
  ingredients: [
    { id: 'i1', label: 'Riz', quantity: 200, unit: 'GRAM', state: 'available', substitutable: false, candidates: [] },
    { id: 'i2', label: 'Sel', quantity: null, unit: null, state: 'untracked', substitutable: false, candidates: [] },
    { id: 'i3', label: 'Huile', quantity: 10, unit: 'MILLILITER', state: 'available', substitutable: true,
      candidates: [{ productId: 'p9', name: 'Huile d’olive', nearestExpiry: '2026-10-10' }, { productId: 'p8', name: 'Huile de tournesol', nearestExpiry: null }] },
  ],
};

describe('CookSheetView', () => {
  it('recalcule les quantités au prorata des portions', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('200 g')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Portions réalisées'), { target: { value: '2' } });
    expect(screen.getByText('100 g')).toBeTruthy();
  });
  it('n’envoie que les lignes cochées, et rien avant validation', () => {
    const onConfirm = vi.fn();
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Riz/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm.mock.calls[0]![0].lines).toEqual([{ ingredientId: 'i3', productId: 'p9' }]);
  });
  it('ne propose pas de décrémenter un ingrédient hors inventaire', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('checkbox', { name: /Sel/ })).toBeNull();
  });
  it('présélectionne le produit qui périme le plus tôt (A15)', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText('Produit pour Huile') as HTMLSelectElement).value).toBe('p9');
  });
  it('envoie la note quand elle est donnée, et rien sinon', () => {
    const onConfirm = vi.fn();
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm.mock.calls[0]![0].stars).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '4 étoiles' }));
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm.mock.calls[1]![0].stars).toBe(4);
  });
});
