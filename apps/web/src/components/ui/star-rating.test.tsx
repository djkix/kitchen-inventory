import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StarRating } from './star-rating';

describe('StarRating', () => {
  it('n’offre qu’une seule tabulation pour entrer dans le groupe', () => {
    render(<StarRating value={3} onChange={vi.fn()} />);
    const focusables = screen.getAllByRole('radio').filter((star) => star.getAttribute('tabindex') === '0');
    expect(focusables).toHaveLength(1);
    expect(focusables[0]).toBe(screen.getByRole('radio', { name: '3 étoiles' }));
  });

  it('rend la première étoile atteignable quand aucune note n’est donnée', () => {
    render(<StarRating value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '1 étoile' }).getAttribute('tabindex')).toBe('0');
  });

  it('change de note aux flèches sans sortir du groupe', () => {
    const onChange = vi.fn();
    render(<StarRating value={3} onChange={onChange} />);
    const third = screen.getByRole('radio', { name: '3 étoiles' });
    fireEvent.keyDown(third, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(4);
    fireEvent.keyDown(third, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('ne déborde pas des cinq étoiles', () => {
    const onChange = vi.fn();
    render(<StarRating value={5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: '5 étoiles' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
