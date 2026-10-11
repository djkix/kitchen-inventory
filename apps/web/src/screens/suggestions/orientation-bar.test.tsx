import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrientationBar } from './orientation-bar';

describe('OrientationBar', () => {
  it('propose les quatre sélecteurs, nommés', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} dishType={undefined} onDishTypeChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Type de plat' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Cuisine' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Durée' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Facilité' })).toBeTruthy();
  });

  it('propose les régions, pas les pays (B10)', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} dishType={undefined} onDishTypeChange={vi.fn()} />);
    const cuisine = screen.getByRole('combobox', { name: 'Cuisine' });
    expect(screen.getByRole('option', { name: 'Asiatique' })).toBeTruthy();
    expect(cuisine.querySelector('option[value="japonaise"]')).toBeNull();
    expect(cuisine.querySelector('option[value="italienne"]')).toBeNull();
  });

  it('relance une recherche au choix d’une région (B9)', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: 'asiatique' } });

    expect(onChange).toHaveBeenCalledWith({ region: 'asiatique' });
  });

  it('relance une recherche au choix d’une durée', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Durée' }), { target: { value: '30' } });

    expect(onChange).toHaveBeenCalledWith({ maxMinutes: 30 });
  });

  it('relance une recherche au choix d’une difficulté', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Facilité' }), { target: { value: 'EASY' } });

    expect(onChange).toHaveBeenCalledWith({ difficulty: 'EASY' });
  });

  it('cumule les trois dimensions', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: 'asiatique' } });
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique' });

    rerender(<OrientationBar value={{ region: 'asiatique' }} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Durée' }), { target: { value: '30' } });
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique', maxMinutes: 30 });

    rerender(<OrientationBar value={{ region: 'asiatique', maxMinutes: 30 }} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Facilité' }), { target: { value: 'EASY' } });
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });

  it('revient à la contrainte vide en reposant un sélecteur sur sa valeur « Tous »', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{ region: 'asiatique' }} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ region: undefined });
  });

  it('filtre sans relancer : le type de plat ne touche pas à l’orientation', () => {
    // Gemini classe les douze recettes de la fournée : le filtre s'applique sur
    // ce qui est déjà chargé, sans appel ni dépense (D4).
    const onChange = vi.fn();
    const onDishTypeChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={onDishTypeChange} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Type de plat' }), { target: { value: 'DESSERT' } });

    expect(onDishTypeChange).toHaveBeenCalledWith('DESSERT');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chaque sélecteur annonce sa valeur courante', () => {
    render(
      <OrientationBar
        value={{ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' }}
        onChange={vi.fn()}
        dishType={'DESSERT'}
        onDishTypeChange={vi.fn()}
      />,
    );
    expect((screen.getByRole('combobox', { name: 'Type de plat' }) as HTMLSelectElement).value).toBe('DESSERT');
    expect((screen.getByRole('combobox', { name: 'Cuisine' }) as HTMLSelectElement).value).toBe('asiatique');
    expect((screen.getByRole('combobox', { name: 'Durée' }) as HTMLSelectElement).value).toBe('30');
    expect((screen.getByRole('combobox', { name: 'Facilité' }) as HTMLSelectElement).value).toBe('EASY');
  });

  it('« Tout effacer » remet les quatre sélecteurs à zéro', () => {
    const onChange = vi.fn();
    const onDishTypeChange = vi.fn();
    render(
      <OrientationBar
        value={{ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' }}
        onChange={onChange}
        dishType={'DESSERT'}
        onDishTypeChange={onDishTypeChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));

    expect(onChange).toHaveBeenCalledWith({ region: undefined, maxMinutes: undefined, difficulty: undefined });
    expect(onDishTypeChange).toHaveBeenCalledWith(undefined);
  });

  it('respecte la cible tactile du projet par la hauteur, pas la police', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} dishType={undefined} onDishTypeChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Type de plat' }).className).toContain('min-h-touch');
    expect(screen.getByRole('combobox', { name: 'Cuisine' }).className).toContain('min-h-touch');
    expect(screen.getByRole('combobox', { name: 'Durée' }).className).toContain('min-h-touch');
    expect(screen.getByRole('combobox', { name: 'Facilité' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: 'Tout effacer' }).className).toContain('min-h-touch');
  });
});
