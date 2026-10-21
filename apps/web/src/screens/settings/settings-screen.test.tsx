import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './settings-screen';

vi.mock('../../hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'me', name: 'Moi', email: 'moi@example.com', role: 'ADMIN' }, isAdmin: true, clear: vi.fn() }),
}));
const comptes = vi.hoisted(() => ({ pending: true }));
vi.mock('../../lib/queries', () => ({
  queryKeys: {},
  useSettingsQuery: () => ({ data: { expiryAlertDays: 3 }, isPending: false }),
  useRecognitionStatsQuery: () => ({ data: { provider: 'gemini', visionCallsToday: 4, dailyQuota: 50 } }),
  useAccountsQuery: () => ({
    data: [
      { id: '1', status: 'ACTIVE' },
      { id: '2', status: 'ACTIVE' },
      ...(comptes.pending ? [{ id: '3', status: 'PENDING' }] : []),
    ],
  }),
}));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../../components/shell/version-badge', () => ({ VersionBadge: () => null }));
vi.mock('./stats-panel', () => ({ StatsPanel: () => null }));
vi.mock('./model-row', () => ({ ModelRow: () => null }));
vi.mock('./web-search-row', () => ({ WebSearchRow: () => null }));
vi.mock('./accounts-section', () => ({
  AccountsSection: () => <div>section-comptes</div>,
  SignOutEverywhereRow: () => <div>deconnexion-partout</div>,
}));

describe('SettingsScreen', () => {
  it('monte la section Comptes et la coupure de ses propres sessions', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('section-comptes')).toBeTruthy();
    expect(screen.getByText('deconnexion-partout')).toBeTruthy();
  });

  /**
   * Refonte du 2026-10-21 : sections pliables. Les deux propriétés qui comptent
   * sont l'état d'ouverture de départ et le résumé lisible sans déplier.
   */
  it('n’ouvre que « Reconnaissance » quand rien ne réclame d’action', () => {
    comptes.pending = false;
    renderScreen();
    const ouvertes = screen
      .getAllByRole('group')
      .filter((d): d is HTMLDetailsElement => d instanceof HTMLDetailsElement && d.open)
      .map((d) => d.querySelector('summary')?.textContent ?? '');
    expect(ouvertes).toHaveLength(1);
    expect(ouvertes[0]).toContain('Reconnaissance');
  });

  it('ouvre aussi « Comptes » tant qu’une demande attend : elle ne doit pas dormir derrière un repli', () => {
    comptes.pending = true;
    renderScreen();
    const ouvertes = screen
      .getAllByRole('group')
      .filter((d): d is HTMLDetailsElement => d instanceof HTMLDetailsElement && d.open)
      .map((d) => d.querySelector('summary')?.textContent ?? '');
    expect(ouvertes.some((t) => t.includes('Comptes'))).toBe(true);
  });

  it('résume chaque section sans qu’on ait à la déplier', () => {
    comptes.pending = true;
    renderScreen();
    expect(screen.getByText(/gemini · 4 \/ 50 photos aujourd’hui/i)).toBeTruthy();
    expect(screen.getByText(/2 actifs · 1 en attente/)).toBeTruthy();
    expect(screen.getByText(/Alerte à 3 jours/)).toBeTruthy();
  });

  it('laisse « Se déconnecter » atteignable sans déplier quoi que ce soit', () => {
    renderScreen();
    const bouton = screen.getByRole('button', { name: 'Se déconnecter' });
    expect(bouton.closest('details')).toBeNull();
  });
});

function renderScreen() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
