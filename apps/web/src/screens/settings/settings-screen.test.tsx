import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './settings-screen';

vi.mock('../../hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'me', name: 'Moi', email: 'moi@example.com', role: 'ADMIN' }, isAdmin: true, clear: vi.fn() }),
}));
vi.mock('../../lib/queries', () => ({
  queryKeys: {},
  useSettingsQuery: () => ({ data: { expiryAlertDays: 3 }, isPending: false }),
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
});
