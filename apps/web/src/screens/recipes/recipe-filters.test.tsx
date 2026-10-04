import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecipeFiltersBar } from './recipe-filters';

const empty = { difficulty: [], cuisine: [], dishType: [], diet: [], tag: [], group: [], archived: false, sort: 'rating' as const };

describe('RecipeFiltersBar', () => {
  it('ajoute une difficulté sans toucher aux autres filtres', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, difficulty: ['EASY'] });
  });
  it('change le tri', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Trier par'), { target: { value: 'coverage' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, sort: 'coverage' });
  });
  it('traduit les pastilles rapides en filtres', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Valeurs sûres' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, tag: ['trusted'] });
    fireEvent.click(screen.getByRole('button', { name: 'Réalisables maintenant' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, group: ['ready'] });
  });
  it('compte les filtres actifs sans compter le tri', () => {
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], maxTime: 30, sort: 'coverage' }} cuisines={[]} onChange={vi.fn()} />);
    expect(screen.getByText('2 filtres')).toBeTruthy();
  });
  it('remet les filtres à zéro en gardant le tri', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], sort: 'coverage' }} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, sort: 'coverage' });
  });
});
