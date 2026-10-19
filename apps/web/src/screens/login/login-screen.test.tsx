import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api';
import type * as ApiModule from '../../lib/api';
import { useAuth } from '../../hooks/use-auth';
import { useGoogleClientIdQuery } from '../../lib/queries';
import { APP_NAME } from './auth-layout';
import { LoginScreen } from './login-screen';

const post = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api');
  return { ...actual, api: { ...actual.api, post: (...args: unknown[]) => post(...args) } };
});
vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/queries', () => ({ useGoogleClientIdQuery: vi.fn() }));

interface InitOptions {
  client_id: string;
  callback: (response: { credential: string }) => void;
}

/** Dernier appel à `initialize`, ou un échec explicite s'il n'a pas eu lieu. */
function lastInit(init: { mock: { calls: [InitOptions][] } }): InitOptions {
  const call = init.mock.calls.at(-1);
  if (!call) throw new Error('google.accounts.id.initialize n’a pas été appelé');
  return call[0];
}

function stubGoogle() {
  const init = vi.fn<(options: InitOptions) => void>();
  Object.defineProperty(window, 'google', {
    configurable: true,
    writable: true,
    value: {
      accounts: {
        id: {
          initialize: init,
          renderButton: (parent: HTMLElement) => {
            const button = parent.ownerDocument.createElement('button');
            button.textContent = 'Se connecter avec Google';
            parent.appendChild(button);
          },
        },
      },
    },
  });
  return init;
}

function renderLogin(clientId: string, state: 'anonymous' | 'setup_required' = 'anonymous') {
  vi.mocked(useAuth).mockReturnValue({
    state,
    user: null,
    isAdmin: false,
    refresh: vi.fn(async () => {}),
    clear: vi.fn(),
    error: null,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useGoogleClientIdQuery).mockReturnValue({
    isPending: false,
    isError: false,
    data: { clientId },
  } as unknown as ReturnType<typeof useGoogleClientIdQuery>);
  render(
    <MemoryRouter>
      <LoginScreen />
    </MemoryRouter>,
  );
}

describe('LoginScreen', () => {
  beforeEach(() => {
    post.mockReset();
    Reflect.deleteProperty(window, 'google');
  });

  it('n’affiche aucun bouton quand le Client ID n’est pas configuré', async () => {
    stubGoogle();
    renderLogin('');

    expect(await screen.findByText(/connexion Google n’est pas configurée/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull();
  });

  // Demande de djkix (2026-10-19) : l'écran de connexion est le seul que l'on
  // voit sans barre de titre ni navigation, et rien n'y disait de quelle
  // application il s'agit.
  it('porte le nom de l’application', () => {
    stubGoogle();
    renderLogin('abc');

    expect(screen.getByText(APP_NAME)).toBeTruthy();
  });

  it('n’affiche plus de formulaire de mot de passe', () => {
    stubGoogle();
    renderLogin('abc');

    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    expect(screen.queryByLabelText(/adresse e-mail/i)).toBeNull();
  });

  it('envoie le jeton rendu par Google à POST /auth/google', async () => {
    const init = stubGoogle();
    post.mockResolvedValue({ id: 'u1', email: 'a@b.fr', name: 'A', role: 'ADMIN' });
    renderLogin('abc');

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    lastInit(init).callback({ credential: 'jeton-google' });

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls.at(0)?.[0]).toBe('/auth/google');
    expect(post.mock.calls.at(0)?.[1]).toEqual({ credential: 'jeton-google' });
  });

  it('affiche un 403 « demande en attente » comme une information, pas comme une erreur', async () => {
    const init = stubGoogle();
    post.mockRejectedValue(new ApiClientError(403, 'forbidden', 'Votre demande attend la validation d’un administrateur.'));
    renderLogin('abc');

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    lastInit(init).callback({ credential: 'jeton-google' });

    const message = await screen.findByText(/attend la validation/i);
    expect(message.getAttribute('role')).toBe('status');
    expect(message.className).not.toMatch(/danger/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sur une base vide, annonce que la première connexion Google crée l’administrateur', async () => {
    stubGoogle();
    renderLogin('abc', 'setup_required');

    expect(await screen.findByText(/première connexion Google.*administrateur/i)).toBeTruthy();
  });
});
