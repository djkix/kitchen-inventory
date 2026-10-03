import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DifficultyField } from './recipe-form-screen';

/**
 * NB (task 18) : le second jeu d'étapes du brief (`['a', ..., 'h']`, temps actif
 * 90 min, sans aucune technique) donne réellement « Intermédiaire » par
 * `computeDifficulty` (packages/shared/src/rules/difficulty.ts), pas
 * « Difficile » — vérifié en exécutant la fonction partagée. Le composant DOIT
 * appeler `computeDifficulty` et ne jamais recalculer la difficulté lui-même
 * (règle non négociable, cf. brief), donc le jeu d'étapes ci-dessous est repris
 * tel quel du cas « HARD » de `difficulty.test.ts` pour que l'assertion
 * « Difficile » soit réellement atteignable.
 */
const HARD_STEPS = ['Pétrir la pâte', 'Laisser lever', 'Émulsionner', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];

describe('DifficultyField', () => {
  it('suit le calcul tant que l’utilisateur n’a rien corrigé', () => {
    const { rerender } = render(<DifficultyField steps={['a']} activeTime={5} value={null} onChange={vi.fn()} />);
    expect(screen.getByText('Très facile')).toBeTruthy();
    rerender(<DifficultyField steps={HARD_STEPS} activeTime={90} value={null} onChange={vi.fn()} />);
    expect(screen.getByText('Difficile')).toBeTruthy();
  });
  it('cesse de bouger dès qu’elle est corrigée', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DifficultyField steps={['a']} activeTime={5} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Intermédiaire' }));
    expect(onChange).toHaveBeenCalledWith('INTERMEDIATE');
    rerender(<DifficultyField steps={HARD_STEPS} activeTime={90} value="INTERMEDIATE" onChange={onChange} />);
    expect(screen.getByText('Intermédiaire')).toBeTruthy();
  });
});
