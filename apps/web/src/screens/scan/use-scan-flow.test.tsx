import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api';
import type * as ApiModule from '../../lib/api';

const postForm = vi.fn();
const toastShow = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api');
  return { ...actual, api: { ...actual.api, postForm: (...args: unknown[]) => postForm(...args) } };
});
// La conversion en JPEG passe par `createImageBitmap` et un canvas, absents de
// jsdom : seul le code d'erreur rendu par l'API est en cause ici.
vi.mock('../../lib/image', () => ({
  isAcceptedPhoto: () => true,
  photoFileToJpeg: async () => new Blob(['x'], { type: 'image/jpeg' }),
}));
vi.mock('../../components/scanner/feedback', () => ({ errorFeedback: vi.fn(), scanFeedback: vi.fn() }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ show: toastShow }) }));

const { useScanFlow } = await import('./use-scan-flow');

function photo(): File {
  return new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
}

describe('useScanFlow : photo refusée par la configuration du serveur', () => {
  beforeEach(() => {
    postForm.mockReset();
    toastShow.mockReset();
  });

  /**
   * `VISION_PROVIDER=none` : la garde partagée du serveur rend `provider_disabled`
   * (et non plus `business_rule`). L'écran bloquant dédié doit réapparaître —
   * c'est lui, et non un message passager, qui explique qu'aucun fournisseur
   * n'est configuré.
   */
  it('montre l’écran bloquant dédié sur provider_disabled', async () => {
    const message = 'Fournisseur de vision désactivé : renseignez VISION_PROVIDER et VISION_API_KEY';
    postForm.mockRejectedValue(new ApiClientError(422, 'provider_disabled', message));
    const { result } = renderHook(() => useScanFlow({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.submitPhoto(photo(), null);
    });

    await waitFor(() => {
      expect(result.current.phase).toMatchObject({ kind: 'blocked', reason: 'disabled', message });
    });
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('laisse un business_rule retomber sur le message passager, sans écran bloquant', async () => {
    postForm.mockRejectedValue(new ApiClientError(422, 'business_rule', 'Règle métier violée'));
    const { result } = renderHook(() => useScanFlow({ locationId: 'loc-1' }));

    await act(async () => {
      await result.current.submitPhoto(photo(), null);
    });

    await waitFor(() => {
      expect(result.current.phase.kind).not.toBe('blocked');
    });
    expect(toastShow).toHaveBeenCalled();
  });
});
