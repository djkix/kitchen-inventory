import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IngredientRow } from './ingredient-row';

const base = {
  id: 'i1', label: 'Riz', productId: 'p1', productName: 'Riz basmati', categoryId: null, categoryName: null,
  quantity: 200, unit: 'GRAM' as const, essential: false, substitutable: false, availableQuantity: null,
};

describe('IngredientRow', () => {
  it('montre une quantité insuffisante avec le détail', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'insufficient', availableQuantity: 100 }} />);
    expect(screen.getByText(/100 g sur 200 g/)).toBeTruthy();
  });
  it('explique une quantité non vérifiable', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'unverifiable' }} />);
    expect(screen.getByText(/non vérifiable/i)).toBeTruthy();
  });
  it('grise un ingrédient hors inventaire', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'untracked', productId: null, productName: null }} />);
    expect(screen.getByText(/hors inventaire/i)).toBeTruthy();
  });
  it('marque les essentiels et les manquants', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'missing', essential: true }} />);
    expect(screen.getByText('Manquant')).toBeTruthy();
    expect(screen.getByLabelText('Ingrédient essentiel')).toBeTruthy();
  });
});
