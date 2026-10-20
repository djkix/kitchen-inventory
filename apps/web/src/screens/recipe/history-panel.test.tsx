import type { RecipeLogDto, RecipeStatsDto } from '@kitchen/shared';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './history-panel';

/**
 * La fiche recette est passée en lecture seule le 2026-10-20 : elle ne rend
 * plus ce panneau. Le composant reste en place, prêt à être réaffiché, et ses
 * garanties d'accessibilité — qui vivaient dans `recipe-screen.test.tsx` —
 * sont reprises ici telles quelles.
 */
const stats: RecipeStatsDto = {
  timesCooked: 2,
  lastCookedAt: '2026-10-05T19:00:00.000Z',
  averageRating: null,
  ratingCount: 0,
  recentTrend: null,
  tags: [],
};

const logs: RecipeLogDto[] = [
  { id: 'log1', cookedAt: '2026-10-05T19:00:00.000Z', servingsCooked: 4, stockApplied: true, cookedByName: 'djkix', canRate: true, ratings: [] },
  { id: 'log2', cookedAt: '2026-10-01T19:00:00.000Z', servingsCooked: 4, stockApplied: true, cookedByName: 'djkix', canRate: true, ratings: [] },
];

function renderPanel(props: Partial<React.ComponentProps<typeof HistoryPanel>> = {}) {
  const onRate = vi.fn();
  render(
    <HistoryPanel
      stats={stats}
      logs={logs}
      currentUserId="u1"
      hasNextPage={false}
      isFetchingNextPage={false}
      onLoadMore={vi.fn()}
      onRate={onRate}
      onDelete={vi.fn()}
      deletingLogId={null}
      {...props}
    />,
  );
  return { onRate };
}

describe('HistoryPanel', () => {
  it('ouvre la notation d’une réalisation passée, sans cuisiner', () => {
    const { onRate } = renderPanel();

    fireEvent.click(screen.getAllByRole('button', { name: /Noter/i })[0]!);

    expect(onRate).toHaveBeenCalledWith(logs[0]);
  });

  /**
   * EF-23 : plusieurs réalisations affichent chacune un bouton « Noter »
   * identique à l'œil. Sans nom distinct, un lecteur d'écran annoncerait
   * plusieurs boutons « Noter » pour la même liste.
   */
  it('nomme chaque bouton « Noter » par sa réalisation', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: /Noter la réalisation du .*5 oct/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Noter la réalisation du .*1 oct/i })).toBeTruthy();
  });

  it('distingue aussi les boutons de suppression, un par réalisation', () => {
    renderPanel();

    const boutons = screen.getAllByRole('button', { name: /^Supprimer la réalisation du / });
    const noms = boutons.map((bouton) => bouton.getAttribute('aria-label'));
    expect(noms.length).toBeGreaterThan(1);
    expect(new Set(noms).size).toBe(noms.length);
  });

  // A6 : une recette jamais cuisinée explique l'absence d'historique.
  it('explique l’absence d’historique pour une recette jamais cuisinée', () => {
    renderPanel({ logs: [], stats: { ...stats, timesCooked: 0, lastCookedAt: null } });

    expect(screen.getByText(/Jamais faite/)).toBeTruthy();
  });
});
