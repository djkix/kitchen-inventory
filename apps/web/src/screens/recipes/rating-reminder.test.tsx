import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RatingReminderView } from './rating-reminder';

const pending = { logId: 'l1', recipeId: 'r1', recipeTitle: 'Gratin', cookedAt: new Date().toISOString() };

describe('RatingReminderView', () => {
  afterEach(() => localStorage.clear());

  it('invite à noter la réalisation récente', () => {
    render(<RatingReminderView pending={pending} onRate={vi.fn()} />);
    expect(screen.getByText(/Notez le gratin/i)).toBeTruthy();
  });
  it('ne s’affiche pas sans réalisation en attente', () => {
    const { container } = render(<RatingReminderView pending={null} onRate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it('se ferme et ne revient pas le même jour', () => {
    const { rerender, container } = render(<RatingReminderView pending={pending} onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Masquer' }));
    rerender(<RatingReminderView pending={pending} onRate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it('ouvre la notation au clic', () => {
    const onRate = vi.fn();
    render(<RatingReminderView pending={pending} onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: /Noter/ }));
    expect(onRate).toHaveBeenCalledWith('l1');
  });
});
