import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrientationBar } from './orientation-bar';

describe('OrientationBar', () => {
  it('propose les régions, pas les pays (B10)', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Asiatique' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Japonaise/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Italienne/i })).toBeNull();
  });

  it('relance une recherche au choix d’une région (B9)', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Asiatique' }));

    expect(onChange).toHaveBeenCalledWith({ region: 'asiatique' });
  });

  it('relance une recherche au choix d’une durée', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '≤ 30 min' }));

    expect(onChange).toHaveBeenCalledWith({ maxMinutes: 30 });
  });

  it('relance une recherche au choix d’une difficulté', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));

    expect(onChange).toHaveBeenCalledWith({ difficulty: 'EASY' });
  });

  it('cumule les trois dimensions', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OrientationBar value={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Asiatique' }));
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique' });

    rerender(<OrientationBar value={{ region: 'asiatique' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '≤ 30 min' }));
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique', maxMinutes: 30 });

    rerender(<OrientationBar value={{ region: 'asiatique', maxMinutes: 30 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));
    expect(onChange).toHaveBeenLastCalledWith({ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });

  it('revient à la fournée de base d’un seul geste', () => {
    const onChange = vi.fn();
    render(<OrientationBar value={{ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));

    expect(onChange).toHaveBeenCalledWith({ region: undefined, maxMinutes: undefined, difficulty: undefined });
  });

  it('respecte la cible tactile du projet', () => {
    render(<OrientationBar value={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Asiatique' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: '≤ 30 min' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: 'Facile' }).className).toContain('min-h-touch');
    expect(screen.getByRole('button', { name: 'Tout effacer' }).className).toContain('min-h-touch');
  });
});
