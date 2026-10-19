import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecipeFiltersBar } from './recipe-filters';

const empty = { difficulty: [], cuisine: [], dishType: [], diet: [], tag: [], group: [], archived: false, cooked: false, favorite: false, sort: 'rating' as const };

describe('RecipeFiltersBar', () => {
  it('ajoute une difficulté sans toucher aux autres filtres', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Facilité'), { target: { value: 'EASY' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, difficulty: ['EASY'] });
  });

  // Même présentation que l'orientation des suggestions (2026-10-15) : les six
  // facettes à choix sont des `<select>` par paires, type de plat en premier.
  it('présente les facettes comme des sélecteurs, type de plat en premier', () => {
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={vi.fn()} />);
    const labels = screen.getAllByRole('combobox').map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['Type de plat', 'Cuisine', 'Durée', 'Facilité', 'Régime', 'Note minimale']);
  });

  it('ne garde qu’une valeur par facette, la précédente est remplacée', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, dishType: ['STARTER'] }} cuisines={[]} onChange={onChange} />);
    const select = screen.getByLabelText('Type de plat');
    expect((select as HTMLSelectElement).value).toBe('STARTER');
    fireEvent.change(select, { target: { value: 'DESSERT' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, dishType: ['DESSERT'] });
  });

  it('vide une facette quand on revient sur l’option neutre', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, maxTime: 30 }} cuisines={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Durée'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, maxTime: undefined });
  });
  // D3 (2026-10-19) : le sélecteur de tri quitte l'écran. Le tri reste dans le
  // modèle, dans la requête et dans les préférences enregistrées — seul le
  // contrôle disparaît.
  it('n’affiche plus de sélecteur « Trier par » (D3)', () => {
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Trier par')).toBeNull();
    const labels = screen.getAllByRole('combobox').map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['Type de plat', 'Cuisine', 'Durée', 'Facilité', 'Régime', 'Note minimale']);
  });

  // Le tri mémorisé traverse le panneau sans être touché : « Tout effacer »
  // efface les facettes, jamais le tri (le test suivant), et aucun geste du
  // panneau ne le change plus.
  it('laisse le tri intact quand on change une facette (D3)', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, sort: 'coverage' }} cuisines={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Facilité'), { target: { value: 'EASY' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, sort: 'coverage', difficulty: ['EASY'] });
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
