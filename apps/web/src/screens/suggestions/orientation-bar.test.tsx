import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrientationBar, countActiveOrientation } from './orientation-bar';

describe('OrientationBar', () => {
  it('propose les quatre sélecteurs, nommés', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Type de plat' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Cuisine' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Durée' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Facilité' })).toBeTruthy();
  });

  it('propose les régions, pas les pays (B10)', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} />);
    const cuisine = screen.getByRole('combobox', { name: 'Cuisine' });
    expect(screen.getByRole('option', { name: 'Asiatique' })).toBeTruthy();
    expect(cuisine.querySelector('option[value="japonaise"]')).toBeNull();
    expect(cuisine.querySelector('option[value="italienne"]')).toBeNull();
  });

  it('relance une recherche au choix d’une région (B9)', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: 'asiatique' } });

    expect(onChange).toHaveBeenCalledWith({ region: 'asiatique' });
  });

  it('relance une recherche au choix d’une durée', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Durée' }), { target: { value: '30' } });

    expect(onChange).toHaveBeenCalledWith({ maxMinutes: 30 });
  });

  it('relance une recherche au choix d’une difficulté', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Facilité' }), { target: { value: 'EASY' } });

    expect(onChange).toHaveBeenCalledWith({ difficulty: 'EASY' });
  });

  /**
   * Revue finale du 2026-10-11 : le sélecteur de type de plat relance
   * désormais une vraie recherche, exactement comme les trois autres. Il ne
   * peut plus se contenter de filtrer la fournée déjà chargée : depuis que
   * la question bloquante envoie le type choisi au modèle (D2/D3), celui-ci
   * ne propose plus que des recettes de ce type — une fournée mono-type ne
   * peut plus rendre un autre type à filtrer localement (D4 devenue sans
   * objet).
   */
  it('relance une recherche au choix d’un type de plat, comme les trois autres dimensions', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Type de plat' }), { target: { value: 'DESSERT' } });

    expect(onChange).toHaveBeenCalledWith({ dishType: 'DESSERT' });
  });

  it('cumule les quatre dimensions', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Type de plat' }), { target: { value: 'DESSERT' } });
    expect(onChange).toHaveBeenLastCalledWith({ dishType: 'DESSERT' });

    rerender(<OrientationBar value={{ dishType: 'DESSERT' }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: 'asiatique' } });
    expect(onChange).toHaveBeenLastCalledWith({ dishType: 'DESSERT', region: 'asiatique' });

    rerender(<OrientationBar value={{ dishType: 'DESSERT', region: 'asiatique' }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Durée' }), { target: { value: '30' } });
    expect(onChange).toHaveBeenLastCalledWith({ dishType: 'DESSERT', region: 'asiatique', maxMinutes: 30 });

    rerender(<OrientationBar value={{ dishType: 'DESSERT', region: 'asiatique', maxMinutes: 30 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Facilité' }), { target: { value: 'EASY' } });
    expect(onChange).toHaveBeenLastCalledWith({ dishType: 'DESSERT', region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });

  it('revient à la contrainte vide en reposant un sélecteur sur sa valeur « Tous »', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{ region: 'asiatique' }} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ region: undefined });
  });

  /**
   * Un `refresh: true` posé pour UNE recherche (depuis la question d'entrée,
   * revue finale du 2026-10-11) ne doit pas rester collé à l'orientation :
   * sans cette remise à zéro explicite, tout geste suivant sur la barre
   * contournerait le cache de 24 h et consommerait quota et euros à chaque
   * changement, pas seulement pour celui qui le justifiait.
   */
  it('efface un `refresh` hérité à chaque nouveau geste', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{ dishType: 'MAIN', refresh: true }} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Durée' }), { target: { value: '30' } });

    expect(onChange).toHaveBeenCalledWith({ dishType: 'MAIN', maxMinutes: 30, refresh: undefined });
  });

  it('chaque sélecteur annonce sa valeur courante', () => {
    render(<OrientationBar value={{ dishType: 'DESSERT', region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' }} onChange={vi.fn()} />);
    expect((screen.getByRole('combobox', { name: 'Type de plat' }) as HTMLSelectElement).value).toBe('DESSERT');
    expect((screen.getByRole('combobox', { name: 'Cuisine' }) as HTMLSelectElement).value).toBe('asiatique');
    expect((screen.getByRole('combobox', { name: 'Durée' }) as HTMLSelectElement).value).toBe('30');
    expect((screen.getByRole('combobox', { name: 'Facilité' }) as HTMLSelectElement).value).toBe('EASY');
  });

  it('« Tout effacer » remet les quatre sélecteurs à zéro', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{ dishType: 'DESSERT', region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));

    expect(onChange).toHaveBeenCalledWith({ dishType: undefined, region: undefined, maxMinutes: undefined, difficulty: undefined });
  });

  it('respecte la cible tactile du projet par la hauteur, pas la police', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Type de plat' }).className).toContain('min-h-touch');
    expect(screen.getByRole('combobox', { name: 'Cuisine' }).className).toContain('min-h-touch');
    expect(screen.getByRole('combobox', { name: 'Durée' }).className).toContain('min-h-touch');
    expect(screen.getByRole('combobox', { name: 'Facilité' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: 'Tout effacer' }).className).toContain('min-h-touch');
  });
});

/**
 * Revue finale du 2026-10-11 : le type de plat est une orientation serveur
 * comme les trois autres, il doit donc compter dans le total affiché —
 * avant ce correctif, la barre affichait « Aucune orientation » alors que
 * le type contraignait déjà toute la fournée.
 */
describe('countActiveOrientation', () => {
  it('compte le type de plat comme une dimension active', () => {
    expect(countActiveOrientation({})).toBe(0);
    expect(countActiveOrientation({ dishType: 'MAIN' })).toBe(1);
    expect(countActiveOrientation({ dishType: 'MAIN', region: 'asiatique' })).toBe(2);
  });

  it('affiche le compte dans la barre plutôt que « Aucune orientation » quand le type seul est actif', () => {
    render(<OrientationBar value={{ dishType: 'MAIN' }} onChange={vi.fn()} />);
    expect(screen.getByText('1 orientation')).toBeTruthy();
    expect(screen.queryByText('Aucune orientation')).toBeNull();
  });
});
