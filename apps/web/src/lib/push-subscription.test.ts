import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';
import { api } from './api';
import { ensurePushSubscription } from './push-subscription';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('./api');
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const SUBSCRIPTION = { endpoint: 'https://push.example.org/a', toJSON: () => ({ endpoint: 'https://push.example.org/a', keys: {} }) };

function browser(options: { permission: NotificationPermission; existing?: unknown; grant?: NotificationPermission }) {
  const requestPermission = vi.fn().mockResolvedValue(options.grant ?? 'granted');
  vi.stubGlobal('Notification', { permission: options.permission, requestPermission });
  vi.stubGlobal('PushManager', class {});
  const subscribe = vi.fn().mockResolvedValue(SUBSCRIPTION);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(options.existing ?? null), subscribe } }) },
  });
  return { requestPermission, subscribe };
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ publicKey: 'cle-publique' });
  post.mockResolvedValue(undefined);
});

describe('ensurePushSubscription, demande automatique (amendement du 2026-11-02)', () => {
  it('demande l’autorisation et abonne dès la première demande au modèle', async () => {
    const { requestPermission, subscribe } = browser({ permission: 'default' });
    expect(await ensurePushSubscription({ auto: true })).toBe('subscribed');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/notifications/subscription', expect.anything());
  });

  // Un refus ne doit pas redemander à chaque photo : une fois par appareil.
  it('ne redemande jamais de lui-même après un refus', async () => {
    const premier = browser({ permission: 'default', grant: 'denied' });
    expect(await ensurePushSubscription({ auto: true })).toBe('denied');
    expect(premier.requestPermission).toHaveBeenCalledTimes(1);

    const second = browser({ permission: 'default' });
    expect(await ensurePushSubscription({ auto: true })).toBe('unavailable');
    expect(second.requestPermission).not.toHaveBeenCalled();
  });

  // L'interrupteur de Réglages est un geste explicite : il passe outre.
  it('redemande quand c’est l’interrupteur qui le veut', async () => {
    browser({ permission: 'default', grant: 'denied' });
    await ensurePushSubscription({ auto: true });
    const explicite = browser({ permission: 'default' });
    expect(await ensurePushSubscription()).toBe('subscribed');
    expect(explicite.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('ne demande rien quand le serveur n’a pas de clé', async () => {
    const { requestPermission } = browser({ permission: 'default' });
    get.mockResolvedValue({ publicKey: null });
    expect(await ensurePushSubscription({ auto: true })).toBe('unavailable');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('ne demande rien sur un appareil qui ne sait pas faire', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    expect(await ensurePushSubscription({ auto: true })).toBe('unavailable');
    expect(get).not.toHaveBeenCalled();
  });

  // Base restaurée, compte recréé : le navigateur est abonné, le serveur l'a
  // oublié. Réaffirmer coûte un appel et évite un silence inexplicable.
  it('réaffirme au serveur un abonnement que le navigateur a déjà', async () => {
    const { requestPermission, subscribe } = browser({ permission: 'granted', existing: SUBSCRIPTION });
    expect(await ensurePushSubscription({ auto: true })).toBe('subscribed');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/notifications/subscription', expect.anything());
  });

  it('ne demande rien quand l’autorisation a été refusée au téléphone', async () => {
    const { requestPermission } = browser({ permission: 'denied' });
    expect(await ensurePushSubscription()).toBe('denied');
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
