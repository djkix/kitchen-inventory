import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccountDto } from '@kitchen/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../../lib/api';
import { useAuth } from '../../hooks/use-auth';
import { AccountsSection, SignOutEverywhereRow } from './accounts-section';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const show = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      delete: (...a: unknown[]) => del(...a),
    },
  };
});
vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ show, dismiss: vi.fn() }) }));

const account = (over: Partial<AccountDto>): AccountDto => ({
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  role: 'MEMBER',
  status: 'ACTIVE',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const PENDING = account({ id: 'p1', email: 'nouveau@example.com', name: 'Nina', status: 'PENDING' });
const ME = account({ id: 'me', email: 'moi@example.com', name: 'Moi', role: 'ADMIN' });
const REFUSED = account({ id: 'r1', email: 'refuse@example.com', name: 'Rita', status: 'REVOKED' });
const OTHER = account({ id: 'o1', email: 'autre@example.com', name: 'Olivier' });

function setAuth(isAdmin: boolean, clear = vi.fn()) {
  vi.mocked(useAuth).mockReturnValue({
    state: 'authenticated',
    user: { id: 'me', name: 'Moi', email: 'moi@example.com', role: isAdmin ? 'ADMIN' : 'MEMBER' },
    isAdmin,
    refresh: vi.fn(),
    clear,
    error: null,
  } as unknown as ReturnType<typeof useAuth>);
  return clear;
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({});
  del.mockResolvedValue(undefined);
});

describe('AccountsSection', () => {
  it('n’apparaît pas pour un membre et n’interroge pas l’API', () => {
    setAuth(false);
    const { container } = renderUi(<AccountsSection />);
    expect(container.innerHTML).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('liste les demandes en attente avec adresse et nom, puis les comptes actifs', async () => {
    setAuth(true);
    get.mockResolvedValue([PENDING, ME, OTHER]);
    renderUi(<AccountsSection />);
    const pending = await screen.findByRole('region', { name: 'Demandes en attente' });
    expect(within(pending).getByText('Nina')).toBeTruthy();
    expect(within(pending).getByText(/nouveau@example\.com/)).toBeTruthy();
    const active = screen.getByRole('region', { name: 'Comptes actifs' });
    expect(within(active).getByText('Olivier')).toBeTruthy();
    expect(within(active).queryByText('Nina')).toBeNull();
    expect(get).toHaveBeenCalledWith('/accounts');
  });

  it('affiche un état vide explicite sans demande en attente', async () => {
    setAuth(true);
    get.mockResolvedValue([ME]);
    renderUi(<AccountsSection />);
    expect(await screen.findByText('Aucune demande en attente')).toBeTruthy();
  });

  it('Valider appelle approve, puis la liste reflète le changement sans rechargement', async () => {
    setAuth(true);
    get.mockResolvedValueOnce([PENDING, ME]).mockResolvedValue([ME, { ...PENDING, status: 'ACTIVE' }]);
    renderUi(<AccountsSection />);
    const pending = await screen.findByRole('region', { name: 'Demandes en attente' });
    fireEvent.click(within(pending).getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/p1/approve'));
    const active = await screen.findByRole('region', { name: 'Comptes actifs' });
    await waitFor(() => expect(within(active).getByText('Nina')).toBeTruthy());
    expect(screen.getByText('Aucune demande en attente')).toBeTruthy();
  });

  it('Refuser appelle revoke sur la demande', async () => {
    setAuth(true);
    get.mockResolvedValueOnce([PENDING, ME]).mockResolvedValue([ME, { ...PENDING, status: 'REVOKED' }]);
    renderUi(<AccountsSection />);
    const pending = await screen.findByRole('region', { name: 'Demandes en attente' });
    fireEvent.click(within(pending).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/p1/revoke'));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Demande de Nina refusée', tone: 'success' })));
    const refused = await screen.findByRole('region', { name: 'Refusés' });
    await waitFor(() => expect(within(refused).getByText('Nina')).toBeTruthy());
  });

  it('liste les comptes refusés ou révoqués, et Rétablir appelle approve', async () => {
    setAuth(true);
    get.mockResolvedValueOnce([ME, REFUSED]).mockResolvedValue([ME, { ...REFUSED, status: 'ACTIVE' }]);
    renderUi(<AccountsSection />);
    const refused = await screen.findByRole('region', { name: 'Refusés' });
    expect(within(refused).getByText('Rita')).toBeTruthy();
    expect(within(refused).getByText(/refuse@example\.com/)).toBeTruthy();
    fireEvent.click(within(refused).getByRole('button', { name: 'Rétablir' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/r1/approve'));
    const active = screen.getByRole('region', { name: 'Comptes actifs' });
    await waitFor(() => expect(within(active).getByText('Rita')).toBeTruthy());
    expect(within(screen.getByRole('region', { name: 'Refusés' })).queryByText('Rita')).toBeNull();
  });

  it('affiche un état vide explicite quand personne n’est refusé', async () => {
    setAuth(true);
    get.mockResolvedValue([ME]);
    renderUi(<AccountsSection />);
    const refused = await screen.findByRole('region', { name: 'Refusés' });
    expect(within(refused).getByText('Aucun compte refusé')).toBeTruthy();
  });

  it('Révoquer demande confirmation puis appelle revoke ; refus de confirmer = aucun appel', async () => {
    setAuth(true);
    get.mockResolvedValue([ME, OTHER]);
    renderUi(<AccountsSection />);
    const active = await screen.findByRole('region', { name: 'Comptes actifs' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(within(active).getByRole('button', { name: 'Révoquer' }));
    expect(post).not.toHaveBeenCalled();
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(within(active).getByRole('button', { name: 'Révoquer' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/o1/revoke'));
  });

  it('ne propose pas de révoquer son propre compte', async () => {
    setAuth(true);
    get.mockResolvedValue([ME, OTHER]);
    renderUi(<AccountsSection />);
    const active = await screen.findByRole('region', { name: 'Comptes actifs' });
    expect(within(active).getAllByRole('button', { name: 'Révoquer' })).toHaveLength(1);
  });

  it('Déconnecter demande confirmation puis coupe les sessions du compte', async () => {
    setAuth(true);
    get.mockResolvedValue([ME, OTHER]);
    renderUi(<AccountsSection />);
    const active = await screen.findByRole('region', { name: 'Comptes actifs' });
    const ligne = within(within(active).getByText('Olivier').closest('div')?.parentElement as HTMLElement);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(ligne.getByRole('button', { name: 'Déconnecter' }));
    expect(del).not.toHaveBeenCalled();
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(ligne.getByRole('button', { name: 'Déconnecter' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/users/o1/sessions'));
  });

  it('« Déconnecter » sur sa propre ligne demande aussi confirmation, et le refus ne coupe rien', async () => {
    // Sur un téléphone, cette ligne est voisine de « Révoquer » : un doigt mal
    // placé ne doit pas couper toutes ses propres sessions, celle-ci comprise.
    setAuth(true);
    get.mockResolvedValue([ME, OTHER]);
    renderUi(<AccountsSection />);
    const active = await screen.findByRole('region', { name: 'Comptes actifs' });
    const maLigne = within(within(active).getByText(/Moi/).closest('div')?.parentElement as HTMLElement);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(maLigne.getByRole('button', { name: 'Déconnecter' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/y compris celle-ci/));
    expect(del).not.toHaveBeenCalled();
  });

  describe('partage de l’administration', () => {
    it('Promouvoir appelle la route de rôle après confirmation', async () => {
      setAuth(true);
      get.mockResolvedValueOnce([ME, OTHER]).mockResolvedValue([ME, { ...OTHER, role: 'ADMIN' }]);
      renderUi(<AccountsSection />);
      const active = await screen.findByRole('region', { name: 'Comptes actifs' });
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      fireEvent.click(within(active).getByRole('button', { name: 'Promouvoir' }));
      expect(post).not.toHaveBeenCalled();
      confirmSpy.mockReturnValueOnce(true);
      fireEvent.click(within(active).getByRole('button', { name: 'Promouvoir' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/o1/role', { role: 'ADMIN' }));
      await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Olivier est administrateur', tone: 'success' })));
    });

    it('« Retirer admin » rétrograde un autre administrateur', async () => {
      setAuth(true);
      get.mockResolvedValue([ME, { ...OTHER, role: 'ADMIN' }]);
      renderUi(<AccountsSection />);
      const active = await screen.findByRole('region', { name: 'Comptes actifs' });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fireEvent.click(within(active).getByRole('button', { name: 'Retirer admin' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/accounts/o1/role', { role: 'MEMBER' }));
    });

    it('ne propose aucun changement de rôle sur sa propre ligne', async () => {
      setAuth(true);
      get.mockResolvedValue([ME, OTHER]);
      renderUi(<AccountsSection />);
      const active = await screen.findByRole('region', { name: 'Comptes actifs' });
      expect(within(active).getAllByRole('button', { name: /Promouvoir|Retirer admin/ })).toHaveLength(1);
    });
  });

  it('affiche l’erreur de l’API si la validation échoue', async () => {
    setAuth(true);
    get.mockResolvedValue([PENDING, ME]);
    post.mockRejectedValue(new Error('Compte introuvable'));
    renderUi(<AccountsSection />);
    const pending = await screen.findByRole('region', { name: 'Demandes en attente' });
    fireEvent.click(within(pending).getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Compte introuvable', tone: 'danger' })));
  });
});

describe('SignOutEverywhereRow', () => {
  it('coupe les sessions du compte courant, y compris celle-ci', async () => {
    const clear = setAuth(false);
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    renderUi(<SignOutEverywhereRow />);
    fireEvent.click(screen.getByRole('button', { name: /Déconnecter tous mes appareils/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/users/me/sessions'));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith('/connexion');
  });
});
