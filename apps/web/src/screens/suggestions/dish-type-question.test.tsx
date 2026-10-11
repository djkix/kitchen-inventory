import { renderHook, act } from '@testing-library/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DishTypeQuestion, resetDishTypeAnswerForTests, useDishTypeAnswer } from './dish-type-question';

describe('DishTypeQuestion', () => {
  it('propose les sept types de la taxonomie, sans en ajouter ni en retirer', () => {
    render(<DishTypeQuestion onSelect={vi.fn()} />);
    for (const label of ['Entrée', 'Plat', 'Dessert', 'Accompagnement', 'Apéritif', 'Petit-déjeuner', 'Boisson']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  it('transmet le type choisi', () => {
    const onSelect = vi.fn();
    render(<DishTypeQuestion onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dessert' }));
    expect(onSelect).toHaveBeenCalledWith('DESSERT');
  });
});

describe('useDishTypeAnswer', () => {
  beforeEach(() => {
    resetDishTypeAnswerForTests();
  });

  it('démarre sans réponse', () => {
    const { result } = renderHook(() => useDishTypeAnswer());
    expect(result.current.dishType).toBeNull();
  });

  it('mémorise la réponse au-delà du cycle de vie du composant appelant (retour depuis une fiche de recette)', () => {
    const first = renderHook(() => useDishTypeAnswer());
    act(() => {
      first.result.current.answer('DESSERT');
    });
    first.unmount();

    // Un nouveau montage du hook, comme après le démontage de l'écran
    // Suggestions (navigation vers /recettes/:id puis retour), doit retrouver
    // la réponse déjà donnée.
    const second = renderHook(() => useDishTypeAnswer());
    expect(second.result.current.dishType).toBe('DESSERT');
  });

  it('oublie la réponse sur demande explicite (A5)', () => {
    const { result } = renderHook(() => useDishTypeAnswer());
    act(() => {
      result.current.answer('MAIN');
    });
    expect(result.current.dishType).toBe('MAIN');

    act(() => {
      result.current.askAgain();
    });
    expect(result.current.dishType).toBeNull();
  });
});
