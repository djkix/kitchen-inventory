import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const stats = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('../../lib/queries', () => ({ useRecognitionStatsQuery: () => ({ isPending: false, isError: false, data: stats.data }) }));

const { StatsPanel } = await import('./stats-panel');

const base = {
  provider: 'gemini',
  visionCallsToday: 1,
  visionCallsThisMonth: 1,
  visionCostCentsThisMonth: 9,
  dailyQuota: 50,
  monthlyCapCents: 500,
  automaticRate30d: 0.84,
  cacheShare30d: 0.21,
  pendingIdentification: 0,
  providerCallsToday: 15,
  providerCallsLastMinute: 5,
};

/**
 * Compteur indicatif du 2026-10-21. La propriété qui compte : sans limite
 * renseignée, l'écran rend le compte **seul**. Un rapport à une valeur
 * inventée serait pire que pas de rapport du tout — c'est la leçon de la
 * table de prix, qui a menti six jours durant.
 */
describe('compteur d’appels au fournisseur', () => {
  it('affiche le compte seul quand les limites ne sont pas renseignées', () => {
    stats.data = { ...base, providerDailyLimit: null, providerMinuteLimit: null };
    render(<StatsPanel />);
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('5 dans la dernière minute')).toBeTruthy();
    expect(screen.queryByText(/15 \//)).toBeNull();
  });

  it('affiche le rapport dès que la console Google a été recopiée', () => {
    stats.data = { ...base, providerDailyLimit: 500, providerMinuteLimit: 15 };
    render(<StatsPanel />);
    expect(screen.getByText('15 / 500')).toBeTruthy();
    expect(screen.getByText('5 / 15 dans la minute')).toBeTruthy();
  });
});
