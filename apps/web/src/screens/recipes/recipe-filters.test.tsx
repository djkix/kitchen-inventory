import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecipeFiltersBar } from './recipe-filters';

const empty = { difficulty: [], cuisine: [], dishType: [], diet: [], tag: [], group: [], archived: false, cooked: false, favorite: false, sort: 'rating' as const };

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
  it('propose « Déjà faites » dans la première rangée', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Pastilles rapides' });
    const button = within(group).getByRole('button', { name: 'Déjà faites' });
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith({ ...empty, cooked: true });
  });

  // A4 : la pastille « Favoris » vit à côté de « Déjà faites », dans la première rangée.
  it('propose « Favoris » dans la première rangée, à côté de « Déjà faites »', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Pastilles rapides' });
    const button = within(group).getByRole('button', { name: 'Favoris' });
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith({ ...empty, favorite: true });
  });
  it('compte les filtres actifs sans compter le tri', () => {
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], maxTime: 30, sort: 'coverage' }} cuisines={[]} onChange={vi.fn()} />);
    expect(screen.getByText('2 filtres')).toBeTruthy();
  });

  it('compte le filtre « Favoris » parmi les filtres actifs', () => {
    render(<RecipeFiltersBar value={{ ...empty, favorite: true }} cuisines={[]} onChange={vi.fn()} />);
    expect(screen.getByText('1 filtre')).toBeTruthy();
  });
  it('remet les filtres à zéro en gardant le tri', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], sort: 'coverage' }} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, sort: 'coverage' });
  });
});
