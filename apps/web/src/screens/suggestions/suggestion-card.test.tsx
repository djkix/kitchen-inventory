import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuggestionCard } from './suggestion-card';

const base = {
  id: 's1', title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne' as const,
  totalMinutes: 25, prepMinutes: 10, cookMinutes: 15, difficulty: 'EASY' as const, dishType: 'MAIN' as const, provenance: 'web' as const,
  sourceUrl: 'https://exemple.test/pates', verified: true, coverage: 1, group: 'ready' as const,
  missingLabels: [], ingredients: [], steps: [],
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
  it('annonce une composition par l’IA comme non vérifiée (D5)', () => {
    render(<SuggestionCard suggestion={{ ...base, provenance: 'ai', sourceUrl: null, verified: false }} />);
    expect(screen.getByText('Composée par l’IA, non vérifiée')).toBeTruthy();
  });

  // Une recette `web` non vérifiée n'a pas le droit de s'abriter derrière un
  // nom de domaine : le réservoir jette ces lignes à l'ingestion, cette garde
  // couvre le cas où elle arriverait par un autre chemin.
  it('refuse de nommer le site d’une recette web non vérifiée', () => {
    render(<SuggestionCard suggestion={{ ...base, provenance: 'web', verified: false }} />);
    expect(screen.queryByText(/exemple\.test/)).toBeNull();
    expect(screen.getByText('Composée par l’IA, non vérifiée')).toBeTruthy();
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
  // jsdom ne calcule aucune mise en page : ce test vérifie la classe qui pose
  // la limite à deux lignes (A6), pas le rendu réel — vérifié au navigateur
  // séparément, à 375 px, avec un titre long.
  it('affiche le titre sur deux lignes au plus, jamais tronqué sur une seule (A6)', () => {
    render(<SuggestionCard suggestion={{ ...base, title: 'Un titre de recette particulièrement long pour vérifier le passage à la ligne' }} />);
    const title = screen.getByText(/Un titre de recette particulièrement long/);
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).not.toContain('truncate');
  });
});
