import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuggestionCard } from './suggestion-card';

const base = {
  id: 's1', title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne' as const,
  totalMinutes: 25, difficulty: 'EASY' as const, provenance: 'web' as const,
  sourceUrl: 'https://exemple.test/pates', coverage: 1, group: 'ready' as const,
  missingLabels: [], ingredients: [],
};

describe('SuggestionCard', () => {
  it('affiche le pays même si le choix se fait par région (B10)', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.getByText(/italienne/i)).toBeTruthy();
  });
  it('nomme le site pour une recette web', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.getByText(/exemple\.test/)).toBeTruthy();
  });
  it('annonce une composition par l’IA', () => {
    render(<SuggestionCard suggestion={{ ...base, provenance: 'ai', sourceUrl: null }} />);
    expect(screen.getByText(/proposée par l’IA/i)).toBeTruthy();
  });
  it('n’affiche jamais d’étapes avant conservation (B7)', () => {
    // Corrigé : queryByText(/étape/i) passerait même si des étapes étaient
    // rendues sans ce mot. On vérifie plutôt l'absence du conteneur dédié —
    // aucune carte de suggestion n'en porte, quelle que soit la provenance.
    render(<SuggestionCard suggestion={base} />);
    expect(screen.queryByTestId('suggestion-steps')).toBeNull();
  });
  it('liste les ingrédients manquants', () => {
    render(<SuggestionCard suggestion={{ ...base, group: 'almost', coverage: 0.75, missingLabels: ['Basilic'] }} />);
    expect(screen.getByText(/Basilic/)).toBeTruthy();
  });
  it('ne porte aucune mention de péremption (B5)', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.queryByText(/périme/i)).toBeNull();
  });
});
