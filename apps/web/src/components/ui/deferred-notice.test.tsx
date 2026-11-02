import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api';
import { DeferredNotice } from './deferred-notice';

const differe = (minutes: number) =>
  new ApiClientError(429, 'rate_limited', 'Gardée.', { deferred: true, retryAt: new Date(Date.now() + minutes * 60_000).toISOString() });

function pushGranted(permission: NotificationPermission | null) {
  if (permission === null) {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    return;
  }
  vi.stubGlobal('Notification', { permission });
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('DeferredNotice', () => {
  it('annonce une attente, pas un échec, et dit la durée restante', () => {
    pushGranted('granted');
    render(<DeferredNotice error={differe(21)} what="recettes" />);
    expect(screen.getByText('En attente de Gemini')).toBeTruthy();
    expect(screen.getByText(/20 minutes/)).toBeTruthy();
    expect(screen.getByText(/fermer l’application/)).toBeTruthy();
  });

  it('promet la notification quand elle est autorisée', () => {
    pushGranted('granted');
    render(<DeferredNotice error={differe(21)} what="recettes" />);
    expect(screen.getByText(/recevrez une notification/)).toBeTruthy();
  });

  // Une promesse fausse est pire que pas de promesse : sans autorisation,
  // rien n'arrivera, et l'écran doit le dire.
  it('ne promet rien quand les notifications ne sont pas autorisées', () => {
    pushGranted('default');
    render(<DeferredNotice error={differe(21)} what="ticket" />);
    expect(screen.queryByText(/recevrez une notification/)).toBeNull();
    expect(screen.getByText(/Activez les notifications/)).toBeTruthy();
  });

  it('ne promet rien sur un appareil qui ne sait pas faire', () => {
    pushGranted(null);
    render(<DeferredNotice error={differe(21)} what="ticket" />);
    expect(screen.getByText(/Activez les notifications/)).toBeTruthy();
  });

  it('nomme le ticket plutôt que les recettes', () => {
    pushGranted('granted');
    render(<DeferredNotice error={differe(3)} what="ticket" />);
    expect(screen.getByText(/Votre ticket repartira seul /)).toBeTruthy();
    expect(screen.getByText(/3 minutes/)).toBeTruthy();
  });

  it('tient sans heure de reprise', () => {
    pushGranted('granted');
    render(<DeferredNotice error={new ApiClientError(429, 'rate_limited', 'Gardée.', { deferred: true })} what="recettes" />);
    expect(screen.getByText(/dès la reprise/)).toBeTruthy();
  });
});
