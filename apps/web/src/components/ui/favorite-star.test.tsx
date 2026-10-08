import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FavoriteStar } from './favorite-star';

describe('FavoriteStar', () => {
  it('annonce son état par aria-pressed', () => {
    render(<FavoriteStar favorite={false} recipeTitle="Riz au poulet" onToggle={vi.fn()} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
  });

  it('bascule au clic', () => {
    const onToggle = vi.fn();
    render(<FavoriteStar favorite={false} recipeTitle="Riz au poulet" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // L'étoile cochée doit se distinguer par sa forme, pas seulement par sa teinte.
  it('change de glyphe selon l’état, pas seulement de couleur', () => {
    const { rerender } = render(<FavoriteStar favorite={false} recipeTitle="Riz au poulet" onToggle={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toBe('☆');
    rerender(<FavoriteStar favorite recipeTitle="Riz au poulet" onToggle={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toBe('★');
  });

  // Nom accessible par recette (EF-23) : plusieurs étoiles de favori se côtoient dans une liste.
  it('nomme l’étoile par la recette', () => {
    render(<FavoriteStar favorite={false} recipeTitle="Riz au poulet" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Favori : Riz au poulet' })).toBeTruthy();
  });

  it('n’enveloppe jamais la navigation de la carte : le clic ne se propage pas', () => {
    const onToggle = vi.fn();
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <FavoriteStar favorite={false} recipeTitle="Riz au poulet" onToggle={onToggle} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
