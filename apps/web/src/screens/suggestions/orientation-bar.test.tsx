import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrientationBar } from './orientation-bar';

describe('OrientationBar', () => {
  it('propose les régions, pas les pays (B10)', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} dishType={undefined} onDishTypeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Asiatique' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Japonaise/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Italienne/i })).toBeNull();
  });

  it('relance une recherche au choix d’une région (B9)', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Asiatique' }));

    expect(onChange).toHaveBeenCalledWith({ region: 'asiatique' });
  });

  it('relance une recherche au choix d’une durée', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '≤ 30 min' }));

    expect(onChange).toHaveBeenCalledWith({ maxMinutes: 30 });
  });

  it('relance une recherche au choix d’une difficulté', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));

    expect(onChange).toHaveBeenCalledWith({ difficulty: 'EASY' });
  });

  it('cumule les trois dimensions', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Asiatique' }));
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique' });

    rerender(<OrientationBar value={{ region: 'asiatique' }} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '≤ 30 min' }));
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique', maxMinutes: 30 });

    rerender(<OrientationBar value={{ region: 'asiatique', maxMinutes: 30 }} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });

  it('revient à la fournée de base d’un seul geste', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' }} onChange={onChange} dishType={undefined} onDishTypeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));

    expect(onChange).toHaveBeenCalledWith({ region: undefined, maxMinutes: undefined, difficulty: undefined });
  });

  it('propose le type de plat en premier, avant la région', () => {
    // Ordre demandé par Franck le 2026-10-08 : c'est la question posée avant
    // toutes les autres — entrée, plat ou dessert, puis seulement la cuisine.
    const { container } = render(<OrientationBar value={{}} onChange={vi.fn()} dishType={undefined} onDishTypeChange={vi.fn()} />);
    const groups = [...container.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));
    expect(groups.slice(0, 2)).toEqual(['Type de plat', 'Région']);
  });

  it('filtre sans relancer : le type de plat ne touche pas à l’orientation', () => {
    // Gemini classe les douze recettes de la fournée : le filtre s'applique sur
    // ce qui est déjà chargé, sans appel ni dépense.
    const onChange = vi.fn();
    const onDishTypeChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} dishType={undefined} onDishTypeChange={onDishTypeChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dessert' }));
    expect(onDishTypeChange).toHaveBeenCalledWith('DESSERT');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('« Tout effacer » efface aussi le type de plat', () => {
    const onDishTypeChange = vi.fn();
    render(<OrientationBar value={{ region: 'asiatique' }} onChange={vi.fn()} dishType={'DESSERT'} onDishTypeChange={onDishTypeChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(onDishTypeChange).toHaveBeenCalledWith(undefined);
  });

  it('respecte la cible tactile du projet', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} dishType={undefined} onDishTypeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Asiatique' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: '≤ 30 min' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: 'Facile' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: 'Tout effacer' }).className).toContain('min-h-touch');
  });
});
