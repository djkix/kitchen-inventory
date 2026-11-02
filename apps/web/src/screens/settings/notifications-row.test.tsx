import type * as ApiModule from '../../lib/api';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { NotificationsRow } from './notifications-row';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api');
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const get = vi.mocked(api.get);
const toggle = () => screen.getByRole('switch') as HTMLInputElement;
const renderRow = () =>
  render(
    <ToastProvider>
      <NotificationsRow />
    </ToastProvider>,
  );

/** Un navigateur qui sait faire : service worker, PushManager, Notification. */
function browserWithPush(subscription: unknown = null) {
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted'), permission: 'default' });
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn() } }) },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  get.mockReset();
});

describe('NotificationsRow (D8, D11)', () => {
  it('reste éteint et dit pourquoi quand l’appareil ne sait pas faire', async () => {
    get.mockResolvedValue({ publicKey: 'cle' });
    // Pas de `PushManager` ni de `Notification` : un navigateur qui ne sait pas.
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    renderRow();

    await screen.findByRole('switch');
    expect(toggle().disabled).toBe(true);
    expect(screen.getByText(/ne sait pas afficher de notifications/i)).toBeTruthy();
    // La limite d'iOS doit se lire dans l'interface, pas se découvrir à l'usage.
    expect(screen.getByText(/écran d’accueil/i)).toBeTruthy();
  });

  // D11 : sans clés VAPID, l'application marche, et l'interrupteur le dit au
  // lieu de laisser croire que les notifications sont simplement en panne.
  it('reste éteint et dit pourquoi quand le serveur n’a pas de clé', async () => {
    browserWithPush();
    get.mockResolvedValue({ publicKey: null });
    renderRow();

    await waitFor(() => expect(screen.getByText(/ne sont pas configurées sur ce serveur/i)).toBeTruthy());
    expect(toggle().disabled).toBe(true);
  });

  it('s’affiche éteint et actionnable quand tout est en place', async () => {
    browserWithPush();
    get.mockResolvedValue({ publicKey: 'cle' });
    renderRow();

    await waitFor(() => expect(toggle().disabled).toBe(false));
    expect(toggle().checked).toBe(false);
    expect(screen.getByText(/Réglage propre à cet appareil/i)).toBeTruthy();
  });

  it('s’affiche allumé quand cet appareil est déjà abonné', async () => {
    browserWithPush({ endpoint: 'https://push.example.org/a' });
    get.mockResolvedValue({ publicKey: 'cle' });
    renderRow();

    await waitFor(() => expect(toggle().checked).toBe(true));
  });
});
